// §30 — числа плиток считаются в одном месте, чтобы телефон и монитор не
// разошлись в том, сколько станция выработала.

import { describe, it, expect } from "vitest";
import { COMPLEX_WIDGETS, figureValues } from "./widget-values";
import { WIDGET_KEYS } from "./widgets";
import type { StationOverview } from "@/lib/exchange/station-service";

const OVERVIEW: StationOverview = {
  assetId: "a1",
  name: "Array",
  capacityKw: 10,
  intervalMinutes: 60,
  nowKw: 4.2,
  lastReadingAt: new Date("2026-11-26T12:00:00.000Z"),
  stale: false,
  todayKwh: 12.5,
  weekKwh: 80,
  monthKwh: 300,
  yearKwh: 3600,
  efficiency: 0.42,
  revenue: { soldKwh: 250, gross: 100, net: 97.5, avgPrice: 0.39, currency: "EUR" },
};

const TOKENS = {
  mintedKwh: 300,
  soldKwh: 250,
  availableKwh: 40,
  storedKwh: 10,
  routedKwh: 0,
};

const INPUT = {
  overview: OVERVIEW,
  tokens: TOKENS,
  currency: "EUR",
  socPct: 63.5,
  spotPrice: 0.2134,
};

describe("figureValues", () => {
  it("rounds kWh to three places and money to two", () => {
    const v = figureValues(INPUT);
    expect(v.today).toEqual({ value: "12.500", unit: "kWh" });
    expect(v.revenue).toEqual({ value: "97.50", unit: "EUR" });
    expect(v.avgPrice).toEqual({ value: "0.3900", unit: "EUR/kWh" });
  });

  it("shows efficiency as a percentage of the nameplate", () => {
    expect(figureValues(INPUT).efficiency).toEqual({ value: "42.0", unit: "%" });
  });

  it("says nothing instead of zero when there is nothing to say", () => {
    const v = figureValues({
      ...INPUT,
      overview: { ...OVERVIEW, nowKw: null, efficiency: null, revenue: { ...OVERVIEW.revenue, avgPrice: null } },
      socPct: null,
      spotPrice: null,
    });
    // Ноль киловатт и «показаний не было» — разные вещи.
    expect(v.nowKw).toEqual({ value: "—", unit: "kW" });
    expect(v.efficiency?.value).toBe("—");
    expect(v.avgPrice?.value).toBe("—");
    expect(v.storageSoc?.value).toBe("—");
    expect(v.zonePrice?.value).toBe("—");
  });

  it("covers every widget of the catalogue that is a single figure", () => {
    const v = figureValues(INPUT);
    const simple = WIDGET_KEYS.filter((k) => !COMPLEX_WIDGETS.has(k));
    for (const key of simple) {
      expect(v[key], `widget ${key} has no value`).toBeDefined();
    }
  });

  it("leaves the four widgets with their own markup alone", () => {
    const v = figureValues(INPUT);
    for (const key of COMPLEX_WIDGETS) {
      expect(v[key]).toBeUndefined();
    }
  });
});
