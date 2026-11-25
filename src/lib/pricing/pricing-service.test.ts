// §54 — "Любое изменение тарифа версионируется: новые сделки идут по новой
// версии, текущие брони и заявки — по старой."
//
// What belongs here is the journal itself: that a version is a number nobody
// can reuse, that "what applied at moment T" has one answer, and that a
// rolled-back change leaves no version claiming it happened.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  PricingError,
  pricingAt,
  readNetworkPricing,
  readPricingHistory,
  recordPricingChange,
} from "./pricing-service";

const PREFIX = "test_pricever_";

let operatorId: string;
let otherOperatorId: string;
let actorId: string;
let pointId: string;

async function wipe() {
  await prisma.pricingRule.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await wipe();

  actorId = (
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
        displayName: "Pricing version network",
        claimedById: actorId,
        claimedAt: new Date(),
      },
    })
  ).id;
  otherOperatorId = (
    await prisma.chargerOperator.create({
      data: { slug: `${PREFIX}other`, displayName: "Somebody else" },
    })
  ).id;
  pointId = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "A" },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.pricingRule.deleteMany({
    where: { operatorId: { in: [operatorId, otherOperatorId] } },
  });
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

const netPrice = (pricePerKwh: number) => ({
  scope: "NETWORK_PRICE" as const,
  scopeId: operatorId,
  operatorId,
  params: { pricePerKwh, currency: "EUR" },
  actorId,
});

describe("recordPricingChange", () => {
  it("numbers the first change 1 and the next 2", async () => {
    const first = await recordPricingChange(prisma, netPrice(0.3));
    const second = await recordPricingChange(prisma, netPrice(0.35));

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
  });

  it("keeps the parameters exactly as they were given", async () => {
    const rule = await recordPricingChange(prisma, {
      ...netPrice(0.3),
      params: { pricePerKwh: 0.3, currency: "EUR", windows: [{ from: 0, to: 1440 }] },
      note: "Winter price",
    });

    expect(rule.params).toEqual({
      pricePerKwh: 0.3,
      currency: "EUR",
      windows: [{ from: 0, to: 1440 }],
    });
    expect(rule.note).toBe("Winter price");
    expect(rule.createdById).toBe(actorId);
  });

  it("counts versions per scope and per thing, not globally", async () => {
    await recordPricingChange(prisma, netPrice(0.3));
    const point = await recordPricingChange(prisma, {
      scope: "POINT_TARIFF",
      scopeId: pointId,
      operatorId,
      params: { tariffs: [] },
      actorId,
    });
    const otherNet = await recordPricingChange(prisma, {
      scope: "NETWORK_PRICE",
      scopeId: otherOperatorId,
      operatorId: otherOperatorId,
      params: { pricePerKwh: 1 },
      actorId,
    });

    expect(point.version).toBe(1);
    expect(otherNet.version).toBe(1);
  });

  it("does not hand the same version to two changes saved at once", async () => {
    const saves = Array.from({ length: 5 }, (_, i) => recordPricingChange(prisma, netPrice(0.3 + i)));
    const rules = await Promise.all(saves);

    const versions = rules.map((r) => r.version).sort((a, b) => a - b);
    expect(versions).toEqual([1, 2, 3, 4, 5]);
  });

  it("refuses a change with no owner — a tariff nobody set is not a tariff", async () => {
    await expect(
      recordPricingChange(prisma, {
        scope: "NETWORK_PRICE",
        scopeId: operatorId,
        params: { pricePerKwh: 0.3 },
        actorId,
      }),
    ).rejects.toThrow(PricingError);
  });

  it("leaves no version behind when the change it records is rolled back", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await recordPricingChange(tx, netPrice(0.3));
        throw new Error("the live write failed");
      }),
    ).rejects.toThrow("the live write failed");

    expect(await prisma.pricingRule.count({ where: { operatorId } })).toBe(0);
  });
});

describe("pricingAt — what applied at that moment", () => {
  it("answers with nothing before the first version", async () => {
    await recordPricingChange(prisma, netPrice(0.3));
    const before = new Date(Date.now() - 86_400_000);
    expect(await pricingAt("NETWORK_PRICE", operatorId, before)).toBeNull();
  });

  it("answers with the version in force, not the newest", async () => {
    const first = await recordPricingChange(prisma, netPrice(0.3));
    // A moment between the two changes.
    const between = new Date(first.activeFrom.getTime() + 1);
    await new Promise((r) => setTimeout(r, 5));
    await recordPricingChange(prisma, netPrice(0.45));

    const applied = await pricingAt("NETWORK_PRICE", operatorId, between);
    expect(applied?.version).toBe(1);
    expect(applied?.params).toEqual({ pricePerKwh: 0.3, currency: "EUR" });
  });

  it("answers with the newest version for a moment in the future", async () => {
    await recordPricingChange(prisma, netPrice(0.3));
    const second = await recordPricingChange(prisma, netPrice(0.45));

    const applied = await pricingAt("NETWORK_PRICE", operatorId, new Date(Date.now() + 86_400_000));
    expect(applied?.version).toBe(second.version);
  });

  it("answers with nothing about a thing that has no versions", async () => {
    expect(await pricingAt("POINT_TARIFF", pointId, new Date())).toBeNull();
  });
});

describe("readPricingHistory / readNetworkPricing", () => {
  it("lists one thing's versions, newest first", async () => {
    await recordPricingChange(prisma, netPrice(0.3));
    await recordPricingChange(prisma, netPrice(0.35));
    await recordPricingChange(prisma, netPrice(0.4));

    const history = await readPricingHistory("NETWORK_PRICE", operatorId);
    expect(history.map((h) => h.version)).toEqual([3, 2, 1]);
  });

  it("lists everything one network has ever set, whatever the scope", async () => {
    await recordPricingChange(prisma, netPrice(0.3));
    await recordPricingChange(prisma, {
      scope: "POINT_TARIFF",
      scopeId: pointId,
      operatorId,
      params: { tariffs: [{ fromMinute: 0, toMinute: 1440, priceFiat: 0.42 }] },
      actorId,
    });

    const all = await readNetworkPricing(operatorId);
    expect(all).toHaveLength(2);
    expect(new Set(all.map((r) => r.scope))).toEqual(new Set(["NETWORK_PRICE", "POINT_TARIFF"]));
  });

  it("says nothing about somebody else's network", async () => {
    await recordPricingChange(prisma, netPrice(0.3));
    expect(await readNetworkPricing(otherOperatorId)).toEqual([]);
  });

  it("names who made each change, so a history is a history", async () => {
    await recordPricingChange(prisma, { ...netPrice(0.3), note: "Opening price" });
    const [latest] = await readPricingHistory("NETWORK_PRICE", operatorId);
    expect(latest.createdById).toBe(actorId);
    expect(latest.note).toBe("Opening price");
  });
});
