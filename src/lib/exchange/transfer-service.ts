// Member-to-member kWh transfers — ТЗ §24 and §23 (US-19).
//
// Legally these are not payments: they are a redistribution of energy shares
// inside an energy community (§24 "Юридическая модель переводов"). Technically
// that means the tokens move but no money does, both sides must be KYC-verified
// members of one cooperative in the same zone, and every transfer is
// AML-monitored against daily and monthly caps. Shut until the lawyer's opinion
// required by §24.4 (gates.ts).

import { Prisma, TokenTransferStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { type Db, writeAudit } from "./audit";
import { num } from "./decimal";
import { assertTransfersOpen } from "./gates";
import { shareCooperative } from "./membership";
import { isKwhDust, roundKwh } from "./precision";
import { transferTokens } from "./token-registry";
import { getOrCreateWallet } from "./wallet-service";

/** §24 "Лимиты на перевод в сутки и месяц" — defaults until the operator sets them. */
export const DAILY_TRANSFER_LIMIT_KWH = 500;
export const MONTHLY_TRANSFER_LIMIT_KWH = 5000;

export class TransferError extends Error {}

export interface TransferInput {
  fromUserId: string;
  /** Recipient by username — contacts in the app resolve to this (§22.8). */
  toUsername: string;
  zoneId: string;
  amountKwh: number;
  note?: string | null;
  /** When true the recipient must confirm before the tokens move (§24). */
  requireConfirmation?: boolean;
  /** §15 — a replayed POST must not move the energy twice. */
  idempotencyKey?: string | null;
}

export interface TransferResult {
  transferId: string;
  status: TokenTransferStatus;
  amountKwh: number;
  /** True when the key had already been used and nothing new happened. */
  idempotentReplay?: boolean;
}

/** The shape a replayed key answers with — read, never re-executed. */
async function replayTransfer(key: string): Promise<TransferResult | null> {
  const existing = await prisma.tokenTransfer.findUnique({
    where: { idempotencyKey: key },
    select: { id: true, status: true, amountKwh: true },
  });
  if (!existing) return null;
  return {
    transferId: existing.id,
    status: existing.status,
    amountKwh: num(existing.amountKwh),
    idempotentReplay: true,
  };
}

async function assertShareCooperative(
  db: Db,
  zoneId: string,
  fromUserId: string,
  toUserId: string,
): Promise<void> {
  if (!(await shareCooperative(db, zoneId, fromUserId, toUserId))) {
    throw new TransferError(
      "Both sides must be KYC-verified members of one cooperative in this zone (ТЗ §24)",
    );
  }
}

async function transferredSince(walletId: string, since: Date): Promise<number> {
  const rows = await prisma.tokenTransfer.findMany({
    where: {
      fromWalletId: walletId,
      status: { not: TokenTransferStatus.CANCELLED },
      createdAt: { gte: since },
    },
    select: { amountKwh: true },
  });
  return roundKwh(rows.reduce((sum, r) => sum + num(r.amountKwh), 0));
}

export async function transferKwh(input: TransferInput): Promise<TransferResult> {
  assertTransfersOpen();
  if (input.idempotencyKey) {
    const replay = await replayTransfer(input.idempotencyKey);
    if (replay) return replay;
  }
  const amount = roundKwh(input.amountKwh);
  if (!(amount > 0)) throw new TransferError("Transfer amount must be positive");

  const recipient = await prisma.user.findUnique({
    where: { username: input.toUsername.toLowerCase() },
    select: { id: true, username: true },
  });
  if (!recipient) throw new TransferError(`No Poolwatt user named ${input.toUsername}`);
  if (recipient.id === input.fromUserId) {
    throw new TransferError("Cannot transfer kWh to yourself");
  }
  await assertShareCooperative(prisma, input.zoneId, input.fromUserId, recipient.id);

  const fromWallet = await getOrCreateWallet(input.fromUserId, input.zoneId);
  // §24 — both sides stay inside one zone; crossing zones is a roaming
  // settlement, not a transfer.
  const toWallet = await getOrCreateWallet(recipient.id, input.zoneId);

  if (num(fromWallet.kwhBalance) + 0.0005 < amount) {
    throw new TransferError(
      `Balance is ${num(fromWallet.kwhBalance)} kWh, cannot transfer ${amount} kWh`,
    );
  }

  const now = new Date();
  const dayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [daily, monthly] = await Promise.all([
    transferredSince(fromWallet.id, dayStart),
    transferredSince(fromWallet.id, monthStart),
  ]);
  if (daily + amount > DAILY_TRANSFER_LIMIT_KWH) {
    throw new TransferError(
      `Daily transfer limit of ${DAILY_TRANSFER_LIMIT_KWH} kWh would be exceeded (${daily} kWh already sent)`,
    );
  }
  if (monthly + amount > MONTHLY_TRANSFER_LIMIT_KWH) {
    throw new TransferError(
      `Monthly transfer limit of ${MONTHLY_TRANSFER_LIMIT_KWH} kWh would be exceeded (${monthly} kWh already sent)`,
    );
  }

  try {
    return await runTransfer(input, { amount, fromWalletId: fromWallet.id, toWalletId: toWallet.id, recipientName: recipient.username, now });
  } catch (err) {
    // Two concurrent requests with one key: the loser of the unique index
    // answers with what the winner did, so the caller sees one transfer.
    if (
      input.idempotencyKey &&
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const replay = await replayTransfer(input.idempotencyKey);
      if (replay) return replay;
    }
    throw err;
  }
}

async function runTransfer(
  input: TransferInput,
  ctx: {
    amount: number;
    fromWalletId: string;
    toWalletId: string;
    recipientName: string;
    now: Date;
  },
): Promise<TransferResult> {
  const { amount, fromWalletId, toWalletId, now } = ctx;
  return prisma.$transaction(async (tx) => {
    const pending = Boolean(input.requireConfirmation);
    const transfer = await tx.tokenTransfer.create({
      data: {
        zoneId: input.zoneId,
        fromWalletId,
        toWalletId,
        amountKwh: new Prisma.Decimal(amount),
        note: input.note?.trim() || null,
        status: pending ? TokenTransferStatus.CREATED : TokenTransferStatus.CONFIRMED,
        confirmedAt: pending ? null : now,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });

    if (!pending) {
      await transferTokens(tx, {
        fromWalletId,
        toWalletId,
        amountKwh: amount,
      });
    }

    await writeAudit(tx, {
      actor: input.fromUserId,
      entity: "TokenTransfer",
      entityId: transfer.id,
      action: pending ? "transfer.created" : "transfer.confirmed",
      after: { to: ctx.recipientName, amountKwh: amount, zoneId: input.zoneId },
    });

    return { transferId: transfer.id, status: transfer.status, amountKwh: amount };
  });
}

/** §24 — the recipient accepts a transfer that was sent in request mode. */
export async function confirmTransfer(transferId: string, byUserId: string) {
  assertTransfersOpen();
  return prisma.$transaction(async (tx) => {
    const transfer = await tx.tokenTransfer.findUniqueOrThrow({
      where: { id: transferId },
      include: {
        fromWallet: { select: { ownerUserId: true } },
        toWallet: { select: { ownerUserId: true } },
      },
    });
    if (transfer.status !== TokenTransferStatus.CREATED) {
      throw new TransferError(`Transfer is already ${transfer.status}`);
    }
    if (transfer.toWallet.ownerUserId !== byUserId) {
      throw new TransferError("Only the recipient can confirm this transfer");
    }
    // Membership may have ended since the transfer was sent.
    await assertShareCooperative(
      tx,
      transfer.zoneId,
      transfer.fromWallet.ownerUserId,
      transfer.toWallet.ownerUserId,
    );

    await transferTokens(tx, {
      fromWalletId: transfer.fromWalletId,
      toWalletId: transfer.toWalletId,
      amountKwh: num(transfer.amountKwh),
    });
    const updated = await tx.tokenTransfer.update({
      where: { id: transferId },
      data: { status: TokenTransferStatus.CONFIRMED, confirmedAt: new Date() },
    });
    await writeAudit(tx, {
      actor: byUserId,
      entity: "TokenTransfer",
      entityId: transferId,
      action: "transfer.confirmed",
      after: { amountKwh: num(transfer.amountKwh) },
    });
    return updated;
  });
}

/** §24 — "возможна отмена только до подтверждения получателем". */
export async function cancelTransfer(transferId: string, byUserId: string) {
  const transfer = await prisma.tokenTransfer.findUniqueOrThrow({
    where: { id: transferId },
    include: {
      fromWallet: { select: { ownerUserId: true } },
      toWallet: { select: { ownerUserId: true } },
    },
  });
  if (transfer.status !== TokenTransferStatus.CREATED) {
    throw new TransferError(`Only a pending transfer can be cancelled, this one is ${transfer.status}`);
  }
  if (
    transfer.fromWallet.ownerUserId !== byUserId &&
    transfer.toWallet.ownerUserId !== byUserId
  ) {
    throw new TransferError("Not a party to this transfer");
  }

  const updated = await prisma.tokenTransfer.update({
    where: { id: transferId },
    data: { status: TokenTransferStatus.CANCELLED, cancelledAt: new Date() },
  });
  await writeAudit(prisma, {
    actor: byUserId,
    entity: "TokenTransfer",
    entityId: transferId,
    action: "transfer.cancelled",
  });
  return updated;
}

/** Remaining allowance, for the app's transfer screen. */
export async function transferAllowance(userId: string, zoneId: string) {
  const wallet = await getOrCreateWallet(userId, zoneId);
  const now = Date.now();
  const [daily, monthly] = await Promise.all([
    transferredSince(wallet.id, new Date(now - 24 * 60 * 60 * 1000)),
    transferredSince(wallet.id, new Date(now - 30 * 24 * 60 * 60 * 1000)),
  ]);
  return {
    dailyUsedKwh: daily,
    dailyLimitKwh: DAILY_TRANSFER_LIMIT_KWH,
    monthlyUsedKwh: monthly,
    monthlyLimitKwh: MONTHLY_TRANSFER_LIMIT_KWH,
    remainingKwh: roundKwh(
      Math.max(
        0,
        Math.min(DAILY_TRANSFER_LIMIT_KWH - daily, MONTHLY_TRANSFER_LIMIT_KWH - monthly),
      ),
    ),
  };
}

export { isKwhDust };
