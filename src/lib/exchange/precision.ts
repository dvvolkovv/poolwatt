// Fixed-point scales mandated by ТЗ §16.1 and §17.
//
// All exchange domain logic runs on plain numbers and rounds at these
// boundaries; Prisma stores the results in Decimal columns of the matching
// scale (kWh 18,3 · price 12,4 · money 18,2). Rounding at every boundary is
// what keeps "1 токен = 1 кВт·ч, точность 0,001" true end to end — a kWh
// amount that never leaves the 0.001 grid can never create or destroy a
// fraction of a token during a split, a fill or a burn.

/** Smallest tradable quantity: 0.001 kWh (ТЗ §16.1). */
export const KWH_STEP = 0.001;

export const KWH_SCALE = 3;
export const PRICE_SCALE = 4;
export const MONEY_SCALE = 2;

function roundTo(value: number, scale: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Cannot round non-finite value: ${value}`);
  }
  // Scale → round-half-away-from-zero → unscale. Math.round() alone rounds
  // -0.5 up to -0, which would silently shrink debits.
  const factor = 10 ** scale;
  const scaled = value * factor;
  // Nudge by one ULP-ish epsilon so that values like 1.005 * 100 = 100.49999
  // land on 100.5 instead of 100.
  const corrected = Math.abs(scaled) + Number.EPSILON * Math.abs(scaled);
  const rounded = Math.round(corrected) * Math.sign(scaled);
  return rounded / factor;
}

/** Round a kWh quantity to the 0.001 token grid. */
export function roundKwh(value: number): number {
  return roundTo(value, KWH_SCALE);
}

/** Round a per-kWh price to 4 decimals. */
export function roundPrice(value: number): number {
  return roundTo(value, PRICE_SCALE);
}

/** Round a fiat amount to minor units. */
export function roundMoney(value: number): number {
  return roundTo(value, MONEY_SCALE);
}

/**
 * Round a kWh quantity *down* to the token grid. Used wherever handing out a
 * rounded-up amount would mean inventing energy that was never metered —
 * matching fills, token splits, storage intake.
 */
export function floorKwh(value: number): number {
  const factor = 10 ** KWH_SCALE;
  return Math.floor(roundTo(value * factor, 6)) / factor;
}

/**
 * Round a kWh quantity *up* to the token grid. Used wherever handing out a
 * rounded-down amount would mean giving away energy nobody paid for — a
 * roaming conversion debit, a clearing fee.
 */
export function ceilKwh(value: number): number {
  const factor = 10 ** KWH_SCALE;
  return Math.ceil(roundTo(value * factor, 6)) / factor;
}

/** Round a fiat amount *up*: authorization holds must never under-cover. */
export function ceilMoney(value: number): number {
  const factor = 10 ** MONEY_SCALE;
  return Math.ceil(roundTo(value * factor, 6)) / factor;
}

/** Notional value of a fill, in fiat minor units (kWh × price per kWh). */
export function notional(amountKwh: number, pricePerKwh: number): number {
  return roundMoney(roundKwh(amountKwh) * roundPrice(pricePerKwh));
}

/** True when two kWh amounts are equal on the 0.001 grid. */
export function kwhEquals(a: number, b: number): boolean {
  return Math.abs(roundKwh(a) - roundKwh(b)) < KWH_STEP / 2;
}

/** True when a kWh amount is zero (or dust below the grid). */
export function isKwhDust(value: number): boolean {
  return Math.abs(value) < KWH_STEP / 2;
}
