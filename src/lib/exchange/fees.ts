// Platform commission — ТЗ §16.8 ("процент со сделки, настраивается по типу
// участника") and §53 (the operator owns the rates).
//
// Rates live in the FeePlan table; these helpers only turn a rate into money.
// Fees always round *up* to the cent: a rounded-down fee would let a stream of
// tiny trades pay the platform nothing while still consuming the book.

import { ceilMoney, roundMoney, roundPrice } from "./precision";

export interface FeeRates {
  tradeFeePct: number;
  chargeFeePct: number;
}

export const DEFAULT_FEE_RATES: FeeRates = { tradeFeePct: 1, chargeFeePct: 2 };

function pctOf(amount: number, pct: number): number {
  if (!(pct > 0)) return 0;
  if (amount <= 0) return 0;
  return ceilMoney((amount * pct) / 100);
}

/** Commission on one fill, charged on the notional value. */
export function tradeFee(notional: number, pct: number): number {
  return pctOf(notional, pct);
}

/** Commission on a charging session (§52 "Плата за простой" is separate). */
export function chargeFee(amount: number, pct: number): number {
  return pctOf(amount, pct);
}

export interface TradeFees {
  buyerFee: number;
  sellerFee: number;
  total: number;
}

/**
 * Both sides of a fill pay their own plan's rate — a producer on a
 * preferential plan is not subsidised by the wholesale buyer facing it.
 */
export function splitTradeFees(
  notional: number,
  buyerPct: number,
  sellerPct: number,
): TradeFees {
  const buyerFee = tradeFee(notional, buyerPct);
  const sellerFee = tradeFee(notional, sellerPct);
  return { buyerFee, sellerFee, total: roundMoney(buyerFee + sellerFee) };
}

/** What the seller actually receives for a fill, after commission. */
export function sellerProceeds(notional: number, sellerFee: number): number {
  return roundMoney(notional - sellerFee);
}

/** What the buyer actually pays for a fill, including commission. */
export function buyerCost(notional: number, buyerFee: number): number {
  return roundMoney(notional + buyerFee);
}

/**
 * All-in price per kWh the buyer sees before confirming (§54 "Клиент видит
 * итоговую цену и все платы до подтверждения").
 */
export function effectivePricePerKwh(totalPaid: number, amountKwh: number): number | null {
  if (!(amountKwh > 0)) return null;
  return roundPrice(totalPaid / amountKwh);
}
