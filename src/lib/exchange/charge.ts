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

/** §18 leaves Y open; 10 % covers a market order walking a few book levels. */
export const DEFAULT_AUTH_BUFFER_PCT = 10;

export interface ChargeRequest {
  requestedKwh: number;
  walletKwhBalance: number;
  /**
   * Dry-run match of the shortfall against the live book, or null when there
   * is no shortfall. `null` with a shortfall present means the book could not
   * be consulted at all.
   */
  market: MatchResult | null;
  /** External spot price from the aggregator, for the §16.7 fallback. */
  aggregatorPrice?: number | null;
  authBufferPct?: number;
  chargeFeePct?: number;
}

export type ChargeSource = "balance" | "market" | "aggregator";

export interface ChargePlan {
  /** kWh burned from the wallet's own tokens. */
  kwhFromBalance: number;
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
 * Order of sourcing is fixed by §16.6 — balance, then exchange, then (§16.7)
 * the aggregator at the external spot price. Each step only ever covers what
 * the previous one left unserved.
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

  // 1 — the wallet's own tokens. Floored: burning is per 0.001 token.
  const kwhFromBalance = floorKwh(Math.min(balance, requested));
  if (!isKwhDust(kwhFromBalance)) sources.push("balance");

  let shortfall = roundKwh(requested - kwhFromBalance);

  // 2 — the exchange, at whatever the dry-run match managed to fill.
  const kwhFromMarket = req.market ? roundKwh(req.market.filledKwh) : 0;
  const marketCost = req.market ? roundMoney(req.market.notional) : 0;
  if (!isKwhDust(kwhFromMarket)) sources.push("market");
  shortfall = roundKwh(shortfall - kwhFromMarket);
  if (shortfall < 0) shortfall = 0;

  // 3 — §16.7 fallback: no liquidity on the exchange, buy through the
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
  const deliverableKwh = roundKwh(kwhFromBalance + kwhFromMarket + kwhFromAggregator);
  // §16.9 — paying with tokens already on the balance carries no energy cost,
  // so commission is charged on the money actually spent, not on the kWh.
  const fee = chargeFee(energyCost, feePct);
  const total = roundMoney(energyCost + fee);

  return {
    kwhFromBalance,
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
