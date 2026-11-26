// §28 «цена по времени суток». Чек это уже умел — теперь это умеет вся
// система, и одним и тем же кодом.

import { describe, it, expect } from "vitest";
import { localMinuteOfDay, tariffAt, tariffAtDate, zoneKnown } from "./point-tariff";

const DAY = { fromMinute: 360, toMinute: 1320, priceFiat: 0.4 };
const NIGHT = { fromMinute: 1320, toMinute: 360, priceFiat: 0.15 };
const FLAT = { fromMinute: 0, toMinute: 1440, priceFiat: 0.3 };

describe("localMinuteOfDay", () => {
  it("counts minutes in the point's own country", () => {
    // 2026-01-15T07:30:00Z — в Братиславе это 08:30, то есть 510 минут.
    const at = new Date("2026-01-15T07:30:00.000Z");
    expect(localMinuteOfDay(at, "SK")).toBe(510);
  });

  it("follows summer time", () => {
    // 2026-07-15T07:30:00Z — в Братиславе 09:30, то есть 570 минут.
    const at = new Date("2026-07-15T07:30:00.000Z");
    expect(localMinuteOfDay(at, "SK")).toBe(570);
  });

  it("falls back to UTC for a country we do not know", () => {
    const at = new Date("2026-01-15T07:30:00.000Z");
    expect(localMinuteOfDay(at, "ZZ")).toBe(450);
    expect(localMinuteOfDay(at, null)).toBe(450);
  });

  it("reads midnight as minute zero, not as 1440", () => {
    const at = new Date("2026-01-15T23:00:00.000Z"); // 00:00 в Братиславе
    expect(localMinuteOfDay(at, "SK")).toBe(0);
  });

  it("says whether the country's zone is known", () => {
    expect(zoneKnown("SK")).toBe(true);
    expect(zoneKnown("UA")).toBe(true);
    expect(zoneKnown("ZZ")).toBe(false);
    expect(zoneKnown(null)).toBe(false);
  });
});

describe("tariffAt", () => {
  it("picks the window that contains the minute", () => {
    expect(tariffAt([DAY, NIGHT], 600)?.priceFiat).toBe(0.4);
  });

  it("handles a window that wraps past midnight", () => {
    expect(tariffAt([DAY, NIGHT], 1400)?.priceFiat).toBe(0.15);
    expect(tariffAt([DAY, NIGHT], 120)?.priceFiat).toBe(0.15);
  });

  it("takes a flat day as it is", () => {
    expect(tariffAt([FLAT], 0)?.priceFiat).toBe(0.3);
    expect(tariffAt([FLAT], 1439)?.priceFiat).toBe(0.3);
  });

  it("falls back to the first window when nothing covers the minute", () => {
    expect(tariffAt([{ fromMinute: 600, toMinute: 700, priceFiat: 1 }], 0)?.priceFiat).toBe(1);
  });

  it("has nothing to say about a point without tariffs", () => {
    expect(tariffAt([], 600)).toBeNull();
  });
});

describe("tariffAtDate", () => {
  it("chooses the window by the clock at the point, not by UTC", () => {
    // 21:30 UTC — в Братиславе уже 22:30, то есть ночной тариф.
    const at = new Date("2026-01-15T21:30:00.000Z");
    expect(tariffAtDate([DAY, NIGHT], at, "SK")?.priceFiat).toBe(0.15);
    // Та же минута по UTC — ещё дневной.
    expect(tariffAtDate([DAY, NIGHT], at, null)?.priceFiat).toBe(0.4);
  });

  it("takes the first window when the moment is unknown", () => {
    expect(tariffAtDate([DAY, NIGHT], null, "SK")?.priceFiat).toBe(0.4);
  });
});
