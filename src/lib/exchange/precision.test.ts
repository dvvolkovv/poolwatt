import { describe, it, expect } from "vitest";
import {
  KWH_STEP,
  ceilMoney,
  floorKwh,
  isKwhDust,
  kwhEquals,
  notional,
  roundKwh,
  roundMoney,
  roundPrice,
} from "./precision";

describe("roundKwh — ТЗ §16.1 precision of 0.001 kWh", () => {
  it("keeps three decimals", () => {
    expect(roundKwh(12.3456)).toBe(12.346);
    expect(roundKwh(12.3444)).toBe(12.344);
  });

  it("rounds a half up away from zero on both signs", () => {
    expect(roundKwh(0.0015)).toBe(0.002);
    expect(roundKwh(-0.0015)).toBe(-0.002);
  });

  it("survives binary-float dust from a division", () => {
    expect(roundKwh(0.1 + 0.2)).toBe(0.3);
    expect(roundKwh(1 / 3)).toBe(0.333);
  });

  it("rejects non-finite input rather than storing NaN", () => {
    expect(() => roundKwh(Number.NaN)).toThrow(RangeError);
    expect(() => roundKwh(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("roundPrice / roundMoney", () => {
  it("rounds price to 4 decimals", () => {
    expect(roundPrice(0.123456)).toBe(0.1235);
  });

  it("rounds money to minor units", () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(1.004)).toBe(1.0);
  });
});

describe("floorKwh — never invent energy", () => {
  it("truncates towards zero on the grid", () => {
    expect(floorKwh(1.0009)).toBe(1.0);
    expect(floorKwh(1.9999)).toBe(1.999);
  });

  it("leaves an exact grid value untouched", () => {
    expect(floorKwh(2.345)).toBe(2.345);
    // 7.4 / 3 = 2.46666…; flooring must not round up to 2.467
    expect(floorKwh(7.4 / 3)).toBe(2.466);
  });
});

describe("ceilMoney — authorization holds must over-cover", () => {
  it("rounds any fraction of a cent up", () => {
    expect(ceilMoney(1.001)).toBe(1.01);
    expect(ceilMoney(10.0)).toBe(10.0);
  });
});

describe("notional", () => {
  it("multiplies kWh by price and rounds to money scale", () => {
    expect(notional(10, 0.1234)).toBe(1.23);
    expect(notional(3.333, 0.3)).toBe(1.0);
  });
});

describe("kwhEquals / isKwhDust", () => {
  it("treats sub-step differences as equal", () => {
    expect(kwhEquals(1.0, 1.0 + KWH_STEP / 10)).toBe(true);
    expect(kwhEquals(1.0, 1.002)).toBe(false);
  });

  it("flags residue below the grid as dust", () => {
    expect(isKwhDust(0.0004)).toBe(true);
    expect(isKwhDust(0.001)).toBe(false);
  });
});
