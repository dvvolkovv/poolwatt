// Who gets told what, when something actually happened — ТЗ §15, US-17.
//
// Kept apart from realtime.ts (which only knows channels and the bus) and
// from the services (which only know the business rules). Every function here
// is called *after* its transaction has committed: a page told about a trade
// that then rolls back would show money that does not exist.
//
// Nothing here throws. The services are the system of record; this is a
// courtesy to pages that happen to be open.

import { prisma } from "@/lib/prisma";
import {
  orderbookChannel,
  publish,
  telemetryChannel,
  tradesChannel,
  walletChannel,
} from "./realtime";
import { readWallets } from "./wallet-service";

/** US-17 — "баланс кВт·ч и денег" on an open page, without a reload. */
export async function notifyWallets(userIds: Iterable<string>): Promise<void> {
  const seen = new Set<string>();
  for (const userId of userIds) {
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    try {
      const wallets = await readWallets(userId);
      await publish(walletChannel(userId), "wallet.updated", { wallets });
    } catch {
      // A page that misses this still shows correct data on its next load.
    }
  }
}

/** The owners of the wallets on both sides of these trades. */
async function tradeParticipants(tradeIds: string[]): Promise<string[]> {
  if (tradeIds.length === 0) return [];
  try {
    const trades = await prisma.trade.findMany({
      where: { id: { in: tradeIds } },
      select: {
        buyOrder: { select: { wallet: { select: { ownerUserId: true } } } },
        sellOrder: { select: { wallet: { select: { ownerUserId: true } } } },
      },
    });
    return trades.flatMap((t) => [
      t.buyOrder.wallet.ownerUserId,
      t.sellOrder.wallet.ownerUserId,
    ]);
  } catch {
    return [];
  }
}

/**
 * An order touched the book: the terminal's book and tape move, and so do the
 * balances of everyone whose order was filled — not only the caller's.
 */
export async function notifyOrder(args: {
  zoneCode: string;
  intervalStart: Date | null;
  userId: string;
  tradeIds?: string[];
  filledKwh?: number;
  avgPrice?: number | null;
}): Promise<void> {
  const tradeIds = args.tradeIds ?? [];
  await publish(orderbookChannel(args.zoneCode), "orderbook.changed", {
    intervalStart: args.intervalStart?.toISOString() ?? null,
  });
  if (tradeIds.length > 0) {
    await publish(tradesChannel(args.zoneCode), "trades.executed", {
      tradeIds,
      filledKwh: args.filledKwh ?? 0,
      avgPrice: args.avgPrice ?? null,
      intervalStart: args.intervalStart?.toISOString() ?? null,
    });
  }
  await notifyWallets([args.userId, ...(await tradeParticipants(tradeIds))]);
}

/** US-03, US-26 — a reading arrived and possibly minted. */
export async function notifyTelemetry(args: {
  assetId: string;
  ownerUserId?: string | null;
  accepted: number;
  minted: number;
  mintedKwh: number;
  lastIntervalStart?: string | null;
}): Promise<void> {
  await publish(telemetryChannel(args.assetId), "telemetry.ingested", {
    accepted: args.accepted,
    minted: args.minted,
    mintedKwh: args.mintedKwh,
    lastIntervalStart: args.lastIntervalStart ?? null,
  });
  if (args.ownerUserId && args.mintedKwh > 0) await notifyWallets([args.ownerUserId]);
}
