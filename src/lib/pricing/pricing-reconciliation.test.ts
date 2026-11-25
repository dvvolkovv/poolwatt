// §54 says the journal is the record of every tariff change. That only holds
// while the journal is the only writer — a stray `prisma.chargerOperator.
// update` would leave the live price saying one thing and the history another,
// and every receipt rebuilt from the journal would be wrong.
//
// So the nightly reconciliation (§16.11) compares the two and reports a
// disagreement. Nothing is repaired: a drift here is a bug in the code, not a
// number to patch.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { reconcileRegistry } from "@/lib/exchange/reconciliation-service";
import { setNetworkPrice } from "./network-price";

const PREFIX = "test_pricerec_";

let operatorId: string;
let ownerUserId: string;

async function wipe() {
  await prisma.pricingRule.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

async function run() {
  const outcome = await reconcileRegistry({
    // Nothing else: this run is only about one network's tariffs.
    assetIds: [],
    walletIds: [],
    operatorIds: [operatorId],
    notify: async () => {},
  });
  return outcome.checks.find((c) => c.name === "tariff-journal")!;
}

beforeAll(async () => {
  await wipe();
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
        displayName: "Pricing reconciliation network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.pricingRule.deleteMany({ where: { operatorId } });
  await prisma.chargerOperator.update({
    where: { id: operatorId },
    data: { pricePerKwh: null, priceCurrency: null, priceUpdatedAt: null },
  });
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  await prisma.reconciliationRun.deleteMany({ where: { scope: "daily" } });
});

describe("tariff-journal check", () => {
  it("finds no drift when the price was set through the journal", async () => {
    await setNetworkPrice({
      operatorId,
      actorId: ownerUserId,
      pricePerKwh: 0.39,
      currency: "EUR",
    });

    const check = await run();
    expect(check.checked).toBe(1);
    expect(check.drifts).toEqual([]);
  });

  it("finds the drift when somebody writes the price straight into the table", async () => {
    await setNetworkPrice({
      operatorId,
      actorId: ownerUserId,
      pricePerKwh: 0.39,
      currency: "EUR",
    });
    // The bug this check exists for.
    await prisma.chargerOperator.update({
      where: { id: operatorId },
      data: { pricePerKwh: new Prisma.Decimal(0.75) },
    });

    const check = await run();
    expect(check.drifts).toHaveLength(1);
    expect(check.drifts[0].subject).toBe(operatorId);
    expect(check.drifts[0].expected).toBe(0.39);
    expect(check.drifts[0].actual).toBe(0.75);
  });

  it("counts a network whose price was never set as nothing to compare", async () => {
    const check = await run();
    expect(check.checked).toBe(0);
    expect(check.drifts).toEqual([]);
  });

  it("reports a live price with no version at all", async () => {
    await prisma.chargerOperator.update({
      where: { id: operatorId },
      data: { pricePerKwh: new Prisma.Decimal(0.5), priceCurrency: "EUR" },
    });

    const check = await run();
    expect(check.drifts).toHaveLength(1);
    expect(check.drifts[0].note).toMatch(/no version/i);
  });

  it("finds no drift when the price was cleared through the journal", async () => {
    await setNetworkPrice({
      operatorId,
      actorId: ownerUserId,
      pricePerKwh: 0.39,
      currency: "EUR",
    });
    await setNetworkPrice({ operatorId, actorId: ownerUserId, pricePerKwh: null, currency: null });

    const check = await run();
    expect(check.drifts).toEqual([]);
  });

  it("makes the whole run fail when the journal disagrees", async () => {
    await setNetworkPrice({
      operatorId,
      actorId: ownerUserId,
      pricePerKwh: 0.39,
      currency: "EUR",
    });
    await prisma.chargerOperator.update({
      where: { id: operatorId },
      data: { pricePerKwh: new Prisma.Decimal(0.75) },
    });

    const outcome = await reconcileRegistry({
      assetIds: [],
      walletIds: [],
      operatorIds: [operatorId],
      notify: async () => {},
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.driftCount).toBeGreaterThan(0);
  });
});
