import { describe, it, expect } from "vitest";
import { roamingQuote } from "./roaming";

const RATES = { homeSpotPrice: 0.1, visitedSpotPrice: 0.2, feePct: 0 };

describe("roamingQuote — ТЗ §8 'Роуминг', US-11", () => {
  it("converts at the ratio of the two zone spot references", () => {
    const quote = roamingQuote({ amountKwh: 10, ...RATES });
    expect(quote).not.toBeNull();
    expect(quote!.conversionRate).toBe(2);
    expect(quote!.convertedKwh).toBe(20);
    expect(quote!.feeKwh).toBe(0);
    expect(quote!.totalKwh).toBe(20);
  });

  it("charges the clearing fee on top, in kWh", () => {
    const quote = roamingQuote({ amountKwh: 10, ...RATES, feePct: 5 });
    expect(quote!.feeKwh).toBe(1);
    expect(quote!.totalKwh).toBe(21);
  });

  it("leaves the balance untouched in a one-to-one corridor", () => {
    const quote = roamingQuote({ amountKwh: 7.5, homeSpotPrice: 0.15, visitedSpotPrice: 0.15, feePct: null });
    expect(quote!.conversionRate).toBe(1);
    expect(quote!.totalKwh).toBe(7.5);
  });

  it("rounds the debit up to the 0.001 grid so a roaming session never under-debits", () => {
    const quote = roamingQuote({ amountKwh: 1, homeSpotPrice: 0.15, visitedSpotPrice: 0.2, feePct: 0 });
    expect(quote!.conversionRate).toBe(1.3333);
    expect(quote!.totalKwh).toBe(1.334);
  });

  it("splits the debit into what the balance covers and what must be bought", () => {
    const quote = roamingQuote({ amountKwh: 10, ...RATES, balanceKwh: 12 });
    expect(quote!.coveredKwh).toBe(12);
    expect(quote!.shortfallKwh).toBe(8);
  });

  it("covers the whole debit when the balance is sufficient", () => {
    const quote = roamingQuote({ amountKwh: 10, ...RATES, balanceKwh: 50 });
    expect(quote!.coveredKwh).toBe(20);
    expect(quote!.shortfallKwh).toBe(0);
  });

  it("treats a missing balance as an empty one", () => {
    const quote = roamingQuote({ amountKwh: 10, ...RATES });
    expect(quote!.coveredKwh).toBe(0);
    expect(quote!.shortfallKwh).toBe(20);
  });

  it("has no quote without both spot references — §16.7 falls back to the aggregator", () => {
    expect(roamingQuote({ amountKwh: 10, homeSpotPrice: null, visitedSpotPrice: 0.2, feePct: 0 })).toBeNull();
    expect(roamingQuote({ amountKwh: 10, homeSpotPrice: 0.1, visitedSpotPrice: null, feePct: 0 })).toBeNull();
    expect(roamingQuote({ amountKwh: 10, homeSpotPrice: 0, visitedSpotPrice: 0.2, feePct: 0 })).toBeNull();
  });

  it("has no quote for a non-positive amount", () => {
    expect(roamingQuote({ amountKwh: 0, ...RATES })).toBeNull();
    expect(roamingQuote({ amountKwh: -5, ...RATES })).toBeNull();
  });
});
