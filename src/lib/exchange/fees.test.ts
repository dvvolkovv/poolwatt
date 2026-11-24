import { describe, it, expect } from "vitest";
import {
  buyerCost,
  chargeFee,
  effectivePricePerKwh,
  sellerProceeds,
  splitTradeFees,
  tradeFee,
} from "./fees";

describe("tradeFee — ТЗ §16.8", () => {
  it("takes a percentage of the notional", () => {
    expect(tradeFee(100, 1)).toBe(1);
    expect(tradeFee(250, 2.5)).toBe(6.25);
  });

  it("rounds a part-cent fee up, never down to nothing", () => {
    expect(tradeFee(0.1, 1)).toBe(0.01);
  });

  it("is zero for a zero or negative rate", () => {
    expect(tradeFee(100, 0)).toBe(0);
    expect(tradeFee(100, -1)).toBe(0);
  });

  it("is zero for a non-positive notional", () => {
    expect(tradeFee(0, 1)).toBe(0);
    expect(tradeFee(-5, 1)).toBe(0);
  });
});

describe("chargeFee", () => {
  it("applies the charging rate", () => {
    expect(chargeFee(20, 2)).toBe(0.4);
  });
});

describe("splitTradeFees", () => {
  it("charges each side its own plan's rate", () => {
    expect(splitTradeFees(100, 1, 0.5)).toEqual({
      buyerFee: 1,
      sellerFee: 0.5,
      total: 1.5,
    });
  });
});

describe("sellerProceeds / buyerCost", () => {
  it("nets the fee off the seller and onto the buyer", () => {
    expect(sellerProceeds(100, 0.5)).toBe(99.5);
    expect(buyerCost(100, 1)).toBe(101);
  });
});

describe("effectivePricePerKwh — ТЗ §54 all-in price", () => {
  it("divides the all-in total by the delivered kWh", () => {
    expect(effectivePricePerKwh(2.02, 10)).toBe(0.202);
  });

  it("is null when nothing was delivered", () => {
    expect(effectivePricePerKwh(1, 0)).toBeNull();
  });
});
