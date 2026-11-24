// Price corridor — ТЗ §16.5: "цена сделки не дальше ±X % от спотового
// ориентира зоны (X настраивается оператором)".
//
// The corridor is the platform's only anti-manipulation guard on price, so it
// is enforced twice: once when an order is accepted (a limit price outside the
// corridor is rejected outright) and once per fill inside the matching engine
// (a resting order whose price has drifted outside the corridor is skipped
// rather than traded against — the spot reference moves, resting orders do not).

import { roundPrice } from "./precision";

export interface Corridor {
  /** Zone spot reference. null = no reference published yet. */
  spotPrice: number | null;
  /** Half-width of the corridor in percent. null = corridor disabled. */
  corridorPct: number | null;
}

export interface CorridorBounds {
  min: number;
  max: number;
}

/**
 * Resolve the corridor to absolute bounds, or null when it cannot be applied
 * (no spot reference, no percentage, or a non-positive spot price).
 *
 * §18 leaves X unset per zone; an unconfigured corridor must not block
 * trading, so "cannot be applied" means "no constraint", not "reject all".
 */
export function corridorBounds(c: Corridor): CorridorBounds | null {
  const { spotPrice, corridorPct } = c;
  if (spotPrice == null || corridorPct == null) return null;
  if (!(spotPrice > 0) || !(corridorPct > 0)) return null;
  const delta = (spotPrice * corridorPct) / 100;
  return { min: roundPrice(spotPrice - delta), max: roundPrice(spotPrice + delta) };
}

/** True when `price` may be traded at in this zone. */
export function isPriceInCorridor(price: number, c: Corridor): boolean {
  const bounds = corridorBounds(c);
  if (!bounds) return true;
  const p = roundPrice(price);
  return p >= bounds.min && p <= bounds.max;
}

/** Human-readable rejection reason, for Order.rejectReason. */
export function corridorRejectReason(price: number, c: Corridor): string | null {
  const bounds = corridorBounds(c);
  if (!bounds) return null;
  const p = roundPrice(price);
  if (p >= bounds.min && p <= bounds.max) return null;
  return `Price ${p} is outside the zone corridor ${bounds.min}..${bounds.max} (spot ${c.spotPrice}, ±${c.corridorPct}%)`;
}
