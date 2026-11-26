// §22.3 "история операций с фильтром" — одна лента на четыре таблицы.
//
// Знак кВт·ч здесь — «как операцию читает человек», а не проводка по
// балансу: у зарядки часть кВт·ч могла быть докуплена в тот же миг, и
// точную разбивку §16.6 даёт чек, который открывается из строки. Не
// считайте по этой ленте баланс — для этого есть `Wallet` и реестр партий.
//
// В ленту попадает только то, что случилось: платёж в статусе INITIATED или
// AUTHORIZED ещё не произошёл, отменённый перевод не произошёл тоже.
//
// Подарок §43 в ленте есть, но в `Wallet.kwhBalance` его нет — энергию под
// него даёт кошелёк партнёра. Поэтому `fiat` у подарка нулевой, а экран
// показывает подарки ещё и отдельным блоком.

import { prisma } from "@/lib/prisma";
import type { Db } from "./audit";
import { num } from "./decimal";
import { roundKwh, roundMoney, roundPrice } from "./precision";

export type WalletHistoryKind =
  | "BUY"
  | "SELL"
  | "CHARGE"
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "GIFT";

export const ALL_HISTORY_KINDS: WalletHistoryKind[] = [
  "BUY",
  "SELL",
  "CHARGE",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "GIFT",
];

export interface WalletHistoryEntry {
  /** `<kind>:<sourceId>` — две таблицы могут выдать один и тот же cuid. */
  id: string;
  kind: WalletHistoryKind;
  at: Date;
  kwh: number;
  fiat: number;
  currency: string | null;
  zoneCode: string | null;
  receiptId: string | null;
  /** Пункт, ник второй стороны или название сети подарка. */
  title: string | null;
}

export interface WalletHistoryQuery {
  kinds?: WalletHistoryKind[];
  limit?: number;
}

const DEFAULT_LIMIT = 50;

export async function readWalletHistory(
  userId: string,
  query: WalletHistoryQuery = {},
  db: Db = prisma,
): Promise<WalletHistoryEntry[]> {
  const kinds = new Set(query.kinds ?? ALL_HISTORY_KINDS);
  const limit = query.limit ?? DEFAULT_LIMIT;

  const wallets = await db.wallet.findMany({
    where: { ownerUserId: userId },
    select: { id: true },
  });
  const walletIds = wallets.map((w) => w.id);
  const mine = new Set(walletIds);

  const entries: WalletHistoryEntry[] = [];

  // Каждая выборка берёт `limit` — после склейки лишнее отрезается, и ни
  // один вид не может вытеснить остальные из начала ленты.
  if (walletIds.length > 0 && (kinds.has("BUY") || kinds.has("SELL"))) {
    const trades = await db.trade.findMany({
      where: {
        OR: [
          ...(kinds.has("BUY") ? [{ buyOrder: { walletId: { in: walletIds } } }] : []),
          ...(kinds.has("SELL") ? [{ sellOrder: { walletId: { in: walletIds } } }] : []),
        ],
      },
      orderBy: { executedAt: "desc" },
      take: limit,
      select: {
        id: true,
        amountKwh: true,
        price: true,
        buyerFee: true,
        sellerFee: true,
        executedAt: true,
        buyOrder: { select: { walletId: true } },
        sellOrder: { select: { walletId: true } },
        zone: { select: { code: true, currency: true } },
        receipt: { select: { id: true } },
      },
    });

    for (const trade of trades) {
      const amount = num(trade.amountKwh);
      const notional = amount * num(trade.price);
      // Сделка сама с собой невозможна: одна заявка — один кошелёк, и
      // матчинг не сводит две заявки одного кошелька.
      const isBuy = mine.has(trade.buyOrder.walletId);
      const kind: WalletHistoryKind = isBuy ? "BUY" : "SELL";
      if (!kinds.has(kind)) continue;
      entries.push({
        id: `${kind}:${trade.id}`,
        kind,
        at: trade.executedAt,
        kwh: roundKwh(isBuy ? amount : -amount),
        fiat: roundMoney(
          isBuy ? -(notional + num(trade.buyerFee)) : notional - num(trade.sellerFee),
        ),
        currency: trade.zone.currency,
        zoneCode: trade.zone.code,
        receiptId: trade.receipt?.id ?? null,
        title: null,
      });
    }
  }

  if (walletIds.length > 0 && kinds.has("CHARGE")) {
    const payments = await db.payment.findMany({
      where: { walletId: { in: walletIds }, status: "CAPTURED" },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        requestedKwh: true,
        amountFiat: true,
        createdAt: true,
        capturedAt: true,
        zone: { select: { code: true, currency: true } },
        point: { select: { name: true } },
        receipt: { select: { id: true } },
      },
    });
    for (const payment of payments) {
      entries.push({
        id: `CHARGE:${payment.id}`,
        kind: "CHARGE",
        at: payment.capturedAt ?? payment.createdAt,
        kwh: roundKwh(-num(payment.requestedKwh)),
        fiat: roundMoney(-num(payment.amountFiat)),
        currency: payment.zone.currency,
        zoneCode: payment.zone.code,
        receiptId: payment.receipt?.id ?? null,
        title: payment.point?.name ?? null,
      });
    }
  }

  if (walletIds.length > 0 && (kinds.has("TRANSFER_IN") || kinds.has("TRANSFER_OUT"))) {
    const transfers = await db.tokenTransfer.findMany({
      where: {
        status: "CONFIRMED",
        OR: [
          ...(kinds.has("TRANSFER_OUT") ? [{ fromWalletId: { in: walletIds } }] : []),
          ...(kinds.has("TRANSFER_IN") ? [{ toWalletId: { in: walletIds } }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        amountKwh: true,
        createdAt: true,
        confirmedAt: true,
        fromWalletId: true,
        zone: { select: { code: true, currency: true } },
        fromWallet: { select: { owner: { select: { username: true } } } },
        toWallet: { select: { owner: { select: { username: true } } } },
      },
    });

    for (const transfer of transfers) {
      const outgoing = mine.has(transfer.fromWalletId);
      const kind: WalletHistoryKind = outgoing ? "TRANSFER_OUT" : "TRANSFER_IN";
      if (!kinds.has(kind)) continue;
      const amount = num(transfer.amountKwh);
      entries.push({
        id: `${kind}:${transfer.id}`,
        kind,
        at: transfer.confirmedAt ?? transfer.createdAt,
        kwh: roundKwh(outgoing ? -amount : amount),
        fiat: 0,
        currency: transfer.zone.currency,
        zoneCode: transfer.zone.code,
        receiptId: null,
        title: outgoing
          ? transfer.toWallet.owner.username
          : transfer.fromWallet.owner.username,
      });
    }
  }

  if (kinds.has("GIFT")) {
    const grants = await db.promoGrant.findMany({
      where: { userId },
      orderBy: { issuedAt: "desc" },
      take: limit,
      select: {
        id: true,
        amountKwh: true,
        issuedAt: true,
        operator: { select: { displayName: true } },
      },
    });
    for (const grant of grants) {
      entries.push({
        id: `GIFT:${grant.id}`,
        kind: "GIFT",
        at: grant.issuedAt,
        kwh: roundKwh(num(grant.amountKwh)),
        fiat: 0,
        currency: null,
        zoneCode: null,
        receiptId: null,
        title: grant.operator.displayName,
      });
    }
  }

  entries.sort((a, b) => b.at.getTime() - a.at.getTime());
  return entries.slice(0, limit);
}

export interface PurchaseStats {
  /** Средневзвешенная цена покупки, §22.3. Null до первой покупки. */
  avgPrice: number | null;
  boughtKwh: number;
}

export async function readPurchaseStats(
  userId: string,
  db: Db = prisma,
): Promise<PurchaseStats> {
  const buys = await db.trade.findMany({
    where: { buyOrder: { wallet: { ownerUserId: userId } } },
    select: { amountKwh: true, price: true },
  });
  const boughtKwh = buys.reduce((sum, b) => sum + num(b.amountKwh), 0);
  const boughtValue = buys.reduce((sum, b) => sum + num(b.amountKwh) * num(b.price), 0);
  return {
    boughtKwh: roundKwh(boughtKwh),
    avgPrice: boughtKwh > 0 ? roundPrice(boughtValue / boughtKwh) : null,
  };
}
