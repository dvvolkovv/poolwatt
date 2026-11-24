// Interval-close routing — ТЗ §16.4: "непроданные токены маршрутизируются:
// сначала в свободную ёмкость накопителей кооператива зоны, остальное
// агрегатору на внешний рынок".
//
// Pure planner: it decides where each unsold batch goes and how batches have
// to be split to fit the free storage capacity. The caller applies the plan
// inside a transaction, moving tokens to STORED or ROUTED (§14).

import { floorKwh, isKwhDust, roundKwh } from "./precision";

export interface UnsoldToken {
  id: string;
  amountKwh: number;
}

export interface StorageSlot {
  assetId: string;
  /** Free capacity right now: storageKwh − storedKwh. */
  freeKwh: number;
}

export interface StorageAllocation {
  tokenId: string;
  assetId: string;
  amountKwh: number;
}

export interface AggregatorAllocation {
  tokenId: string;
  amountKwh: number;
}

export interface RoutingPlan {
  toStorage: StorageAllocation[];
  toAggregator: AggregatorAllocation[];
  /** Free capacity left per storage asset after the plan. */
  remainingCapacity: Record<string, number>;
  storedKwh: number;
  routedKwh: number;
}

/**
 * Plan where the unsold tokens of one closed interval go.
 *
 * Storage is filled in the order given — the caller decides the preference
 * (nearest, emptiest, cooperative-owned first). A batch larger than the
 * remaining free capacity is split: part is stored, the rest continues to the
 * next slot and finally to the aggregator.
 */
export function planIntervalRouting(
  tokens: readonly UnsoldToken[],
  storages: readonly StorageSlot[],
): RoutingPlan {
  const capacity = new Map<string, number>();
  for (const s of storages) {
    const free = Math.max(0, floorKwh(s.freeKwh));
    // A zone can hold several slots for the same asset; sum them.
    capacity.set(s.assetId, roundKwh((capacity.get(s.assetId) ?? 0) + free));
  }
  const order = storages.map((s) => s.assetId).filter((id, i, arr) => arr.indexOf(id) === i);

  const toStorage: StorageAllocation[] = [];
  const toAggregator: AggregatorAllocation[] = [];
  let storedKwh = 0;
  let routedKwh = 0;

  for (const token of tokens) {
    let left = roundKwh(token.amountKwh);
    if (left <= 0 || isKwhDust(left)) continue;

    for (const assetId of order) {
      if (isKwhDust(left)) break;
      const free = capacity.get(assetId) ?? 0;
      if (isKwhDust(free)) continue;

      const take = floorKwh(Math.min(left, free));
      if (isKwhDust(take)) continue;

      toStorage.push({ tokenId: token.id, assetId, amountKwh: take });
      capacity.set(assetId, roundKwh(free - take));
      storedKwh = roundKwh(storedKwh + take);
      left = roundKwh(left - take);
    }

    if (!isKwhDust(left)) {
      toAggregator.push({ tokenId: token.id, amountKwh: left });
      routedKwh = roundKwh(routedKwh + left);
    }
  }

  return {
    toStorage,
    toAggregator,
    remainingCapacity: Object.fromEntries(capacity),
    storedKwh,
    routedKwh,
  };
}
