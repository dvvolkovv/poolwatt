import { describe, it, expect } from "vitest";
import { roamingAffordableKwh, roamingDebit, roamingQuote } from "./roaming";

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

describe("roamingDebit — what a roaming session takes off the home balance", () => {
  it("converts and adds the clearing fee, both rounded up", () => {
    const debit = roamingDebit(10, 2, 5);
    expect(debit.convertedKwh).toBe(20);
    expect(debit.feeKwh).toBe(1);
    expect(debit.totalKwh).toBe(21);
  });

  it("has no fee when the corridor charges none", () => {
    expect(roamingDebit(10, 1.5, 0)).toEqual({ convertedKwh: 15, feeKwh: 0, totalKwh: 15 });
  });

  it("never under-debits on the 0.001 grid", () => {
    // 1 kWh at 1.3333 is 1.3333 — a debit rounded down would hand out energy
    // the clearing partner is never paid for, once per session.
    expect(roamingDebit(1, 1.3333, 0).totalKwh).toBe(1.334);
    // And the fee rounds up on its own, not together with the conversion.
    expect(roamingDebit(1, 1, 1)).toEqual({ convertedKwh: 1, feeKwh: 0.01, totalKwh: 1.01 });
  });

  it("is zero for a non-positive amount or an unusable rate", () => {
    expect(roamingDebit(0, 2, 5).totalKwh).toBe(0);
    expect(roamingDebit(-3, 2, 5).totalKwh).toBe(0);
    expect(roamingDebit(10, 0, 5).totalKwh).toBe(0);
  });
});

describe("roamingAffordableKwh — visited kWh a home balance can serve", () => {
  it("is the balance divided by the rate and the fee", () => {
    expect(roamingAffordableKwh(21, 2, 5)).toBe(10);
    expect(roamingAffordableKwh(30, 2, 5)).toBe(14.285);
  });

  it("is the balance itself in a one-to-one corridor without a fee", () => {
    expect(roamingAffordableKwh(7.5, 1, 0)).toBe(7.5);
  });

  it("never names an amount whose rounded-up debit exceeds the balance", () => {
    for (const balance of [0.001, 0.005, 1, 1.333, 7.777, 12.5, 100.004]) {
      for (const rate of [0.5, 1, 1.3333, 2, 3.75]) {
        for (const feePct of [0, 1, 5, 7.5]) {
          const affordable = roamingAffordableKwh(balance, rate, feePct);
          expect(roamingDebit(affordable, rate, feePct).totalKwh).toBeLessThanOrEqual(balance);
        }
      }
    }
  });

  it("is zero without a balance or without a usable rate", () => {
    expect(roamingAffordableKwh(0, 2, 5)).toBe(0);
    expect(roamingAffordableKwh(-10, 2, 5)).toBe(0);
    expect(roamingAffordableKwh(10, 0, 5)).toBe(0);
  });
});
