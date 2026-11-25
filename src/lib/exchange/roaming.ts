// Roaming conversion — ТЗ §8 ("пользователь, купивший кВт·ч в одной стране,
// может использовать их в другой; клиринговый сервис закрывает разницу между
// зонами"), US-11 ("пользователь видит курс пересчёта до подтверждения") and
// §24 ("межзональный перевод — через правила роуминга").
//
// A kWh is not fungible across zones: a kWh bought where energy is cheap buys
// less than a kWh where it is expensive. The corridor between two zones is
// therefore priced off their spot references, plus the clearing partner's fee.
// Everything here is pure arithmetic — the quote the user confirms is computed
// the same way the debit is later applied.

import { KWH_STEP, ceilKwh, floorKwh, roundKwh, roundPrice } from "./precision";

export interface RoamingQuoteInput {
  /** kWh the user wants to consume in the visited zone. */
  amountKwh: number;
  /** Spot reference of the zone holding the balance. */
  homeSpotPrice: number | null;
  /** Spot reference of the zone where the energy is consumed. */
  visitedSpotPrice: number | null;
  /** Clearing partner fee in percent. null/0 = no fee. */
  feePct: number | null;
  /** kWh available in the home-zone wallet. Omitted = none. */
  balanceKwh?: number;
}

export interface RoamingQuote {
  /** Requested amount, in visited-zone kWh. */
  amountKwh: number;
  /** Home-zone kWh debited per 1 visited-zone kWh. */
  conversionRate: number;
  /** Debit before the clearing fee. */
  convertedKwh: number;
  feeKwh: number;
  /** What leaves the home-zone balance in total. */
  totalKwh: number;
  /** Part of `totalKwh` the balance can cover. */
  coveredKwh: number;
  /** Remainder — bought on the exchange at market per §16.6. */
  shortfallKwh: number;
}

export interface RoamingDebit {
  /** Home-zone kWh the conversion itself costs. */
  convertedKwh: number;
  /** Clearing partner's cut, also in home-zone kWh. */
  feeKwh: number;
  totalKwh: number;
}

/**
 * What one roaming session takes off the home balance — the same arithmetic
 * `roamingQuote` shows the user, with the zones and the balance left out, so
 * the debit applied later cannot drift from the quote confirmed earlier.
 *
 * Both parts round *up* separately: rounding the sum would let a session
 * whose conversion and fee each land mid-grid give away a thousandth the
 * clearing partner is never paid for.
 */
export function roamingDebit(
  amountKwh: number,
  conversionRate: number,
  feePct: number | null,
): RoamingDebit {
  const amount = roundKwh(amountKwh);
  if (!(amount > 0) || !(conversionRate > 0)) {
    return { convertedKwh: 0, feeKwh: 0, totalKwh: 0 };
  }
  const convertedKwh = ceilKwh(amount * conversionRate);
  const feeKwh = feePct != null && feePct > 0 ? ceilKwh((convertedKwh * feePct) / 100) : 0;
  return { convertedKwh, feeKwh, totalKwh: roundKwh(convertedKwh + feeKwh) };
}

/**
 * The largest visited-zone amount a home balance can serve through the
 * corridor — what the §16.6 waterfall may take from roaming before it starts
 * buying energy for money.
 *
 * Division gives the answer, flooring keeps it on the grid, and the loop
 * settles the last thousandth: `roamingDebit` rounds up twice, so the
 * floored quotient can still cost one step more than the balance holds.
 */
export function roamingAffordableKwh(
  balanceKwh: number,
  conversionRate: number,
  feePct: number | null,
): number {
  const balance = roundKwh(balanceKwh);
  if (!(balance > 0) || !(conversionRate > 0)) return 0;

  const fee = feePct != null && feePct > 0 ? feePct : 0;
  let amount = floorKwh(balance / (conversionRate * (1 + fee / 100)));
  while (amount > 0 && roamingDebit(amount, conversionRate, fee).totalKwh > balance) {
    amount = roundKwh(amount - KWH_STEP);
  }
  return Math.max(0, amount);
}

/**
 * Price a roaming session, or return null when it cannot be priced: no spot
 * reference on either side (§16.7 sends the payment to the aggregator at the
 * external spot price instead) or a non-positive amount.
 *
 * Both the conversion and the fee round *up* to the 0.001 grid: a roaming
 * debit that rounded down would hand out energy the clearing partner is never
 * paid for, once per session.
 */
export function roamingQuote(input: RoamingQuoteInput): RoamingQuote | null {
  const { homeSpotPrice, visitedSpotPrice, feePct } = input;
  const amountKwh = roundKwh(input.amountKwh);
  if (!(amountKwh > 0)) return null;
  if (homeSpotPrice == null || visitedSpotPrice == null) return null;
  if (!(homeSpotPrice > 0) || !(visitedSpotPrice > 0)) return null;

  const conversionRate = roundPrice(visitedSpotPrice / homeSpotPrice);
  const { convertedKwh, feeKwh, totalKwh } = roamingDebit(amountKwh, conversionRate, feePct);

  const balanceKwh = Math.max(0, roundKwh(input.balanceKwh ?? 0));
  const coveredKwh = Math.min(totalKwh, balanceKwh);
  return {
    amountKwh,
    conversionRate,
    convertedKwh,
    feeKwh,
    totalKwh,
    coveredKwh: roundKwh(coveredKwh),
    shortfallKwh: roundKwh(totalKwh - coveredKwh),
  };
}
