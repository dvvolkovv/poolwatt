// §54 — every one of the five places a partner can change a tariff has to
// leave a version behind. Before this, four of the five changed the number in
// place and the history was whatever the audit log happened to mention.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { savePointStep } from "@/lib/points/point-service";
import { savePolicy } from "@/lib/reservations/reservation-service";
import { updateSaleRules } from "@/lib/exchange/asset-service";
import { setNetworkPrice } from "./network-price";
import { currentPricing, readPricingHistory } from "./pricing-service";

const PREFIX = "test_pricewr_";
const ZONE_CODE = "TESTPRICEWR";

let zoneId: string;
let operatorId: string;
let ownerUserId: string;
let pointId: string;
let companyId: string;
let assetId: string;

async function wipe() {
  await prisma.pricingRule.deleteMany({
    where: {
      OR: [
        { operator: { slug: { startsWith: PREFIX } } },
        { company: { regNumber: `${PREFIX}reg` } },
      ],
    },
  });
  await prisma.reservationPolicy.deleteMany({
    where: { point: { operator: { slug: { startsWith: PREFIX } } } },
  });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.asset.deleteMany({ where: { company: { regNumber: `${PREFIX}reg` } } });
  await prisma.company.deleteMany({ where: { regNumber: `${PREFIX}reg` } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE_CODE } });
}

beforeAll(async () => {
  await wipe();

  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE_CODE, country: "SK", name: "Pricing writes zone", currency: "EUR" },
    })
  ).id;

  ownerUserId = (
    await prisma.user.upsert({
      where: { username: `${PREFIX}owner` },
      update: {},
      create: { username: `${PREFIX}owner`, passwordHash: "x" },
    })
  ).id;

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: `${PREFIX}net`,
        displayName: "Pricing writes network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  pointId = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "A", gridZoneId: zoneId },
    })
  ).id;

  const company = await prisma.company.create({
    data: {
      legalName: "Pricing writes producer",
      country: "SK",
      regNumber: `${PREFIX}reg`,
      type: "PRODUCER",
      kybStatus: "APPROVED",
      ownerUserId,
    },
  });
  companyId = company.id;
  assetId = (
    await prisma.asset.create({
      data: {
        companyId,
        gridZoneId: zoneId,
        kind: "STORAGE",
        name: "Pricing writes battery",
        capacityKw: new Prisma.Decimal(50),
        storageKwh: new Prisma.Decimal(100),
        status: "ACTIVE",
      },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.pricingRule.deleteMany({ where: { OR: [{ operatorId }, { companyId }] } });
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("point tariffs (§52 'Цены кВт·ч … по времени суток')", () => {
  it("records a version with the numbers that were saved", async () => {
    await savePointStep(pointId, ownerUserId, "tariffs", {
      tariffs: [
        {
          fromMinute: 0,
          toMinute: 1440,
          priceFiat: 0.42,
          currency: "EUR",
          priceTokens: 1.05,
          idleFeePerMin: 0.05,
          coopDiscount: 10,
        },
      ],
    });

    const rule = await currentPricing("POINT_TARIFF", pointId);
    expect(rule?.version).toBe(1);
    expect(rule?.operatorId).toBe(operatorId);
    expect(rule?.createdById).toBe(ownerUserId);
    const params = rule?.params as { tariffs: Record<string, unknown>[] };
    expect(params.tariffs).toHaveLength(1);
    expect(params.tariffs[0].priceFiat).toBe(0.42);
    expect(params.tariffs[0].priceTokens).toBe(1.05);
    expect(params.tariffs[0].idleFeePerMin).toBe(0.05);
    expect(params.tariffs[0].coopDiscount).toBe(10);
  });

  it("counts up on the next change and keeps the old one readable", async () => {
    await savePointStep(pointId, ownerUserId, "tariffs", {
      tariffs: [{ fromMinute: 0, toMinute: 1440, priceFiat: 0.42, currency: "EUR" }],
    });
    await savePointStep(pointId, ownerUserId, "tariffs", {
      tariffs: [{ fromMinute: 0, toMinute: 1440, priceFiat: 0.5, currency: "EUR" }],
    });

    const history = await readPricingHistory("POINT_TARIFF", pointId);
    expect(history.map((h) => h.version)).toEqual([2, 1]);
    const old = history[1].params as { tariffs: { priceFiat: number }[] };
    expect(old.tariffs[0].priceFiat).toBe(0.42);
  });

  it("leaves no version for a step that is not about money", async () => {
    await savePointStep(pointId, ownerUserId, "address", {
      country: "SK",
      city: "Košice",
      addressLine: "Hlavná 5",
      latitude: 48.7,
      longitude: 21.2,
      gridZoneId: zoneId,
    });
    expect(await currentPricing("POINT_TARIFF", pointId)).toBeNull();
  });
});

describe("booking terms (§33, §52 'Плата за бронь, гарантия, штраф')", () => {
  it("records a version with the terms that were saved", async () => {
    await savePolicy(pointId, ownerUserId, {
      enabled: true,
      feeFiat: 2,
      guaranteeFiat: 5,
      noShowPenaltyFiat: 3,
      freeCancelMinutes: 30,
    });

    const rule = await currentPricing("RESERVATION_POLICY", pointId);
    expect(rule?.version).toBe(1);
    const params = rule?.params as Record<string, unknown>;
    expect(params.feeFiat).toBe(2);
    expect(params.guaranteeFiat).toBe(5);
    expect(params.noShowPenaltyFiat).toBe(3);
  });
});

describe("sale rules (§30, §52 'Минимальная цена продажи и доли выработки')", () => {
  it("records a version against the company that owns the asset", async () => {
    await updateSaleRules({
      assetId,
      actorUserId: ownerUserId,
      minSalePrice: 0.18,
      reserveSocPct: 20,
      shareToMarketPct: 70,
      shareToStoragePct: 20,
      shareToSelfPct: 10,
    });

    const rule = await currentPricing("SALE_RULES", assetId);
    expect(rule?.version).toBe(1);
    expect(rule?.companyId).toBe(companyId);
    const params = rule?.params as Record<string, unknown>;
    expect(params.minSalePrice).toBe(0.18);
    expect(params.reserveSocPct).toBe(20);
    expect(params.shareToMarketPct).toBe(70);
  });
});

describe("one price for the whole network (§52)", () => {
  it("records a version and sets the live price", async () => {
    await setNetworkPrice({
      operatorId,
      actorId: ownerUserId,
      pricePerKwh: 0.39,
      currency: "EUR",
    });

    const rule = await currentPricing("NETWORK_PRICE", operatorId);
    expect(rule?.version).toBe(1);
    const params = rule?.params as Record<string, unknown>;
    expect(params.pricePerKwh).toBe(0.39);
    expect(params.currency).toBe("EUR");

    const op = await prisma.chargerOperator.findUniqueOrThrow({ where: { id: operatorId } });
    expect(Number(op.pricePerKwh)).toBe(0.39);
    expect(op.priceUpdatedAt).not.toBeNull();
  });

  it("records clearing the price as a version of its own", async () => {
    await setNetworkPrice({ operatorId, actorId: ownerUserId, pricePerKwh: 0.39, currency: "EUR" });
    await setNetworkPrice({ operatorId, actorId: ownerUserId, pricePerKwh: null, currency: null });

    const history = await readPricingHistory("NETWORK_PRICE", operatorId);
    expect(history.map((h) => h.version)).toEqual([2, 1]);
    expect((history[0].params as Record<string, unknown>).pricePerKwh).toBeNull();

    const op = await prisma.chargerOperator.findUniqueOrThrow({ where: { id: operatorId } });
    expect(op.pricePerKwh).toBeNull();
  });

  it("refuses somebody else's network", async () => {
    const stranger = await prisma.user.upsert({
      where: { username: `${PREFIX}stranger` },
      update: {},
      create: { username: `${PREFIX}stranger`, passwordHash: "x" },
    });
    await expect(
      setNetworkPrice({
        operatorId,
        actorId: stranger.id,
        pricePerKwh: 0.1,
        currency: "EUR",
      }),
    ).rejects.toThrow();
    expect(await currentPricing("NETWORK_PRICE", operatorId)).toBeNull();
  });

  it("writes the price and the version together or not at all", async () => {
    await expect(
      setNetworkPrice({
        operatorId: "no-such-operator",
        actorId: ownerUserId,
        pricePerKwh: 0.1,
        currency: "EUR",
      }),
    ).rejects.toThrow();
    expect(await prisma.pricingRule.count({ where: { scope: "NETWORK_PRICE" } })).toBe(0);
  });
});
