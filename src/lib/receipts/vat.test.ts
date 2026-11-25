// §46 item 7 — "НДС и налоговые реквизиты по законодательству страны пункта".
//
// The rate is the partner's, never ours. These tests pin the arithmetic and,
// just as importantly, pin what happens when nobody told us the rate.

import { describe, it, expect } from "vitest";
import { splitVat } from "./vat";

describe("splitVat", () => {
  it("treats the total as VAT-inclusive, the EU retail way", () => {
    expect(splitVat(120, 20)).toEqual({ ratePct: 20, net: 100, amount: 20, gross: 120 });
  });

  it("rounds to the cent and keeps net + VAT equal to the total", () => {
    const split = splitVat(13.37, 21);
    expect(split).not.toBeNull();
    expect(split!.net + split!.amount).toBeCloseTo(13.37, 10);
  });

  it("says nothing rather than guessing when the partner set no rate", () => {
    expect(splitVat(120, null)).toBeNull();
    expect(splitVat(120, undefined)).toBeNull();
  });

  it("handles a zero rate as a real answer, not a missing one", () => {
    expect(splitVat(120, 0)).toEqual({ ratePct: 0, net: 120, amount: 0, gross: 120 });
  });

  it("refuses a nonsense rate instead of printing a nonsense tax line", () => {
    expect(splitVat(120, -5)).toBeNull();
    expect(splitVat(120, 120)).toBeNull();
  });

  it("is safe on a zero total — a receipt for a free kWh still prints", () => {
    expect(splitVat(0, 20)).toEqual({ ratePct: 20, net: 0, amount: 0, gross: 0 });
  });
});
