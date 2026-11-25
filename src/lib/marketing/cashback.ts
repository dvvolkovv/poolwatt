// Cashback arithmetic — ТЗ §8 "повышенный кэшбэк при оплате токенами",
// US-12. Pure, so the number the receipt prints and the number the grant
// carries are the same number.

import { floorKwh, roundKwh } from "@/lib/exchange/precision";

/**
 * The kWh a campaign gives back for a session paid with tokens.
 *
 * `paidInTokensKwh` is what the driver covered from their own balance — the
 * zone's and, since US-11, the roaming debit. Gift kWh and kWh bought for
 * money are not in it: §8 promises cashback for paying *with tokens*.
 *
 * Rounded down: cashback is a partner's generosity out of their own
 * generation, not a reason to hand out a thousandth their budget never held.
 */
export function cashbackKwh(paidInTokensKwh: number, pct: number | null): number {
  if (pct == null) return 0;
  if (pct < 0 || pct > 100) {
    throw new RangeError(`A cashback share has to be between 0 and 100 %, got ${pct}`);
  }
  const base = roundKwh(paidInTokensKwh);
  if (!(base > 0) || !(pct > 0)) return 0;
  return floorKwh((base * pct) / 100);
}
