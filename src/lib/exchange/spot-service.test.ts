// ТЗ §6, §16.5 — storing the external spot reference and pointing the zone's
// corridor at the price of the interval we are in.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { SpotFeedError } from "./spot-entsoe";
import {
  applyCurrentSpot,
  readSpotHistory,
  refreshZoneSpot,
  storeSpotPoints,
} from "./spot-service";

const ZONE = "TESTSPOT";
const fixture = readFileSync(
  join(__dirname, "__fixtures__", "entsoe-a44.xml"),
  "utf8",
);

let zoneId: string;

async function cleanup() {
  const zone = await prisma.gridZone.findUnique({ where: { code: ZONE } });
  if (!zone) return;
  await prisma.zoneSpotPrice.deleteMany({ where: { zoneId: zone.id } });
  await prisma.auditLog.deleteMany({ where: { entityId: zone.id } });
  await prisma.gridZone.delete({ where: { id: zone.id } });
}

beforeAll(async () => {
  await cleanup();
  const zone = await prisma.gridZone.create({
    data: {
      code: ZONE,
      country: "SK",
      name: "Spot Zone",
      currency: "EUR",
      intervalMinutes: 60,
      corridorPct: new Prisma.Decimal(20),
      spotSource: "entsoe",
      spotAreaCode: "10YSK-SEPS---K",
    },
  });
  zoneId = zone.id;
});

beforeEach(async () => {
  await prisma.zoneSpotPrice.deleteMany({ where: { zoneId } });
  await prisma.gridZone.update({
    where: { id: zoneId },
    data: { spotPrice: null, spotPriceAt: null },
  });
  vi.unstubAllEnvs();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await cleanup();
});

describe("storeSpotPoints", () => {
  it("writes the history and is safe to run twice on the same day", async () => {
    const points = [
      { intervalStart: new Date("2026-11-24T10:00:00.000Z"), resolutionMinutes: 60, pricePerKwh: 0.1 },
      { intervalStart: new Date("2026-11-24T11:00:00.000Z"), resolutionMinutes: 60, pricePerKwh: 0.12 },
    ];
    const first = await storeSpotPoints(zoneId, { currency: "EUR", points }, "entsoe");
    const second = await storeSpotPoints(zoneId, { currency: "EUR", points }, "entsoe");

    expect(first).toBe(2);
    expect(second).toBe(2);
    expect(await prisma.zoneSpotPrice.count({ where: { zoneId } })).toBe(2);
  });

  it("takes a corrected price for an interval already stored", async () => {
    const at = new Date("2026-11-24T10:00:00.000Z");
    await storeSpotPoints(
      zoneId,
      { currency: "EUR", points: [{ intervalStart: at, resolutionMinutes: 60, pricePerKwh: 0.1 }] },
      "entsoe",
    );
    await storeSpotPoints(
      zoneId,
      { currency: "EUR", points: [{ intervalStart: at, resolutionMinutes: 60, pricePerKwh: 0.15 }] },
      "entsoe",
    );

    const rows = await prisma.zoneSpotPrice.findMany({ where: { zoneId } });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].price)).toBe(0.15);
  });
});

describe("applyCurrentSpot", () => {
  const points = [
    { intervalStart: new Date("2026-11-24T10:00:00.000Z"), resolutionMinutes: 60, pricePerKwh: 0.1 },
    { intervalStart: new Date("2026-11-24T11:00:00.000Z"), resolutionMinutes: 60, pricePerKwh: 0.12 },
    { intervalStart: new Date("2026-11-24T12:00:00.000Z"), resolutionMinutes: 60, pricePerKwh: 0.14 },
  ];

  it("puts the price of the interval we are in on the zone", async () => {
    await storeSpotPoints(zoneId, { currency: "EUR", points }, "entsoe");
    const applied = await applyCurrentSpot(zoneId, new Date("2026-11-24T11:30:00.000Z"));

    expect(applied).toBe(0.12);
    const zone = await prisma.gridZone.findUniqueOrThrow({ where: { id: zoneId } });
    expect(Number(zone.spotPrice)).toBe(0.12);
    expect(zone.spotPriceAt).toEqual(new Date("2026-11-24T11:00:00.000Z"));
  });

  it("leaves the zone alone when no price covers the moment", async () => {
    await prisma.gridZone.update({
      where: { id: zoneId },
      data: { spotPrice: new Prisma.Decimal(0.2), spotPriceAt: new Date("2026-11-01T00:00:00.000Z") },
    });
    await storeSpotPoints(zoneId, { currency: "EUR", points }, "entsoe");

    // Two days before anything was published: better yesterday's reference
    // than no corridor at all (§16.5).
    const applied = await applyCurrentSpot(zoneId, new Date("2026-11-22T11:30:00.000Z"));
    expect(applied).toBeNull();
    const zone = await prisma.gridZone.findUniqueOrThrow({ where: { id: zoneId } });
    expect(Number(zone.spotPrice)).toBe(0.2);
  });

  it("does not reach into the future for a price", async () => {
    await storeSpotPoints(zoneId, { currency: "EUR", points }, "entsoe");
    expect(await applyCurrentSpot(zoneId, new Date("2026-11-24T09:59:00.000Z"))).toBeNull();
  });
});

describe("refreshZoneSpot", () => {
  it("does nothing while the feed is closed", async () => {
    const result = await refreshZoneSpot(zoneId, { fetch: async () => fixture });
    expect(result).toEqual({ status: "skipped", reason: "feed-closed" });
    expect(await prisma.zoneSpotPrice.count({ where: { zoneId } })).toBe(0);
  });

  it("stores a day and applies the current interval", async () => {
    vi.stubEnv("ENTSOE_TOKEN", "test-token");
    const result = await refreshZoneSpot(zoneId, {
      fetch: async () => fixture,
      now: new Date("2026-11-24T10:30:00.000Z"),
    });

    expect(result).toMatchObject({ status: "refreshed", stored: 24 });
    expect(await prisma.zoneSpotPrice.count({ where: { zoneId } })).toBe(24);
    const zone = await prisma.gridZone.findUniqueOrThrow({ where: { id: zoneId } });
    // 11:00 local-UTC slot of the fixture: position 12, 88.14 €/MWh.
    expect(Number(zone.spotPrice)).toBe(0.0881);
  });

  it("passes the zone's area code and token to the source", async () => {
    vi.stubEnv("ENTSOE_TOKEN", "test-token");
    let seen = "";
    await refreshZoneSpot(zoneId, {
      fetch: async (url) => {
        seen = url;
        return fixture;
      },
      now: new Date("2026-11-24T10:30:00.000Z"),
    });
    expect(seen).toContain("in_Domain=10YSK-SEPS---K");
    expect(seen).toContain("securityToken=test-token");
  });

  it("keeps the previous price when the source fails", async () => {
    vi.stubEnv("ENTSOE_TOKEN", "test-token");
    await prisma.gridZone.update({
      where: { id: zoneId },
      data: { spotPrice: new Prisma.Decimal(0.2), spotPriceAt: new Date() },
    });

    const result = await refreshZoneSpot(zoneId, {
      fetch: async () => {
        throw new Error("ECONNRESET");
      },
    });

    expect(result.status).toBe("failed");
    const zone = await prisma.gridZone.findUniqueOrThrow({ where: { id: zoneId } });
    expect(Number(zone.spotPrice)).toBe(0.2);
  });

  it("reports an unusable document as a failure, not as prices", async () => {
    vi.stubEnv("ENTSOE_TOKEN", "test-token");
    const result = await refreshZoneSpot(zoneId, { fetch: async () => "<html>502</html>" });
    expect(result.status).toBe("failed");
    expect(result.status === "failed" && result.error).toMatch(/publication document/i);
    expect(await prisma.zoneSpotPrice.count({ where: { zoneId } })).toBe(0);
  });

  it("skips a zone that has no area code to ask about", async () => {
    vi.stubEnv("ENTSOE_TOKEN", "test-token");
    await prisma.gridZone.update({ where: { id: zoneId }, data: { spotAreaCode: null } });
    const result = await refreshZoneSpot(zoneId, { fetch: async () => fixture });
    expect(result).toEqual({ status: "skipped", reason: "no-area-code" });
    await prisma.gridZone.update({
      where: { id: zoneId },
      data: { spotAreaCode: "10YSK-SEPS---K" },
    });
  });

  it("skips a zone the operator prices by hand", async () => {
    vi.stubEnv("ENTSOE_TOKEN", "test-token");
    await prisma.gridZone.update({ where: { id: zoneId }, data: { spotSource: "manual" } });
    const result = await refreshZoneSpot(zoneId, { fetch: async () => fixture });
    expect(result).toEqual({ status: "skipped", reason: "manual" });
    await prisma.gridZone.update({ where: { id: zoneId }, data: { spotSource: "entsoe" } });
  });

  it("surfaces an acknowledgement as a failure with the platform's words", async () => {
    vi.stubEnv("ENTSOE_TOKEN", "test-token");
    const ack = readFileSync(join(__dirname, "__fixtures__", "entsoe-ack.xml"), "utf8");
    const result = await refreshZoneSpot(zoneId, { fetch: async () => ack });
    expect(result.status).toBe("failed");
    expect(result.status === "failed" && result.error).toMatch(/No matching data/);
    expect(SpotFeedError.name).toBe("SpotFeedError");
  });
});

describe("readSpotHistory", () => {
  it("returns the newest intervals first, for the operator's page", async () => {
    await storeSpotPoints(
      zoneId,
      {
        currency: "EUR",
        points: [
          { intervalStart: new Date("2026-11-24T10:00:00.000Z"), resolutionMinutes: 60, pricePerKwh: 0.1 },
          { intervalStart: new Date("2026-11-24T12:00:00.000Z"), resolutionMinutes: 60, pricePerKwh: 0.14 },
          { intervalStart: new Date("2026-11-24T11:00:00.000Z"), resolutionMinutes: 60, pricePerKwh: 0.12 },
        ],
      },
      "entsoe",
    );

    const rows = await readSpotHistory(zoneId, 2);
    expect(rows.map((r) => r.price)).toEqual([0.14, 0.12]);
  });
});
