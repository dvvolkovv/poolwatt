// Wallets — ТЗ §7 "Кошелёк кВт·ч" and §21 (fiat side of the same wallet).

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Db } from "./audit";
import { writeAudit } from "./audit";
import { num } from "./decimal";
import { roundMoney } from "./precision";

/**
 * One wallet per (user, zone) — created on first use. A user charging in a new
 * country gets a wallet there automatically; moving kWh between the two is a
 * roaming settlement (§11 US-11), not a balance edit.
 */
export async function getOrCreateWallet(userId: string, zoneId: string, db: Db = prisma) {
  const existing = await db.wallet.findUnique({
    where: { ownerUserId_zoneId: { ownerUserId: userId, zoneId } },
  });
  if (existing) return existing;

  const zone = await db.gridZone.findUniqueOrThrow({ where: { id: zoneId } });
  return db.wallet.create({
    data: { ownerUserId: userId, zoneId, currency: zone.currency },
  });
}

export interface WalletView {
  id: string;
  zoneId: string;
  zoneCode: string;
  currency: string;
  kwhBalance: number;
  fiatBalance: number;
  reservedFiat: number;
  availableFiat: number;
}

export async function readWallets(userId: string, db: Db = prisma): Promise<WalletView[]> {
  const wallets = await db.wallet.findMany({
    where: { ownerUserId: userId },
    include: { zone: { select: { code: true } } },
    orderBy: { createdAt: "asc" },
  });
  return wallets.map((w) => ({
    id: w.id,
    zoneId: w.zoneId,
    zoneCode: w.zone.code,
    currency: w.currency,
    kwhBalance: num(w.kwhBalance),
    fiatBalance: num(w.fiatBalance),
    reservedFiat: num(w.reservedFiat),
    availableFiat: roundMoney(num(w.fiatBalance) - num(w.reservedFiat)),
  }));
}

/** Fiat available to spend — reserved funds back open BUY orders (US-06). */
export function availableFiat(wallet: { fiatBalance: unknown; reservedFiat: unknown }): number {
  return roundMoney(num(wallet.fiatBalance as never) - num(wallet.reservedFiat as never));
}

/** Top up the fiat balance (SEPA credit on the personal IBAN, §21). */
export async function creditFiat(
  db: Db,
  walletId: string,
  amount: number,
  reason: string,
  actor = "system",
) {
  const value = roundMoney(amount);
  if (!(value > 0)) throw new RangeError(`Credit must be positive, got ${amount}`);
  const before = await db.wallet.findUniqueOrThrow({ where: { id: walletId } });
  const after = await db.wallet.update({
    where: { id: walletId },
    data: { fiatBalance: { increment: new Prisma.Decimal(value) } },
  });
  await writeAudit(db, {
    actor,
    entity: "Wallet",
    entityId: walletId,
    action: `fiat.credit:${reason}`,
    before: { fiatBalance: num(before.fiatBalance) },
    after: { fiatBalance: num(after.fiatBalance) },
  });
  return after;
}

export async function debitFiat(
  db: Db,
  walletId: string,
  amount: number,
  reason: string,
  actor = "system",
) {
  const value = roundMoney(amount);
  if (!(value > 0)) throw new RangeError(`Debit must be positive, got ${amount}`);
  const before = await db.wallet.findUniqueOrThrow({ where: { id: walletId } });
  const after = await db.wallet.update({
    where: { id: walletId },
    data: { fiatBalance: { decrement: new Prisma.Decimal(value) } },
  });
  await writeAudit(db, {
    actor,
    entity: "Wallet",
    entityId: walletId,
    action: `fiat.debit:${reason}`,
    before: { fiatBalance: num(before.fiatBalance) },
    after: { fiatBalance: num(after.fiatBalance) },
  });
  return after;
}
