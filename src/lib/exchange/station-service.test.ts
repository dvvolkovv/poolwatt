// US-18 and US-26 — the station console of ТЗ §30: what the owner of a
// household station sees about their own generation, and what it earned.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readStationOverview, generationSeries } from "./station-service";

const PREFIX = "test_station_";
const ZONE_CODE = "TESTSTATION";
const INTERVAL_MINUTES = 60;

let zoneId: string;
let assetId: string;
let ownerUserId: string;

/** Top of the hour, so interval arithmetic in the test is exact. */
const NOW = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

async function wipe() {
  const zone = await prisma.gridZone.findUnique({ where: { code: ZONE_CODE } });
  if (!zone) return;
  await prisma.energyToken.deleteMany({ where: { zoneId: zone.id } });
  await prisma.meterReading.deleteMany({ where: { zoneId: zone.id } });
  await prisma.trade.deleteMany({ where: { zoneId: zone.id } });
  await prisma.order.deleteMany({ where: { zoneId: zone.id } });
  await prisma.wallet.deleteMany({ where: { zoneId: zone.id } });
  await prisma.asset.deleteMany({ where: { gridZoneId: zone.id } });
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
  await prisma.gridZone.delete({ where: { id: zone.id } });
}

/** One valid reading and the batch it minted, the shape of a working hour. */
async function seedHour(args: { at: Date; energyKwh: number; status?: string }) {
  const reading = await prisma.meterReading.create({
    data: {
      assetId,
      zoneId,
      intervalStart: args.at,
      intervalEnd: new Date(args.at.getTime() + INTERVAL_MINUTES * 60 * 1000),
      energyKwh: new Prisma.Decimal(args.energyKwh),
      source: "rest",
      validationStatus: "VALID",
      mintedAt: new Date(),
    },
  });
  const token = await prisma.energyToken.create({
    data: {
      assetId,
      zoneId,
      readingId: reading.id,
      intervalStart: args.at,
      amountKwh: new Prisma.Decimal(args.energyKwh),
      status: (args.status ?? "AVAILABLE") as never,
    },
  });
  return { reading, token };
}

beforeAll(async () => {
  await wipe();
  const zone = await prisma.gridZone.create({
    data: {
      code: ZONE_CODE,
      country: "SK",
      name: "Station test zone",
      currency: "EUR",
      intervalMinutes: INTERVAL_MINUTES,
      corridorPct: new Prisma.Decimal(50),
      spotPrice: new Prisma.Decimal(0.2),
      spotPriceAt: new Date(),
    },
  });
  zoneId = zone.id;

  ownerUserId = (
    await prisma.user.upsert({
      where: { username: `${PREFIX}owner` },
      update: {},
      create: { username: `${PREFIX}owner`, passwordHash: "x" },
    })
  ).id;

  const company = await prisma.company.create({
    data: {
      legalName: `${PREFIX}co s.r.o.`,
      country: "SK",
      regNumber: `${PREFIX}reg`,
      type: "PRODUCER",
      kybStatus: "APPROVED",
      ownerUserId,
    },
  });
  const asset = await prisma.asset.create({
    data: {
      companyId: company.id,
      gridZoneId: zoneId,
      kind: "SOLAR",
      name: "Station test array",
      capacityKw: new Prisma.Decimal(10),
      status: "ACTIVE",
    },
  });
  assetId = asset.id;
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("readStationOverview — what the console shows (§30)", () => {
  it("reads generation now off the last interval, in kW", async () => {
    await seedHour({ at: hoursAgo(1), energyKwh: 4.5 });

    const view = await readStationOverview(assetId, NOW);

    // 4.5 kWh delivered over a one-hour interval is 4.5 kW.
    expect(view.nowKw).toBe(4.5);
    expect(view.lastReadingAt?.toISOString()).toBe(hoursAgo(1).toISOString());
  });

  it("totals the day, the week, the month and the year", async () => {
    await seedHour({ at: hoursAgo(2), energyKwh: 3 });
    await seedHour({ at: hoursAgo(50), energyKwh: 10 }); // this week, not today
    await seedHour({ at: hoursAgo(24 * 20), energyKwh: 7 }); // this month

    const view = await readStationOverview(assetId, NOW);

    expect(view.todayKwh).toBe(7.5); // 4.5 + 3
    expect(view.weekKwh).toBe(17.5); // + 10
    expect(view.monthKwh).toBe(24.5); // + 7
    expect(view.yearKwh).toBe(24.5);
  });

  it("flags data that has gone stale — US-18 allows fifteen minutes", async () => {
    const fresh = await readStationOverview(assetId, new Date(NOW.getTime() + 5 * 60 * 1000));
    expect(fresh.stale).toBe(false);

    const late = await readStationOverview(assetId, new Date(NOW.getTime() + 90 * 60 * 1000));
    expect(late.stale).toBe(true);
  });

  it("has nothing to say about an asset that never reported", async () => {
    const quiet = await prisma.asset.create({
      data: {
        companyId: (await prisma.company.findFirstOrThrow({
          where: { legalName: { startsWith: PREFIX } },
        })).id,
        gridZoneId: zoneId,
        kind: "SOLAR",
        name: "Silent array",
        capacityKw: new Prisma.Decimal(5),
        status: "ACTIVE",
      },
    });
    const view = await readStationOverview(quiet.id, NOW);
    expect(view.nowKw).toBeNull();
    expect(view.todayKwh).toBe(0);
    expect(view.lastReadingAt).toBeNull();
    // Never having reported is not the same as having gone quiet.
    expect(view.stale).toBe(false);
  });
});

describe("readStationOverview — revenue (§30, US-26)", () => {
  it("adds up what the asset's batches earned, net of the seller's fee", async () => {
    const { token } = await seedHour({ at: hoursAgo(3), energyKwh: 6, status: "SOLD" });

    const sellerWallet = await prisma.wallet.create({
      data: { ownerUserId, zoneId, currency: "EUR" },
    });
    const buyerUser = await prisma.user.upsert({
      where: { username: `${PREFIX}buyer` },
      update: {},
      create: { username: `${PREFIX}buyer`, passwordHash: "x" },
    });
    const buyerWallet = await prisma.wallet.create({
      data: { ownerUserId: buyerUser.id, zoneId, currency: "EUR" },
    });
    const sellOrder = await prisma.order.create({
      data: {
        walletId: sellerWallet.id,
        zoneId,
        side: "SELL",
        type: "LIMIT",
        amountKwh: new Prisma.Decimal(6),
        limitPrice: new Prisma.Decimal(0.25),
        status: "FILLED",
      },
    });
    const buyOrder = await prisma.order.create({
      data: {
        walletId: buyerWallet.id,
        zoneId,
        side: "BUY",
        type: "MARKET",
        amountKwh: new Prisma.Decimal(6),
        status: "FILLED",
      },
    });
    const trade = await prisma.trade.create({
      data: {
        zoneId,
        buyOrderId: buyOrder.id,
        sellOrderId: sellOrder.id,
        amountKwh: new Prisma.Decimal(6),
        price: new Prisma.Decimal(0.25),
        sellerFee: new Prisma.Decimal(0.03),
      },
    });
    await prisma.energyToken.update({
      where: { id: token.id },
      data: { soldTradeId: trade.id },
    });

    const view = await readStationOverview(assetId, NOW);

    // 6 kWh × 0.25 = 1.50, less the 0.03 the seller paid on the whole trade.
    expect(view.revenue.soldKwh).toBe(6);
    expect(view.revenue.net).toBe(1.47);
    expect(view.revenue.avgPrice).toBe(0.25);
  });

  it("says nothing about revenue when nothing was sold", async () => {
    const quiet = await prisma.asset.findFirstOrThrow({ where: { name: "Silent array" } });
    const view = await readStationOverview(quiet.id, NOW);
    expect(view.revenue.soldKwh).toBe(0);
    expect(view.revenue.net).toBe(0);
    expect(view.revenue.avgPrice).toBeNull();
  });
});

describe("generationSeries — the chart of US-18", () => {
  // Its own asset, so the totals do not move when another test seeds a batch.
  let chartAssetId: string;

  beforeAll(async () => {
    const company = await prisma.company.findFirstOrThrow({
      where: { legalName: { startsWith: PREFIX } },
    });
    const asset = await prisma.asset.create({
      data: {
        companyId: company.id,
        gridZoneId: zoneId,
        kind: "SOLAR",
        name: "Chart array",
        capacityKw: new Prisma.Decimal(10),
        status: "ACTIVE",
      },
    });
    chartAssetId = asset.id;

    const seed = async (at: Date, energyKwh: number, status = "VALID") => {
      await prisma.meterReading.create({
        data: {
          assetId: chartAssetId,
          zoneId,
          intervalStart: at,
          intervalEnd: new Date(at.getTime() + INTERVAL_MINUTES * 60 * 1000),
          energyKwh: new Prisma.Decimal(energyKwh),
          source: "rest",
          validationStatus: status as never,
          mintedAt: status === "VALID" ? new Date() : null,
        },
      });
    };
    await seed(hoursAgo(1), 4.5);
    await seed(hoursAgo(2), 3);
    await seed(hoursAgo(50), 10); // this week, not today
    await seed(hoursAgo(24 * 20), 7); // this month
    await seed(hoursAgo(4), 999, "REJECTED"); // never counted
  });

  it("gives one point per interval over a day", async () => {
    const series = await generationSeries(chartAssetId, "day", NOW);
    expect(series.bucket).toBe("interval");
    expect(series.points.reduce((sum, p) => sum + p.kwh, 0)).toBeCloseTo(7.5, 3);
    expect(series.points.some((p) => p.kwh === 4.5)).toBe(true);
  });

  it("gives one point per day over a week and a month", async () => {
    const week = await generationSeries(chartAssetId, "week", NOW);
    expect(week.bucket).toBe("day");
    expect(week.points.reduce((sum, p) => sum + p.kwh, 0)).toBeCloseTo(17.5, 3);

    const month = await generationSeries(chartAssetId, "month", NOW);
    expect(month.bucket).toBe("day");
    expect(month.points.reduce((sum, p) => sum + p.kwh, 0)).toBeCloseTo(24.5, 3);
  });

  it("leaves out readings the validator rejected", async () => {
    const series = await generationSeries(chartAssetId, "day", NOW);
    expect(series.points.every((p) => p.kwh < 100)).toBe(true);
  });
});
