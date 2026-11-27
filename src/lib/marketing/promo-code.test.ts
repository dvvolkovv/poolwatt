// §42's promo code: what happens when a driver types one.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PromoCodeError, normalizePromoCode, redeemPromoCode } from "./promo-code";

const PREFIX = "test_pcode_";
const ZONE_CODE = "TESTPCODE";
const CODE = "TESTPCODE2026";

let zoneId: string;
let operatorId: string;
let driverOne: string;
let driverTwo: string;

async function wipe() {
  await prisma.promoGrant.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.campaign.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE_CODE } });
}

async function campaign(over: Partial<Prisma.CampaignUncheckedCreateInput> = {}) {
  return prisma.campaign.create({
    data: {
      operatorId,
      zoneId,
      name: "Come in with the code",
      trigger: "PROMO_CODE",
      promoCode: CODE,
      giftKwh: new Prisma.Decimal(7),
      validityDays: 30,
      budgetKwh: new Prisma.Decimal(100),
      oncePerClient: true,
      status: "ACTIVE",
      ...over,
    },
  });
}

beforeAll(async () => {
  await wipe();
  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE_CODE, country: "SK", name: "Promo code zone", currency: "EUR" },
    })
  ).id;
  const user = async (name: string) =>
    (
      await prisma.user.upsert({
        where: { username: `${PREFIX}${name}` },
        update: {},
        create: { username: `${PREFIX}${name}`, passwordHash: "x" },
      })
    ).id;
  driverOne = await user("one");
  driverTwo = await user("two");
  operatorId = (
    await prisma.chargerOperator.create({
      data: { slug: `${PREFIX}net`, displayName: "Code network", claimedAt: new Date() },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.promoGrant.deleteMany({ where: { operatorId } });
  await prisma.campaign.deleteMany({ where: { operatorId } });
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("normalizePromoCode", () => {
  it("ignores case and stray spaces", () => {
    expect(normalizePromoCode(" welcome 10 ")).toBe("WELCOME10");
  });
});

describe("redeemPromoCode", () => {
  it("gives the gift the moment the code is typed", async () => {
    const c = await campaign();

    const result = await redeemPromoCode(driverOne, CODE.toLowerCase());

    expect(result.campaignId).toBe(c.id);
    expect(result.grantIds).toHaveLength(1);
    const grant = await prisma.promoGrant.findUniqueOrThrow({ where: { id: result.grantIds[0] } });
    expect(grant.userId).toBe(driverOne);
    expect(grant.paymentId).toBeNull();
    expect(Number(grant.amountKwh)).toBe(7);
  });

  it("refuses a code nobody printed", async () => {
    await campaign();
    await expect(redeemPromoCode(driverOne, "NOSUCHCODE")).rejects.toThrow(PromoCodeError);
  });

  it("refuses a code that belongs to a campaign the partner stopped", async () => {
    await campaign({ status: "PAUSED" });
    await expect(redeemPromoCode(driverOne, CODE)).rejects.toThrow("not active");
  });

  it("refuses a code outside its dates", async () => {
    await campaign({ endsAt: new Date(Date.now() - 86_400_000) });
    await expect(redeemPromoCode(driverOne, CODE)).rejects.toThrow("expired");
  });

  it("refuses the same driver twice", async () => {
    await campaign();
    await redeemPromoCode(driverOne, CODE);
    await expect(redeemPromoCode(driverOne, CODE)).rejects.toThrow("already used");
  });

  it("gives one gift when the same code is typed twice at once", async () => {
    await campaign();

    const results = await Promise.allSettled([
      redeemPromoCode(driverOne, CODE),
      redeemPromoCode(driverOne, CODE),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.promoGrant.count({ where: { operatorId, userId: driverOne } })).toBe(1);
  });

  it("gives the gift to another driver of the same campaign", async () => {
    await campaign();
    await redeemPromoCode(driverOne, CODE);
    const second = await redeemPromoCode(driverTwo, CODE);
    expect(second.grantIds).toHaveLength(1);
  });

  it("says the budget is gone rather than pretending the code is wrong", async () => {
    await campaign({ budgetKwh: new Prisma.Decimal(7) });
    await redeemPromoCode(driverOne, CODE);
    await expect(redeemPromoCode(driverTwo, CODE)).rejects.toThrow(
      "given out everything it had",
    );
  });

  it("refuses a code that is not a promo-code campaign's", async () => {
    await campaign({ trigger: "FIRST_CHARGE" });
    await expect(redeemPromoCode(driverOne, CODE)).rejects.toThrow("No such code");
  });
});
