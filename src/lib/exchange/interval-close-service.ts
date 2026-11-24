// Interval close — ТЗ §6 ("Нераспроданные за интервал токены автоматически
// передаются агрегатору… или на зарядку накопителей"), §12 (US-09), §16.4.
//
// Runs once per settlement interval per zone, from the worker. Expires the
// resting orders of the closed interval, then routes whatever kWh went unsold:
// cooperative storage first, the aggregator for the rest.

import { AssetKind, AssetStatus, EnergyTokenStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "./audit";
import { num } from "./decimal";
import { freeStorageKwh } from "./asset-service";
import { expireOrdersForInterval } from "./order-service";
import { roundKwh } from "./precision";
import { planIntervalRouting, type StorageSlot, type UnsoldToken } from "./routing";
import { routeTokens } from "./token-registry";

export interface CloseIntervalResult {
  zoneId: string;
  intervalStart: string;
  expiredOrders: number;
  unsoldKwh: number;
  storedKwh: number;
  routedKwh: number;
  allocations: number;
}

export async function closeInterval(
  zoneId: string,
  intervalStart: Date,
): Promise<CloseIntervalResult> {
  const zone = await prisma.gridZone.findUniqueOrThrow({ where: { id: zoneId } });
  const expiredOrders = await expireOrdersForInterval(zoneId, intervalStart);

  const unsold = await prisma.energyToken.findMany({
    where: { zoneId, intervalStart, status: EnergyTokenStatus.AVAILABLE },
    orderBy: { mintedAt: "asc" },
    select: { id: true, amountKwh: true },
  });
  const tokens: UnsoldToken[] = unsold.map((t) => ({
    id: t.id,
    amountKwh: num(t.amountKwh),
  }));
  const unsoldKwh = roundKwh(tokens.reduce((sum, t) => sum + t.amountKwh, 0));

  // §16.4 — cooperative storage in the same zone takes priority. Emptiest
  // first, so charge spreads across the fleet instead of topping one bank up.
  const storages = await prisma.asset.findMany({
    where: {
      gridZoneId: zoneId,
      status: AssetStatus.ACTIVE,
      kind: { in: [AssetKind.STORAGE, AssetKind.MIXED] },
    },
    select: { id: true, storageKwh: true, storedKwh: true },
  });
  const slots: StorageSlot[] = storages
    .map((a) => ({ assetId: a.id, freeKwh: freeStorageKwh(a) }))
    .filter((s) => s.freeKwh > 0)
    .sort((a, b) => b.freeKwh - a.freeKwh);

  const plan = planIntervalRouting(tokens, slots);

  await prisma.$transaction(async (tx) => {
    for (const alloc of plan.toStorage) {
      await routeTokens(tx, {
        tokenId: alloc.tokenId,
        amountKwh: alloc.amountKwh,
        target: { kind: "storage", assetId: alloc.assetId },
      });
    }
    for (const alloc of plan.toAggregator) {
      await routeTokens(tx, {
        tokenId: alloc.tokenId,
        amountKwh: alloc.amountKwh,
        target: { kind: "aggregator", name: zone.aggregatorName ?? "external-market" },
      });
    }
    if (plan.toStorage.length + plan.toAggregator.length > 0) {
      await writeAudit(tx, {
        actor: "system",
        entity: "GridZone",
        entityId: zoneId,
        action: "interval.closed",
        after: {
          intervalStart: intervalStart.toISOString(),
          expiredOrders,
          unsoldKwh,
          storedKwh: plan.storedKwh,
          routedKwh: plan.routedKwh,
        },
      });
    }
  }, { timeout: 30_000 });

  return {
    zoneId,
    intervalStart: intervalStart.toISOString(),
    expiredOrders,
    unsoldKwh,
    storedKwh: plan.storedKwh,
    routedKwh: plan.routedKwh,
    allocations: plan.toStorage.length + plan.toAggregator.length,
  };
}

/**
 * §16.11 — daily reconciliation of the token registry against wallet balances.
 * Reports drift instead of fixing it: a mismatch is a bug to investigate, not
 * a number to overwrite.
 */
export async function reconcileWalletBalances(): Promise<
  { walletId: string; cachedKwh: number; registryKwh: number; driftKwh: number }[]
> {
  const wallets = await prisma.wallet.findMany({ select: { id: true, kwhBalance: true } });
  const drifts: { walletId: string; cachedKwh: number; registryKwh: number; driftKwh: number }[] =
    [];

  for (const wallet of wallets) {
    const batches = await prisma.energyToken.findMany({
      where: {
        ownerWalletId: wallet.id,
        status: {
          in: [EnergyTokenStatus.AVAILABLE, EnergyTokenStatus.SOLD, EnergyTokenStatus.STORED],
        },
      },
      select: { amountKwh: true },
    });
    const registryKwh = roundKwh(batches.reduce((sum, b) => sum + num(b.amountKwh), 0));
    const cachedKwh = num(wallet.kwhBalance);
    const driftKwh = roundKwh(cachedKwh - registryKwh);
    if (Math.abs(driftKwh) > 0.0005) {
      drifts.push({ walletId: wallet.id, cachedKwh, registryKwh, driftKwh });
    }
  }
  return drifts;
}
