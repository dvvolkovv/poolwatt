// VAT on a receipt — ТЗ §46 item 7.
//
// Prices in the app are what the driver pays, so the total is VAT-inclusive
// and the tax is extracted from it rather than added on top. That is the
// European retail convention, and it is also the only split that cannot make
// the printed total disagree with the money that moved.
//
// The rate comes from the partner's own accounting settings. We never supply
// a default: a made-up rate on a tax document is worse than a receipt that
// says the rate was not stated. The EU legal plan lists the VAT opinion per
// operation type as an outstanding item, and that opinion is the owner's.

import { roundMoney } from "@/lib/exchange/precision";

export interface VatSplit {
  ratePct: number;
  net: number;
  amount: number;
  gross: number;
}

export function splitVat(
  gross: number,
  ratePct: number | null | undefined,
): VatSplit | null {
  if (ratePct == null || !Number.isFinite(ratePct)) return null;
  // A rate outside this range is a typo, not a tax regime.
  if (ratePct < 0 || ratePct > 100) return null;

  const total = roundMoney(gross);
  const net = roundMoney(total / (1 + ratePct / 100));
  // Derived by subtraction so net + VAT is the total to the cent, always.
  const amount = roundMoney(total - net);
  return { ratePct, net, amount, gross: total };
}
