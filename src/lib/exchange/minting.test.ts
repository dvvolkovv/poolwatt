import { describe, it, expect } from "vitest";
import { AssetStatus, ReadingValidationStatus } from "@prisma/client";
import {
  canMint,
  probationComplete,
  splitMint,
  theoreticalMaxKwh,
  validateReading,
} from "./minting";

const base = { intervalMinutes: 15, capacityKw: 100 };

describe("theoreticalMaxKwh", () => {
  it("scales nameplate power by the interval length", () => {
    expect(theoreticalMaxKwh(100, 15)).toBe(25);
    expect(theoreticalMaxKwh(100, 60)).toBe(100);
  });

  it("rejects a non-positive interval", () => {
    expect(() => theoreticalMaxKwh(100, 0)).toThrow(RangeError);
  });
});

describe("validateReading — ТЗ §5 validation", () => {
  it("accepts a plausible reading and mints the metered amount", () => {
    const r = validateReading({ ...base, energyKwh: 18.4567 });
    expect(r.status).toBe(ReadingValidationStatus.VALID);
    expect(r.mintKwh).toBe(18.457);
    expect(r.note).toBeNull();
  });

  it("accepts zero output and mints nothing", () => {
    const r = validateReading({ ...base, energyKwh: 0 });
    expect(r.status).toBe(ReadingValidationStatus.VALID);
    expect(r.mintKwh).toBe(0);
  });

  it("rejects a negative reading outright", () => {
    const r = validateReading({ ...base, energyKwh: -1 });
    expect(r.status).toBe(ReadingValidationStatus.REJECTED);
    expect(r.mintKwh).toBe(0);
    expect(r.note).toMatch(/negative/i);
  });

  it("rejects a non-numeric reading", () => {
    const r = validateReading({ ...base, energyKwh: Number.NaN });
    expect(r.status).toBe(ReadingValidationStatus.REJECTED);
  });

  it("allows a small overshoot above nameplate", () => {
    // 25 kWh ceiling for 100 kW over 15 min, +10% tolerance = 27.5
    expect(validateReading({ ...base, energyKwh: 27 }).status).toBe(
      ReadingValidationStatus.VALID,
    );
  });

  it("holds a reading that exceeds nameplate beyond tolerance", () => {
    const r = validateReading({ ...base, energyKwh: 40 });
    expect(r.status).toBe(ReadingValidationStatus.SUSPICIOUS);
    expect(r.mintKwh).toBe(0);
    expect(r.note).toMatch(/nameplate/i);
  });

  it("holds a reading far below the weather forecast", () => {
    const r = validateReading({ ...base, energyKwh: 1, expectedKwh: 20 });
    expect(r.status).toBe(ReadingValidationStatus.SUSPICIOUS);
    expect(r.note).toMatch(/forecast/i);
  });

  it("does not flag a reading above the forecast", () => {
    expect(validateReading({ ...base, energyKwh: 24, expectedKwh: 10 }).status).toBe(
      ReadingValidationStatus.VALID,
    );
  });

  it("ignores a missing or zero forecast", () => {
    expect(validateReading({ ...base, energyKwh: 1, expectedKwh: null }).status).toBe(
      ReadingValidationStatus.VALID,
    );
    expect(validateReading({ ...base, energyKwh: 1, expectedKwh: 0 }).status).toBe(
      ReadingValidationStatus.VALID,
    );
  });
});

describe("canMint — ТЗ §4 gate", () => {
  it("only mints for an ACTIVE asset", () => {
    expect(canMint({ status: AssetStatus.ACTIVE, telemetryCleanSince: new Date() })).toBe(true);
  });

  it("refuses for TEST, DRAFT, REVIEW and SUSPENDED assets", () => {
    for (const status of [
      AssetStatus.TEST,
      AssetStatus.DRAFT,
      AssetStatus.REVIEW,
      AssetStatus.SUSPENDED,
    ]) {
      expect(canMint({ status, telemetryCleanSince: new Date() })).toBe(false);
    }
  });
});

describe("probationComplete — ТЗ §14 test → active", () => {
  const start = new Date("2026-11-01T00:00:00Z");

  it("is false before 7 clean days have passed", () => {
    const now = new Date("2026-11-07T23:00:00Z");
    expect(probationComplete({ status: AssetStatus.TEST, telemetryCleanSince: start }, now)).toBe(
      false,
    );
  });

  it("is true once 7 clean days have passed", () => {
    const now = new Date("2026-11-08T00:00:00Z");
    expect(probationComplete({ status: AssetStatus.TEST, telemetryCleanSince: start }, now)).toBe(
      true,
    );
  });

  it("is false when the clean-telemetry clock was reset to null", () => {
    const now = new Date("2026-12-01T00:00:00Z");
    expect(
      probationComplete({ status: AssetStatus.TEST, telemetryCleanSince: null }, now),
    ).toBe(false);
  });

  it("does not apply to assets that are not in TEST", () => {
    const now = new Date("2026-12-01T00:00:00Z");
    expect(
      probationComplete({ status: AssetStatus.ACTIVE, telemetryCleanSince: start }, now),
    ).toBe(false);
  });
});

describe("splitMint — ТЗ §30 sale rules", () => {
  it("sends everything to the market by default", () => {
    expect(splitMint(10, { toMarketPct: 100, toStoragePct: 0, toSelfPct: 0 })).toEqual({
      toMarketKwh: 10,
      toStorageKwh: 0,
      toSelfKwh: 0,
    });
  });

  it("splits by the configured percentages", () => {
    expect(splitMint(100, { toMarketPct: 50, toStoragePct: 30, toSelfPct: 20 })).toEqual({
      toMarketKwh: 50,
      toStorageKwh: 30,
      toSelfKwh: 20,
    });
  });

  it("conserves energy exactly — no kWh invented or lost", () => {
    const s = splitMint(10, { toMarketPct: 33, toStoragePct: 33, toSelfPct: 34 });
    expect(s.toMarketKwh + s.toStorageKwh + s.toSelfKwh).toBeCloseTo(10, 3);
  });

  it("treats shares that do not sum to 100 as weights", () => {
    expect(splitMint(10, { toMarketPct: 1, toStoragePct: 1, toSelfPct: 0 })).toEqual({
      toMarketKwh: 5,
      toStorageKwh: 5,
      toSelfKwh: 0,
    });
  });

  it("gives flooring residue to the market, never over-allocating", () => {
    const s = splitMint(1, { toMarketPct: 0, toStoragePct: 100, toSelfPct: 0 });
    expect(s.toStorageKwh).toBeLessThanOrEqual(1);
  });

  it("rejects an all-zero rule and a negative mint", () => {
    expect(() => splitMint(10, { toMarketPct: 0, toStoragePct: 0, toSelfPct: 0 })).toThrow(
      RangeError,
    );
    expect(() => splitMint(-1, { toMarketPct: 100, toStoragePct: 0, toSelfPct: 0 })).toThrow(
      RangeError,
    );
  });
});
