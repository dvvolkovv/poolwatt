// The payment waterfall — ТЗ §8 and §16.6:
//   "сначала списывается баланс кВт·ч, затем недостающее докупается рыночной
//    заявкой; сумма авторизуется на карте с запасом Y %, списывается по факту".
//
// Pure planner. The caller runs a dry-run match for the shortfall, hands the
// result in, gets back a plan, and only then touches the card and the DB. That
// split matters: the authorization amount has to be known *before* any token
// is burned, and it has to over-cover, because the real execution price is
// only known once the market order actually runs.

import { chargeFee } from "./fees";
import type { MatchResult } from "./matching";
import { ceilMoney, floorKwh, isKwhDust, roundKwh, roundMoney } from "./precision";
import { roamingDebit } from "./roaming";

/** §18 leaves Y open; 10 % covers a market order walking a few book levels. */
export const DEFAULT_AUTH_BUFFER_PCT = 10;

export interface ChargeRequest {
  requestedKwh: number;
  /**
   * §43 — "при оплате списывается первым, раньше обычного баланса кВт·ч".
   * Promo kWh the driver may use *at this point*: the caller has already
   * dropped grants belonging to other networks, which is US-43.
   */
  giftKwh?: number;
  walletKwhBalance: number;
  /**
   * Dry-run match of the shortfall against the live book, or null when there
   * is no shortfall. `null` with a shortfall present means the book could not
   * be consulted at all.
   */
  market: MatchResult | null;
  /**
   * §8 "Роуминг", US-11 — the corridor from the zone that holds the driver's
   * kWh to the zone the session runs in. The caller has already capped
   * `maxKwh` by the home balance and by what §24.2 still allows today.
   */
  roaming?: RoamingLeg | null;
  /** External spot price from the aggregator, for the §16.7 fallback. */
  aggregatorPrice?: number | null;
  authBufferPct?: number;
  chargeFeePct?: number;
}

export interface RoamingLeg {
  /** Visited-zone kWh this corridor may serve in this session. */
  maxKwh: number;
  /** Home-zone kWh per 1 visited-zone kWh. */
  conversionRate: number;
  /** Clearing partner's fee, in percent of the converted amount. */
  feePct: number;
}

export type ChargeSource = "gift" | "balance" | "roaming" | "market" | "aggregator";

export interface ChargePlan {
  /** §43 promo kWh spent, which the driver pays nothing for. */
  kwhFromGift: number;
  /** kWh burned from the wallet's own tokens. */
  kwhFromBalance: number;
  /** kWh the clearing partner delivered against the home-zone balance. */
  kwhFromRoaming: number;
  /** Home-zone kWh the roaming leg takes off the balance, fee included. */
  roamingDebitKwh: number;
  /** The clearing fee inside `roamingDebitKwh`. */
  roamingFeeKwh: number;
  /** kWh bought on the exchange. */
  kwhFromMarket: number;
  /** kWh bought from the aggregator at the external spot price (§16.7). */
  kwhFromAggregator: number;
  /** kWh that could not be sourced anywhere — the session must be short-filled. */
  unservedKwh: number;
  /** kWh actually deliverable. */
  deliverableKwh: number;
  /** Cost of the bought kWh, before commission. */
  energyCost: number;
  fee: number;
  /** What the card is charged on capture. */
  total: number;
  /** What is held on the card up front: total + Y %. */
  authorizedFiat: number;
  sources: ChargeSource[];
  /** False when nothing at all can be delivered. */
  feasible: boolean;
}

/**
 * Build the plan for one charging session.
 *
 * Order of sourcing is §43 first and then §16.6 — gift, balance, exchange,
 * and finally (§16.7) the aggregator at the external spot price. Each step
 * only ever covers what the previous one left unserved.
 */
export function planCharge(req: ChargeRequest): ChargePlan {
  const requested = roundKwh(req.requestedKwh);
  if (!(requested > 0)) {
    throw new RangeError(`Requested kWh must be positive, got ${req.requestedKwh}`);
  }
  const balance = Math.max(0, roundKwh(req.walletKwhBalance));
  const authBufferPct = req.authBufferPct ?? DEFAULT_AUTH_BUFFER_PCT;
  const feePct = req.chargeFeePct ?? 0;

  const sources: ChargeSource[] = [];

  // 0 — §43: the partner's gift goes first, and costs the driver nothing.
  // Floored like the balance, because spending is per 0.001 kWh.
  const gift = Math.max(0, roundKwh(req.giftKwh ?? 0));
  const kwhFromGift = floorKwh(Math.min(gift, requested));
  if (!isKwhDust(kwhFromGift)) sources.push("gift");

  // 1 — the wallet's own tokens. Floored: burning is per 0.001 token.
  const kwhFromBalance = floorKwh(Math.min(balance, roundKwh(requested - kwhFromGift)));
  if (!isKwhDust(kwhFromBalance)) sources.push("balance");

  let shortfall = roundKwh(requested - kwhFromGift - kwhFromBalance);

  // 2 — §8: the kWh the driver already owns, bought in another zone. They go
  // before the exchange because §8 promises they are spendable abroad — a
  // session that bought energy for money while the driver held some would
  // make that promise worthless.
  let kwhFromRoaming = 0;
  let roamingDebitKwh = 0;
  let roamingFeeKwh = 0;
  const corridor = req.roaming ?? null;
  if (corridor && !isKwhDust(shortfall) && corridor.conversionRate > 0) {
    kwhFromRoaming = floorKwh(Math.min(Math.max(0, roundKwh(corridor.maxKwh)), shortfall));
    if (!isKwhDust(kwhFromRoaming)) {
      const debit = roamingDebit(kwhFromRoaming, corridor.conversionRate, corridor.feePct);
      roamingDebitKwh = debit.totalKwh;
      roamingFeeKwh = debit.feeKwh;
      sources.push("roaming");
      shortfall = roundKwh(shortfall - kwhFromRoaming);
    } else {
      kwhFromRoaming = 0;
    }
  }

  // 3 — the exchange, at whatever the dry-run match managed to fill. Capped
  // by what is still missing: the quote may have been taken for a larger
  // shortfall than the roaming leg left behind, and the session must not buy
  // energy it no longer needs.
  const matchFilled = req.market ? roundKwh(req.market.filledKwh) : 0;
  const kwhFromMarket = floorKwh(Math.min(matchFilled, shortfall));
  const marketCost =
    req.market && matchFilled > 0
      ? roundMoney((req.market.notional * kwhFromMarket) / matchFilled)
      : 0;
  if (!isKwhDust(kwhFromMarket)) sources.push("market");
  shortfall = roundKwh(shortfall - kwhFromMarket);
  if (shortfall < 0) shortfall = 0;

  // 4 — §16.7 fallback: no liquidity on the exchange, buy through the
  // aggregator at the external spot price.
  let kwhFromAggregator = 0;
  let aggregatorCost = 0;
  const aggPrice = req.aggregatorPrice ?? null;
  if (!isKwhDust(shortfall) && aggPrice != null && aggPrice > 0) {
    kwhFromAggregator = shortfall;
    aggregatorCost = roundMoney(kwhFromAggregator * aggPrice);
    sources.push("aggregator");
    shortfall = 0;
  }

  const energyCost = roundMoney(marketCost + aggregatorCost);
  // Roaming kWh cost no money: the clearing partner delivered the energy and
  // the driver paid in home-zone kWh, so they carry no commission either.
  const deliverableKwh = roundKwh(
    kwhFromGift + kwhFromBalance + kwhFromRoaming + kwhFromMarket + kwhFromAggregator,
  );
  // §16.9 — paying with tokens already on the balance carries no energy cost,
  // so commission is charged on the money actually spent, not on the kWh.
  const fee = chargeFee(energyCost, feePct);
  const total = roundMoney(energyCost + fee);

  return {
    kwhFromGift,
    kwhFromBalance,
    kwhFromRoaming,
    roamingDebitKwh,
    roamingFeeKwh,
    kwhFromMarket,
    kwhFromAggregator,
    unservedKwh: isKwhDust(shortfall) ? 0 : shortfall,
    deliverableKwh,
    energyCost,
    fee,
    total,
    authorizedFiat: authorizationAmount(total, authBufferPct),
    sources,
    feasible: !isKwhDust(deliverableKwh),
  };
}

/**
 * §16.6 "сумма авторизуется на карте с запасом Y %". Always rounded up: an
 * authorization that under-covers the capture is a declined capture.
 */
export function authorizationAmount(total: number, bufferPct: number): number {
  if (total <= 0) return 0;
  const buffer = Math.max(0, bufferPct);
  return ceilMoney(total * (1 + buffer / 100));
}

/**
 * Whether a wallet can pay the authorization out of its fiat balance alone
 * (no card). Reserved funds backing open BUY orders are not available.
 */
export function canCoverFromFiat(
  plan: ChargePlan,
  wallet: { fiatBalance: number; reservedFiat: number },
): boolean {
  const available = roundMoney(wallet.fiatBalance - wallet.reservedFiat);
  return available >= plan.total;
}
