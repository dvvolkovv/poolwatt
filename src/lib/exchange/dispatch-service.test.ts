// US-28 — "задать минимальную цену продажи и резерв заряда", with the
// criterion "правила применяются диспетчером со следующего интервала".
//
// Until now the rules were stored and nobody read them: nothing placed a sell
// order for a producer, so freshly minted kWh sat in the wallet until the
// owner went to the terminal by hand.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { num } from "./decimal";
import { dispatchZone, withdrawStaleOffers } from "./dispatch-service";
import { getOrCreateWallet } from "./wallet-service";

const PREFIX = "test_dispatch_";
const ZONE_CODE = "TESTDISPATCH";
const INTERVAL_MINUTES = 60;

let zoneId: string;
let companyId: string;
let ownerUserId: string;

const INTERVAL = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - 3_600_000);

async function wipe() {
  const zone = await prisma.gridZone.findUnique({ where: { code: ZONE_CODE } });
  if (!zone) return;
  await prisma.trade.deleteMany({ where: { zoneId: zone.id } });
  await prisma.order.deleteMany({ where: { zoneId: zone.id } });
  await prisma.energyToken.deleteMany({ where: { zoneId: zone.id } });
  await prisma.meterReading.deleteMany({ where: { zoneId: zone.id } });
  await prisma.wallet.deleteMany({ where: { zoneId: zone.id } });
  await prisma.asset.deleteMany({ where: { gridZoneId: zone.id } });
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
  await prisma.gridZone.delete({ where: { id: zone.id } });
}

/** An asset with its sale rules, plus one minted interval it may sell. */
async function seedAsset(args: {
  name: string;
  kind?: "SOLAR" | "STORAGE" | "MIXED";
  mintKwh: number;
  minSalePrice?: number | null;
  shareToMarketPct?: number;
  shareToStoragePct?: number;
  shareToSelfPct?: number;
  storageKwh?: number;
  storedKwh?: number;
  reserveSocPct?: number;
}) {
  const asset = await prisma.asset.create({
    data: {
      companyId,
      gridZoneId: zoneId,
      kind: args.kind ?? "SOLAR",
      name: args.name,
      capacityKw: new Prisma.Decimal(50),
      status: "ACTIVE",
      minSalePrice: args.minSalePrice == null ? null : new Prisma.Decimal(args.minSalePrice),
      shareToMarketPct: args.shareToMarketPct ?? 100,
      shareToStoragePct: args.shareToStoragePct ?? 0,
      shareToSelfPct: args.shareToSelfPct ?? 0,
      storageKwh: args.storageKwh == null ? null : new Prisma.Decimal(args.storageKwh),
      storedKwh: new Prisma.Decimal(args.storedKwh ?? 0),
      reserveSocPct: args.reserveSocPct ?? 0,
    },
  });

  const wallet = await getOrCreateWallet(ownerUserId, zoneId);
  const reading = await prisma.meterReading.create({
    data: {
      assetId: asset.id,
      zoneId,
      intervalStart: INTERVAL,
      intervalEnd: new Date(INTERVAL.getTime() + INTERVAL_MINUTES * 60 * 1000),
      energyKwh: new Prisma.Decimal(args.mintKwh),
      source: "rest",
      validationStatus: "VALID",
      mintedAt: new Date(),
    },
  });
  // Batch and balance together: a wallet holding batches it does not count is
  // exactly the drift §16.11 reports, and the suite runs files side by side.
  await prisma.$transaction([
    prisma.energyToken.create({
      data: {
        assetId: asset.id,
        zoneId,
        readingId: reading.id,
        intervalStart: INTERVAL,
        amountKwh: new Prisma.Decimal(args.mintKwh),
        ownerWalletId: wallet.id,
        status: "AVAILABLE",
      },
    }),
    prisma.wallet.update({
      where: { id: wallet.id },
      data: { kwhBalance: { increment: new Prisma.Decimal(args.mintKwh) } },
    }),
  ]);
  return asset;
}

beforeAll(async () => {
  await wipe();
  const zone = await prisma.gridZone.create({
    data: {
      code: ZONE_CODE,
      country: "SK",
      name: "Dispatch test zone",
      currency: "EUR",
      intervalMinutes: INTERVAL_MINUTES,
      corridorPct: new Prisma.Decimal(50), // 0.10 … 0.30
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

  companyId = (
    await prisma.company.create({
      data: {
        legalName: `${PREFIX}co s.r.o.`,
        country: "SK",
        regNumber: `${PREFIX}reg`,
        type: "PRODUCER",
        kybStatus: "APPROVED",
        ownerUserId,
      },
    })
  ).id;
});

afterEachCleanup();
function afterEachCleanup() {
  beforeEach(async () => {
    if (!zoneId) return;
    await prisma.trade.deleteMany({ where: { zoneId } });
    await prisma.order.deleteMany({ where: { zoneId } });
    await prisma.energyToken.deleteMany({ where: { zoneId } });
    await prisma.meterReading.deleteMany({ where: { zoneId } });
    await prisma.asset.deleteMany({ where: { gridZoneId: zoneId } });
    // Drop the wallet rather than zeroing it: a wallet whose cached balance
    // disagrees with the batches it holds is exactly what §16.11 reports as
    // drift, and the suite runs files side by side.
    await prisma.wallet.deleteMany({ where: { zoneId } });
  });
}

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("dispatchZone — selling for the producer (§30, US-28)", () => {
  it("offers the market share at the owner's minimum price", async () => {
    const asset = await seedAsset({ name: "Rule price array", mintKwh: 12, minSalePrice: 0.22 });

    const result = await dispatchZone(zoneId, INTERVAL);

    expect(result.offers).toHaveLength(1);
    const order = await prisma.order.findFirstOrThrow({ where: { zoneId, side: "SELL" } });
    expect(num(order.amountKwh)).toBe(12);
    expect(num(order.limitPrice!)).toBe(0.22);
    expect(order.status).toBe("NEW");
    expect(result.offers[0].assetId).toBe(asset.id);
  });

  it("falls back to the zone's spot reference when no minimum is set", async () => {
    await seedAsset({ name: "No rule array", mintKwh: 5, minSalePrice: null });

    await dispatchZone(zoneId, INTERVAL);

    const order = await prisma.order.findFirstOrThrow({ where: { zoneId, side: "SELL" } });
    expect(num(order.limitPrice!)).toBe(0.2);
  });

  it("offers only the market share, leaving the storage and self shares alone", async () => {
    await seedAsset({
      name: "Split array",
      mintKwh: 10,
      shareToMarketPct: 60,
      shareToStoragePct: 20,
      shareToSelfPct: 20,
    });

    await dispatchZone(zoneId, INTERVAL);

    const order = await prisma.order.findFirstOrThrow({ where: { zoneId, side: "SELL" } });
    expect(num(order.amountKwh)).toBe(6);
  });

  it("places one offer however many times it runs", async () => {
    await seedAsset({ name: "Repeat array", mintKwh: 8 });

    await dispatchZone(zoneId, INTERVAL);
    const second = await dispatchZone(zoneId, INTERVAL);

    const orders = await prisma.order.findMany({ where: { zoneId, side: "SELL" } });
    expect(orders).toHaveLength(1);
    expect(second.offers[0].replay).toBe(true);
  });

  it("does not touch an offer already standing when the rule changes", async () => {
    const asset = await seedAsset({ name: "Changed rule array", mintKwh: 4, minSalePrice: 0.21 });
    await dispatchZone(zoneId, INTERVAL);

    await prisma.asset.update({
      where: { id: asset.id },
      data: { minSalePrice: new Prisma.Decimal(0.28) },
    });
    await dispatchZone(zoneId, INTERVAL);

    const orders = await prisma.order.findMany({ where: { zoneId, side: "SELL" } });
    expect(orders).toHaveLength(1);
    expect(num(orders[0].limitPrice!)).toBe(0.21);
  });

  it("skips an asset whose minimum price is outside the zone's corridor, and says why", async () => {
    await seedAsset({ name: "Greedy array", mintKwh: 3, minSalePrice: 0.9 });

    const result = await dispatchZone(zoneId, INTERVAL);

    // The attempt is recorded — a rejected order is part of the audit trail —
    // but nothing stands in the book.
    expect(await prisma.order.count({ where: { zoneId, side: "SELL", status: "NEW" } })).toBe(0);
    expect(result.offers[0].offeredKwh).toBe(0);
    expect(result.offers[0].rejectReason).toMatch(/corridor/i);
  });

  it("has nothing to offer when the interval minted nothing", async () => {
    const result = await dispatchZone(zoneId, INTERVAL);
    expect(result.offers).toHaveLength(0);
  });
});

describe("dispatchZone — the charge reserve (§30, US-28)", () => {
  it("fills the reserve out of the market share before offering the rest", async () => {
    // 20 kWh bank, 25% reserve = 5 kWh to hold; 1 kWh already stored.
    const asset = await seedAsset({
      name: "Reserve bank",
      kind: "MIXED",
      mintKwh: 10,
      storageKwh: 20,
      storedKwh: 1,
      reserveSocPct: 25,
    });

    const result = await dispatchZone(zoneId, INTERVAL);

    const stored = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(num(stored.storedKwh)).toBe(5); // topped up to the reserve
    const order = await prisma.order.findFirstOrThrow({ where: { zoneId, side: "SELL" } });
    expect(num(order.amountKwh)).toBe(6); // 10 − 4 diverted
    expect(result.offers[0].toReserveKwh).toBe(4);
  });

  it("offers nothing while the reserve is still short", async () => {
    const asset = await seedAsset({
      name: "Hungry bank",
      kind: "STORAGE",
      mintKwh: 2,
      storageKwh: 100,
      storedKwh: 0,
      reserveSocPct: 50, // wants 50 kWh, gets 2
    });

    const result = await dispatchZone(zoneId, INTERVAL);

    expect(await prisma.order.count({ where: { zoneId, side: "SELL" } })).toBe(0);
    const stored = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(num(stored.storedKwh)).toBe(2);
    expect(result.offers[0].toReserveKwh).toBe(2);
    expect(result.offers[0].offeredKwh).toBe(0);
  });

  it("leaves a bank already above its reserve to sell everything", async () => {
    await seedAsset({
      name: "Full bank",
      kind: "MIXED",
      mintKwh: 7,
      storageKwh: 20,
      storedKwh: 15,
      reserveSocPct: 25,
    });

    await dispatchZone(zoneId, INTERVAL);

    const order = await prisma.order.findFirstOrThrow({ where: { zoneId, side: "SELL" } });
    expect(num(order.amountKwh)).toBe(7);
  });
});

describe("withdrawStaleOffers — an offer lives one interval (§16.4)", () => {
  it("takes down the offer of an earlier interval so §16.4 can route the energy", async () => {
    await seedAsset({ name: "Stale array", mintKwh: 9, minSalePrice: 0.21 });
    await dispatchZone(zoneId, INTERVAL);
    const standing = await prisma.order.findFirstOrThrow({ where: { zoneId, side: "SELL" } });
    expect(standing.status).toBe("NEW");

    const withdrawn = await withdrawStaleOffers(zoneId, INTERVAL);

    expect(withdrawn).toBe(1);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: standing.id } });
    expect(after.status).toBe("CANCELLED");
  });

  it("leaves offers of other intervals alone", async () => {
    await seedAsset({ name: "Other interval array", mintKwh: 4 });
    await dispatchZone(zoneId, INTERVAL);

    const withdrawn = await withdrawStaleOffers(
      zoneId,
      new Date(INTERVAL.getTime() - 3_600_000),
    );

    expect(withdrawn).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { zoneId, side: "SELL" } });
    expect(order.status).toBe("NEW");
  });
});
