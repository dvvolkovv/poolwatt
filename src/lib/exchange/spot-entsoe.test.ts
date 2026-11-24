// ТЗ §6, §16.5 — the zone's spot reference comes from the external market.
// Parsing is tested against recorded documents; the network is never touched.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  SpotFeedError,
  entsoeRequestUrl,
  parseDayAheadPrices,
} from "./spot-entsoe";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "__fixtures__", name), "utf8");

describe("entsoeRequestUrl", () => {
  it("asks for one zone's day-ahead prices in the platform's time format", () => {
    const url = new URL(
      entsoeRequestUrl({
        areaCode: "10YSK-SEPS---K",
        from: new Date("2026-11-23T23:00:00.000Z"),
        to: new Date("2026-11-24T23:00:00.000Z"),
        token: "secret-token",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://web-api.tp.entsoe.eu/api");
    expect(url.searchParams.get("documentType")).toBe("A44");
    expect(url.searchParams.get("in_Domain")).toBe("10YSK-SEPS---K");
    expect(url.searchParams.get("out_Domain")).toBe("10YSK-SEPS---K");
    expect(url.searchParams.get("periodStart")).toBe("202611232300");
    expect(url.searchParams.get("periodEnd")).toBe("202611242300");
    expect(url.searchParams.get("securityToken")).toBe("secret-token");
  });
});

describe("parseDayAheadPrices", () => {
  it("reads an hourly day and converts EUR/MWh to EUR/kWh", () => {
    const series = parseDayAheadPrices(fixture("entsoe-a44.xml"));

    expect(series.currency).toBe("EUR");
    expect(series.points).toHaveLength(24);
    expect(series.points[0]).toEqual({
      intervalStart: new Date("2026-11-23T23:00:00.000Z"),
      resolutionMinutes: 60,
      pricePerKwh: 0.0845,
    });
    // Position 2 starts one hour after the period.
    expect(series.points[1].intervalStart).toEqual(new Date("2026-11-24T00:00:00.000Z"));
    expect(series.points[1].pricePerKwh).toBe(0.0792);
    // The evening peak, rounded to the four decimals the schema stores.
    expect(series.points[19].pricePerKwh).toBe(0.1419);
  });

  it("keeps the points in time order", () => {
    const { points } = parseDayAheadPrices(fixture("entsoe-a44.xml"));
    const times = points.map((p) => p.intervalStart.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("reads quarter-hourly prices and carries a gap forward", () => {
    const { points } = parseDayAheadPrices(fixture("entsoe-a44-quarter.xml"));

    expect(points.map((p) => p.intervalStart.toISOString())).toEqual([
      "2026-11-24T10:00:00.000Z",
      "2026-11-24T10:15:00.000Z",
      "2026-11-24T10:30:00.000Z",
      "2026-11-24T10:45:00.000Z",
    ]);
    // Position 3 is absent, so the price of position 2 holds.
    expect(points.map((p) => p.pricePerKwh)).toEqual([0.1, 0.0905, 0.0905, 0.08]);
    expect(points[0].resolutionMinutes).toBe(15);
  });

  it("explains an acknowledgement instead of pretending there are prices", () => {
    expect(() => parseDayAheadPrices(fixture("entsoe-ack.xml"))).toThrow(SpotFeedError);
    expect(() => parseDayAheadPrices(fixture("entsoe-ack.xml"))).toThrow(
      /No matching data found/,
    );
  });

  it("refuses a document that is not a price publication", () => {
    expect(() => parseDayAheadPrices("<html><body>Gateway timeout</body></html>")).toThrow(
      SpotFeedError,
    );
  });

  it("refuses a price in a unit we do not understand", () => {
    const xml = fixture("entsoe-a44.xml").replace(
      "<price_Measure_Unit.name>MWH</price_Measure_Unit.name>",
      "<price_Measure_Unit.name>KWH</price_Measure_Unit.name>",
    );
    expect(() => parseDayAheadPrices(xml)).toThrow(/KWH/);
  });

  it("refuses a resolution we cannot place on a clock", () => {
    const xml = fixture("entsoe-a44.xml").replace(
      "<resolution>PT60M</resolution>",
      "<resolution>P1Y</resolution>",
    );
    expect(() => parseDayAheadPrices(xml)).toThrow(/P1Y/);
  });

  it("refuses a document with no points at all", () => {
    const xml = fixture("entsoe-a44.xml").replace(/<Point>[\s\S]*<\/Point>/, "");
    expect(() => parseDayAheadPrices(xml)).toThrow(SpotFeedError);
  });
});
