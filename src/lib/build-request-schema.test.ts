import { describe, it, expect } from "vitest";
import { buildRequestSchema } from "./build-request-schema";

const valid = {
  source: "SOLAR",
  peakKw: 5,
  wantPowerbank: false,
  wantEvCharger: false,
  evPublicForSale: false,
  country: "SK",
  city: "Bratislava",
  addressLine: "Hlavná 1",
  siteType: "PRIVATE_HOUSE",
  roofOrientation: "S",
  budget: "AWAITING_QUOTE",
  timeline: "EXPLORING",
};

describe("buildRequestSchema", () => {
  it("accepts a minimal valid solar request", () => {
    expect(buildRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects peakKw out of range", () => {
    const r = buildRequestSchema.safeParse({ ...valid, peakKw: 0.1 });
    expect(r.success).toBe(false);
  });

  it("requires powerbankKwh when wantPowerbank is true", () => {
    const r = buildRequestSchema.safeParse({ ...valid, wantPowerbank: true });
    expect(r.success).toBe(false);
  });

  it("accepts wantPowerbank with valid powerbankKwh", () => {
    const r = buildRequestSchema.safeParse({ ...valid, wantPowerbank: true, powerbankKwh: 10 });
    expect(r.success).toBe(true);
  });

  it("requires evChargerPorts when wantEvCharger is true", () => {
    const r = buildRequestSchema.safeParse({ ...valid, wantEvCharger: true });
    expect(r.success).toBe(false);
  });

  it("rejects evPublicForSale=true without wantEvCharger", () => {
    const r = buildRequestSchema.safeParse({ ...valid, evPublicForSale: true });
    expect(r.success).toBe(false);
  });

  it("requires roofOrientation when source is SOLAR or HYBRID", () => {
    const { roofOrientation: _, ...withoutOrientation } = valid;
    const r = buildRequestSchema.safeParse(withoutOrientation);
    expect(r.success).toBe(false);
  });

  it("allows missing roofOrientation when source is WIND", () => {
    const { roofOrientation: _, ...withoutOrientation } = valid;
    const r = buildRequestSchema.safeParse({ ...withoutOrientation, source: "WIND" });
    expect(r.success).toBe(true);
  });

  it("rejects country that is not ISO-2", () => {
    const r = buildRequestSchema.safeParse({ ...valid, country: "slo" });
    expect(r.success).toBe(false);
  });

  it("rejects notes longer than 1000 chars", () => {
    const r = buildRequestSchema.safeParse({ ...valid, notes: "x".repeat(1001) });
    expect(r.success).toBe(false);
  });
});
