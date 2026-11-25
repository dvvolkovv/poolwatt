import { describe, it, expect } from "vitest";
import { cashbackKwh } from "./cashback";

describe("cashbackKwh — ТЗ §8 'кэшбэк при оплате токенами', US-12", () => {
  it("is the configured share of what was paid in tokens", () => {
    expect(cashbackKwh(100, 5)).toBe(5);
    expect(cashbackKwh(42, 10)).toBe(4.2);
  });

  it("rounds down to the 0.001 grid", () => {
    // 7 × 3 % = 0.21 exactly; 7.777 × 3 % = 0.23331 → 0.233.
    expect(cashbackKwh(7, 3)).toBe(0.21);
    expect(cashbackKwh(7.777, 3)).toBe(0.233);
  });

  it("is zero when there is nothing to reward", () => {
    expect(cashbackKwh(0, 5)).toBe(0);
    expect(cashbackKwh(-10, 5)).toBe(0);
    expect(cashbackKwh(100, 0)).toBe(0);
    expect(cashbackKwh(100, null)).toBe(0);
  });

  it("is zero when the share rounds to nothing on this charge", () => {
    expect(cashbackKwh(0.01, 1)).toBe(0);
  });

  it("refuses a share that is not a share", () => {
    expect(() => cashbackKwh(100, 101)).toThrow(RangeError);
    expect(() => cashbackKwh(100, -5)).toThrow(RangeError);
  });
});
