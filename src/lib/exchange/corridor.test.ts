import { describe, it, expect } from "vitest";
import { corridorBounds, corridorRejectReason, isPriceInCorridor } from "./corridor";

describe("corridorBounds — ТЗ §16.5", () => {
  it("returns ±X% around the spot reference", () => {
    expect(corridorBounds({ spotPrice: 0.2, corridorPct: 20 })).toEqual({
      min: 0.16,
      max: 0.24,
    });
  });

  it("is disabled when the zone has no spot reference yet", () => {
    expect(corridorBounds({ spotPrice: null, corridorPct: 20 })).toBeNull();
  });

  it("is disabled when the operator has not configured X (§18)", () => {
    expect(corridorBounds({ spotPrice: 0.2, corridorPct: null })).toBeNull();
    expect(corridorBounds({ spotPrice: 0.2, corridorPct: 0 })).toBeNull();
  });

  it("is disabled rather than inverted when spot is zero or negative", () => {
    expect(corridorBounds({ spotPrice: 0, corridorPct: 20 })).toBeNull();
    expect(corridorBounds({ spotPrice: -0.05, corridorPct: 20 })).toBeNull();
  });
});

describe("isPriceInCorridor", () => {
  const c = { spotPrice: 0.2, corridorPct: 20 };

  it("accepts prices on and inside the bounds", () => {
    expect(isPriceInCorridor(0.16, c)).toBe(true);
    expect(isPriceInCorridor(0.2, c)).toBe(true);
    expect(isPriceInCorridor(0.24, c)).toBe(true);
  });

  it("rejects prices outside the bounds", () => {
    expect(isPriceInCorridor(0.1599, c)).toBe(false);
    expect(isPriceInCorridor(0.2401, c)).toBe(false);
  });

  it("lets everything through when the corridor is unconfigured", () => {
    expect(isPriceInCorridor(99, { spotPrice: null, corridorPct: 20 })).toBe(true);
  });
});

describe("corridorRejectReason", () => {
  it("is null for an acceptable price", () => {
    expect(corridorRejectReason(0.2, { spotPrice: 0.2, corridorPct: 20 })).toBeNull();
  });

  it("names the bounds and the spot reference", () => {
    const reason = corridorRejectReason(0.5, { spotPrice: 0.2, corridorPct: 20 });
    expect(reason).toContain("0.16");
    expect(reason).toContain("0.24");
    expect(reason).toContain("20%");
  });
});
