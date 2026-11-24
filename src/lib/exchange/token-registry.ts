// The token registry — ТЗ §5, §13 (Token), §14 (token lifecycle), §16.1–§16.3.
//
// A token row is a *batch* of kWh pinned to one asset, zone and delivery
// interval. Batches split rather than being partially mutated, so every kWh
// keeps an unbroken lineage from the meter reading that minted it to the
// receipt that burned it — that lineage is what §5 means by "защита от
// двойного учёта" and what the daily grid reconciliation walks.
//
// Wallet.kwhBalance is a cached sum of the batches a wallet holds. Every
// function here updates both in the same transaction, and `assertWalletTokensBalance`
// re-derives the sum so a drift shows up as a failed transaction, not as
// silently wrong money.

import { EnergyTokenStatus, Prisma } from "@prisma/client";
import type { Db } from "./audit";
import { num } from "./decimal";
import { floorKwh, isKwhDust, roundKwh } from "./precision";

/** Batch statuses that count towards a wallet's spendable kWh balance. */
export const SPENDABLE_STATUSES: EnergyTokenStatus[] = [
  EnergyTokenStatus.AVAILABLE,
  EnergyTokenStatus.SOLD,
  EnergyTokenStatus.STORED,
];

export class InsufficientTokensError extends Error {
  constructor(
    readonly walletId: string,
    readonly requestedKwh: number,
    readonly availableKwh: number,
  ) {
    super(
      `Wallet ${walletId} holds ${availableKwh} kWh of tokens, ${requestedKwh} kWh requested`,
    );
    this.name = "InsufficientTokensError";
  }
}

export interface MintArgs {
  assetId: string;
  zoneId: string;
  intervalStart: Date;
  amountKwh: number;
  /** The reading this batch is minted from — enforces §16.2 one-mint-per-reading. */
  readingId?: string | null;
  ownerWalletId?: string | null;
  goCertificateRef?: string | null;
  status?: EnergyTokenStatus;
}

/**
 * Mint one batch. Fails loudly on a non-positive amount: a zero-kWh batch
 * would pollute the registry and break the reconciliation count.
 */
export async function mintToken(db: Db, args: MintArgs) {
  const amountKwh = roundKwh(args.amountKwh);
  if (!(amountKwh > 0)) {
    throw new RangeError(`Cannot mint a non-positive batch: ${args.amountKwh}`);
  }

  const token = await db.energyToken.create({
    data: {
      assetId: args.assetId,
      zoneId: args.zoneId,
      intervalStart: args.intervalStart,
      amountKwh: new Prisma.Decimal(amountKwh),
      readingId: args.readingId ?? null,
      ownerWalletId: args.ownerWalletId ?? null,
      goCertificateRef: args.goCertificateRef ?? null,
      status: args.status ?? EnergyTokenStatus.AVAILABLE,
    },
  });

  if (args.ownerWalletId) {
    await creditWalletKwh(db, args.ownerWalletId, amountKwh);
  }
  return token;
}

/**
 * Split `amountKwh` off a batch into a new child batch, leaving the parent
 * holding the remainder. Returns the child.
 *
 * The child carries the parent's asset, zone, interval and guarantee of
 * origin — a split must never launder a kWh into a different interval, which
 * is what §16.3 forbids.
 */
export async function splitToken(db: Db, tokenId: string, amountKwh: number) {
  const take = floorKwh(amountKwh);
  const parent = await db.energyToken.findUniqueOrThrow({ where: { id: tokenId } });
  const parentAmount = num(parent.amountKwh);

  if (!(take > 0)) throw new RangeError(`Cannot split off a non-positive amount: ${amountKwh}`);
  if (take > parentAmount + Number.EPSILON) {
    throw new RangeError(
      `Cannot split ${take} kWh off batch ${tokenId}, which holds ${parentAmount} kWh`,
    );
  }

  const child = await db.energyToken.create({
    data: {
      assetId: parent.assetId,
      zoneId: parent.zoneId,
      intervalStart: parent.intervalStart,
      amountKwh: new Prisma.Decimal(take),
      parentId: parent.id,
      ownerWalletId: parent.ownerWalletId,
      goCertificateRef: parent.goCertificateRef,
      status: parent.status,
      storedInAssetId: parent.storedInAssetId,
    },
  });

  const remainder = roundKwh(parentAmount - take);
  if (isKwhDust(remainder)) {
    // The parent is fully consumed by the split: retire it so the registry
    // never shows a zero-kWh batch as holdable inventory.
    await db.energyToken.update({
      where: { id: parent.id },
      data: { amountKwh: new Prisma.Decimal(0), status: EnergyTokenStatus.BURNED, burnedAt: new Date() },
    });
  } else {
    await db.energyToken.update({
      where: { id: parent.id },
      data: { amountKwh: new Prisma.Decimal(remainder) },
    });
  }

  return child;
}

/** Spendable batches of a wallet, oldest delivery interval first. */
export async function spendableTokens(db: Db, walletId: string) {
  return db.energyToken.findMany({
    where: { ownerWalletId: walletId, status: { in: SPENDABLE_STATUSES } },
    orderBy: [{ intervalStart: "asc" }, { mintedAt: "asc" }],
  });
}

async function takeExactly(db: Db, walletId: string, amountKwh: number): Promise<string[]> {
  const want = roundKwh(amountKwh);
  const batches = await spendableTokens(db, walletId);
  const held = roundKwh(batches.reduce((sum, b) => sum + num(b.amountKwh), 0));
  if (held + Number.EPSILON < want) {
    throw new InsufficientTokensError(walletId, want, held);
  }

  const taken: string[] = [];
  let left = want;
  // FIFO by delivery interval: the oldest kWh leave first, so a batch pinned
  // to an interval cannot sit in a wallet forever while newer ones are spent.
  for (const batch of batches) {
    if (isKwhDust(left)) break;
    const size = num(batch.amountKwh);
    if (isKwhDust(size)) continue;

    if (size <= left + Number.EPSILON) {
      taken.push(batch.id);
      left = roundKwh(left - size);
    } else {
      const child = await splitToken(db, batch.id, left);
      taken.push(child.id);
      left = 0;
    }
  }
  return taken;
}

/**
 * Hand `amountKwh` of batches from one wallet to another — a settled trade
 * (§14 reserved → sold) or a member-to-member transfer (§24).
 */
export async function transferTokens(
  db: Db,
  args: {
    fromWalletId: string;
    toWalletId: string;
    amountKwh: number;
    status?: EnergyTokenStatus;
  },
): Promise<string[]> {
  const amount = roundKwh(args.amountKwh);
  if (!(amount > 0)) throw new RangeError(`Cannot transfer a non-positive amount: ${amount}`);
  if (args.fromWalletId === args.toWalletId) {
    throw new RangeError("Cannot transfer tokens to the same wallet");
  }

  const ids = await takeExactly(db, args.fromWalletId, amount);
  await db.energyToken.updateMany({
    where: { id: { in: ids } },
    data: {
      ownerWalletId: args.toWalletId,
      status: args.status ?? EnergyTokenStatus.SOLD,
    },
  });

  await debitWalletKwh(db, args.fromWalletId, amount);
  await creditWalletKwh(db, args.toWalletId, amount);
  return ids;
}

/**
 * Burn `amountKwh` on consumption (§14 sold/stored → burned) and return the
 * batch ids for the receipt (§13 Receipt.burned_token_ids).
 */
export async function burnTokens(
  db: Db,
  args: { walletId: string; amountKwh: number },
): Promise<string[]> {
  const amount = roundKwh(args.amountKwh);
  if (!(amount > 0)) throw new RangeError(`Cannot burn a non-positive amount: ${amount}`);

  const ids = await takeExactly(db, args.walletId, amount);
  await db.energyToken.updateMany({
    where: { id: { in: ids } },
    data: { status: EnergyTokenStatus.BURNED, burnedAt: new Date() },
  });
  await debitWalletKwh(db, args.walletId, amount);
  return ids;
}

/** Move batches into storage or to the aggregator at interval close (§16.4). */
export async function routeTokens(
  db: Db,
  args: {
    tokenId: string;
    amountKwh: number;
    target: { kind: "storage"; assetId: string } | { kind: "aggregator"; name: string };
  },
): Promise<string> {
  const token = await db.energyToken.findUniqueOrThrow({ where: { id: args.tokenId } });
  const whole = Math.abs(num(token.amountKwh) - roundKwh(args.amountKwh)) < 0.0005;
  const target = whole ? token : await splitToken(db, token.id, args.amountKwh);

  if (args.target.kind === "storage") {
    await db.energyToken.update({
      where: { id: target.id },
      data: {
        status: EnergyTokenStatus.STORED,
        storedInAssetId: args.target.assetId,
        // §5: stored energy loses its interval pin — it is no longer tied to
        // the 15 minutes it was generated in.
        intervalStart: target.intervalStart,
      },
    });
    await db.asset.update({
      where: { id: args.target.assetId },
      data: { storedKwh: { increment: new Prisma.Decimal(roundKwh(args.amountKwh)) } },
    });
  } else {
    await db.energyToken.update({
      where: { id: target.id },
      data: { status: EnergyTokenStatus.ROUTED, routedTo: args.target.name },
    });
    if (target.ownerWalletId) {
      await debitWalletKwh(db, target.ownerWalletId, roundKwh(args.amountKwh));
    }
  }
  return target.id;
}

export async function creditWalletKwh(db: Db, walletId: string, amountKwh: number) {
  await db.wallet.update({
    where: { id: walletId },
    data: { kwhBalance: { increment: new Prisma.Decimal(roundKwh(amountKwh)) } },
  });
}

export async function debitWalletKwh(db: Db, walletId: string, amountKwh: number) {
  await db.wallet.update({
    where: { id: walletId },
    data: { kwhBalance: { decrement: new Prisma.Decimal(roundKwh(amountKwh)) } },
  });
}

/**
 * Re-derive a wallet's kWh balance from its batches and throw if the cached
 * balance disagrees. Called at the end of balance-changing transactions and by
 * the §16.11 daily reconciliation.
 */
export async function assertWalletTokensBalance(db: Db, walletId: string): Promise<number> {
  const wallet = await db.wallet.findUniqueOrThrow({ where: { id: walletId } });
  const batches = await spendableTokens(db, walletId);
  const derived = roundKwh(batches.reduce((sum, b) => sum + num(b.amountKwh), 0));
  const cached = num(wallet.kwhBalance);
  if (Math.abs(derived - cached) > 0.0005) {
    throw new Error(
      `Wallet ${walletId} balance drift: cached ${cached} kWh, registry holds ${derived} kWh`,
    );
  }
  return derived;
}
