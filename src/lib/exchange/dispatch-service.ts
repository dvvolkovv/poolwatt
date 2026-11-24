// The sale dispatcher — ТЗ §30 "Правила продажи", US-28.
//
// Sale rules were stored and never read: nothing placed a sell order on a
// producer's behalf, so minted kWh sat in the wallet until the owner opened
// the terminal. This runs once per closed interval per zone and offers the
// market share of what that interval minted.
//
// The offer is a spot order (no interval pin). Energy is minted from a
// reading that only arrives after its interval has ended, so an order pinned
// to that interval would be expired the moment it was placed; §16.3 ties a
// batch to its interval, and a spot order trades against any of them.
//
// Rules are read at the moment of the run, which is what US-28 means by
// "применяются со следующего интервала": a change made now leaves a standing
// offer alone and governs the next interval's.

import {
  AssetKind,
  AssetStatus,
  EnergyTokenStatus,
  OrderSide,
  OrderStatus,
  OrderType,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "./audit";
import { num, numOrNull } from "./decimal";
import { splitMint } from "./minting";
import { OrderRejected, cancelOrder, placeOrder } from "./order-service";
import { floorKwh, isKwhDust, roundKwh } from "./precision";
import { routeTokens } from "./token-registry";

export interface DispatchOffer {
  assetId: string;
  assetName: string;
  /** kWh held back to reach the charge reserve before anything is sold. */
  toReserveKwh: number;
  offeredKwh: number;
  price: number | null;
  orderId: string | null;
  /** True when the deterministic key returned an offer placed earlier. */
  replay: boolean;
  rejectReason: string | null;
}

export interface DispatchResult {
  zoneId: string;
  intervalStart: string;
  offers: DispatchOffer[];
  offeredKwh: number;
}

/** How much a storage asset must hold back — §30 "резерв заряда". */
export function reserveShortfallKwh(asset: {
  kind: AssetKind;
  storageKwh: unknown;
  storedKwh: unknown;
  reserveSocPct: number;
}): number {
  if (asset.kind !== AssetKind.STORAGE && asset.kind !== AssetKind.MIXED) return 0;
  const capacity = numOrNull(asset.storageKwh as never) ?? 0;
  if (!(capacity > 0) || !(asset.reserveSocPct > 0)) return 0;
  const want = roundKwh((capacity * asset.reserveSocPct) / 100);
  return Math.max(0, roundKwh(want - num(asset.storedKwh as never)));
}

/** The key an offer carries, so a re-run finds its own work. */
export function dispatchKey(assetId: string, intervalStart: Date): string {
  return `dispatch:${assetId}:${intervalStart.toISOString()}`;
}

/**
 * Take down the offers made for an earlier interval that nobody took.
 *
 * An offer lives exactly one interval. What it was holding goes back to being
 * plain unsold energy, which is what §16.4 then routes to storage or the
 * aggregator — the dispatcher delays that by one interval, it does not cancel
 * it.
 */
export async function withdrawStaleOffers(
  zoneId: string,
  intervalStart: Date,
): Promise<number> {
  const stale = await prisma.order.findMany({
    where: {
      zoneId,
      side: OrderSide.SELL,
      status: { in: [OrderStatus.NEW, OrderStatus.PARTIALLY_FILLED] },
      idempotencyKey: { startsWith: "dispatch:", endsWith: `:${intervalStart.toISOString()}` },
    },
    select: { id: true, wallet: { select: { ownerUserId: true } } },
  });

  let withdrawn = 0;
  for (const order of stale) {
    try {
      await cancelOrder(order.id, order.wallet.ownerUserId);
      withdrawn += 1;
    } catch {
      // Filled or cancelled between the read and here: nothing to do.
    }
  }
  return withdrawn;
}

export async function dispatchZone(zoneId: string, intervalStart: Date): Promise<DispatchResult> {
  const zone = await prisma.gridZone.findUniqueOrThrow({ where: { id: zoneId } });
  const spot = numOrNull(zone.spotPrice);

  const assets = await prisma.asset.findMany({
    where: { gridZoneId: zoneId, status: AssetStatus.ACTIVE },
    orderBy: { createdAt: "asc" },
  });

  const offers: DispatchOffer[] = [];

  for (const asset of assets) {
    const batches = await prisma.energyToken.findMany({
      where: {
        assetId: asset.id,
        intervalStart,
        status: EnergyTokenStatus.AVAILABLE,
        ownerWalletId: { not: null },
      },
      orderBy: { mintedAt: "asc" },
    });
    const mintedKwh = roundKwh(batches.reduce((sum, b) => sum + num(b.amountKwh), 0));
    if (isKwhDust(mintedKwh)) continue;

    const owner = await prisma.wallet.findUniqueOrThrow({
      where: { id: batches[0].ownerWalletId! },
      select: { ownerUserId: true },
    });

    const split = splitMint(mintedKwh, {
      toMarketPct: asset.shareToMarketPct,
      toStoragePct: asset.shareToStoragePct,
      toSelfPct: asset.shareToSelfPct,
    });

    // The emergency reserve comes first: a bank that is short charges out of
    // what it would otherwise have sold.
    const shortfall = reserveShortfallKwh(asset);
    const toReserveKwh = floorKwh(Math.min(shortfall, split.toMarketKwh));
    if (toReserveKwh > 0) await storeForReserve(asset.id, batches, toReserveKwh);

    const offeredKwh = roundKwh(split.toMarketKwh - toReserveKwh);
    if (isKwhDust(offeredKwh)) {
      offers.push({
        assetId: asset.id,
        assetName: asset.name,
        toReserveKwh,
        offeredKwh: 0,
        price: null,
        orderId: null,
        replay: false,
        rejectReason: null,
      });
      continue;
    }

    const price = numOrNull(asset.minSalePrice) ?? spot;
    if (price == null || !(price > 0)) {
      offers.push({
        assetId: asset.id,
        assetName: asset.name,
        toReserveKwh,
        offeredKwh: 0,
        price: null,
        orderId: null,
        replay: false,
        rejectReason: "No minimum price and no spot reference for the zone",
      });
      continue;
    }

    offers.push(
      await offerToMarket({
        asset,
        userId: owner.ownerUserId,
        zoneId,
        intervalStart,
        amountKwh: offeredKwh,
        price,
        toReserveKwh,
      }),
    );
  }

  const offeredKwh = roundKwh(offers.reduce((sum, o) => sum + o.offeredKwh, 0));

  if (offers.length > 0) {
    await writeAudit(prisma, {
      actor: "system",
      entity: "GridZone",
      entityId: zoneId,
      action: "dispatch.ran",
      after: {
        intervalStart: intervalStart.toISOString(),
        assets: offers.length,
        offeredKwh,
      },
    });
  }

  return { zoneId, intervalStart: intervalStart.toISOString(), offers, offeredKwh };
}

/** Charge the asset's own bank from the batches it just minted. */
async function storeForReserve(
  assetId: string,
  batches: { id: string; amountKwh: Prisma.Decimal }[],
  amountKwh: number,
): Promise<void> {
  let left = roundKwh(amountKwh);
  await prisma.$transaction(async (tx) => {
    for (const batch of batches) {
      if (isKwhDust(left)) break;
      const take = floorKwh(Math.min(left, num(batch.amountKwh)));
      if (isKwhDust(take)) continue;
      await routeTokens(tx, {
        tokenId: batch.id,
        amountKwh: take,
        target: { kind: "storage", assetId },
      });
      left = roundKwh(left - take);
    }
    await writeAudit(tx, {
      actor: "system",
      entity: "Asset",
      entityId: assetId,
      action: "dispatch.reserve.charged",
      after: { amountKwh: roundKwh(amountKwh - left) },
    });
  });
}

async function offerToMarket(args: {
  asset: { id: string; name: string };
  userId: string;
  zoneId: string;
  intervalStart: Date;
  amountKwh: number;
  price: number;
  toReserveKwh: number;
}): Promise<DispatchOffer> {
  const base = {
    assetId: args.asset.id,
    assetName: args.asset.name,
    toReserveKwh: args.toReserveKwh,
  };
  try {
    const placed = await placeOrder({
      userId: args.userId,
      zoneId: args.zoneId,
      side: OrderSide.SELL,
      type: OrderType.LIMIT,
      amountKwh: args.amountKwh,
      limitPrice: args.price,
      intervalStart: null,
      // One offer per asset per interval, however many times the worker runs.
      idempotencyKey: dispatchKey(args.asset.id, args.intervalStart),
    });
    return {
      ...base,
      offeredKwh: placed.rejectReason ? 0 : args.amountKwh,
      price: args.price,
      orderId: placed.orderId,
      replay: placed.idempotentReplay,
      rejectReason: placed.rejectReason,
    };
  } catch (err) {
    // A rule the market will not take — a price outside the corridor, or no
    // tokens left to deliver — is the producer's business, not a crash.
    return {
      ...base,
      offeredKwh: 0,
      price: args.price,
      orderId: null,
      replay: false,
      rejectReason: err instanceof OrderRejected ? err.reason : String(err),
    };
  }
}
