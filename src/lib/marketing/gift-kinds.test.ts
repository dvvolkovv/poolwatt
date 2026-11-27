// §42's gift kinds at issue time: the combination of energy and a free
// booking, the count ceiling for a gift that costs no kWh, the discount whose
// ceiling is reserved out of the budget, and the two triggers a charge does
// not earn.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/exchange/decimal";
import { awardAfterCharge, expireGrants } from "./campaign-engine";

const PREFIX = "test_gkind_";
const ZONE_CODE = "TESTGKIND";

let zoneId: string;
let operatorId: string;
let partnerUserId: string;
let driverOne: string;
let driverTwo: string;
let pointA: string;

async function wipe() {
  await prisma.promoGrant.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.campaign.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.payment.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE_CODE } });
}

async function charge(userId: string) {
  const wallet = await prisma.wallet.upsert({
    where: { ownerUserId_zoneId: { ownerUserId: userId, zoneId } },
    update: {},
    create: { ownerUserId: userId, zoneId },
  });
  const at = new Date();
  return prisma.payment.create({
    data: {
      walletId: wallet.id,
      zoneId,
      pointId: pointA,
      requestedKwh: new Prisma.Decimal(10),
      kwhFromBalance: new Prisma.Decimal(10),
      status: "CAPTURED",
      capturedAt: at,
      endedAt: at,
    },
  });
}

async function campaign(over: Partial<Prisma.CampaignUncheckedCreateInput> = {}) {
  return prisma.campaign.create({
    data: {
      operatorId,
      zoneId,
      name: "Gift kinds",
      trigger: "FIRST_CHARGE",
      giftKwh: new Prisma.Decimal(5),
      validityDays: 30,
      budgetKwh: new Prisma.Decimal(100),
      status: "ACTIVE",
      ...over,
    },
  });
}

beforeAll(async () => {
  await wipe();
  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE_CODE, country: "SK", name: "Gift kind zone", currency: "EUR" },
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
  partnerUserId = await user("partner");
  driverOne = await user("one");
  driverTwo = await user("two");
  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: `${PREFIX}net`,
        displayName: "Gift kind network",
        claimedById: partnerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  pointA = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "A", gridZoneId: zoneId },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.promoGrant.deleteMany({ where: { operatorId } });
  await prisma.campaign.deleteMany({ where: { operatorId } });
  await prisma.payment.deleteMany({ where: { zoneId } });
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("§42 'комбинация' — one campaign, two gifts", () => {
  it("gives the energy and the free booking at once", async () => {
    await campaign({ freeBooking: true });
    const payment = await charge(driverOne);

    const granted = await awardAfterCharge(payment.id);

    expect(granted).toHaveLength(2);
    const grants = await prisma.promoGrant.findMany({
      where: { id: { in: granted } },
      orderBy: { kind: "asc" },
    });
    expect(grants.map((g) => g.kind)).toEqual(["ENERGY", "FREE_BOOKING"]);
    expect(num(grants[0].amountKwh)).toBe(5);
    // The free booking is a right, not an amount.
    expect(num(grants[1].amountKwh)).toBe(0);
    // Different keys, so "один раз на клиента" does not hide one behind the other.
    expect(grants.map((g) => g.onceKey)).toEqual(["once", "once-booking"]);
  });

  it("gives only the booking when the campaign promises no kWh", async () => {
    await campaign({ giftKwh: new Prisma.Decimal(0), freeBooking: true });
    const payment = await charge(driverOne);

    const granted = await awardAfterCharge(payment.id);

    expect(granted).toHaveLength(1);
    const grant = await prisma.promoGrant.findUniqueOrThrow({ where: { id: granted[0] } });
    expect(grant.kind).toBe("FREE_BOOKING");
  });
});

describe("§42's count ceiling", () => {
  it("stops the campaign when the last gift is given out", async () => {
    const c = await campaign({ giftKwh: new Prisma.Decimal(0), freeBooking: true, budgetGrants: 1 });

    const first = await awardAfterCharge((await charge(driverOne)).id);
    const second = await awardAfterCharge((await charge(driverTwo)).id);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    const after = await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.status).toBe("EXHAUSTED");
    expect(after.issuedGrants).toBe(1);
  });

  it("gives one gift, not two, when both drivers finish at the same moment", async () => {
    const c = await campaign({ giftKwh: new Prisma.Decimal(0), freeBooking: true, budgetGrants: 1 });
    const one = await charge(driverOne);
    const two = await charge(driverTwo);

    const [a, b] = await Promise.all([awardAfterCharge(one.id), awardAfterCharge(two.id)]);

    expect([...a, ...b]).toHaveLength(1);
    const after = await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.issuedGrants).toBe(1);
  });

  it("gives the slot back when a free booking burns unused", async () => {
    const c = await campaign({ giftKwh: new Prisma.Decimal(0), freeBooking: true, budgetGrants: 1 });
    const granted = await awardAfterCharge((await charge(driverOne)).id);
    await prisma.promoGrant.update({
      where: { id: granted[0] },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const expired = await expireGrants();

    expect(expired).toContain(granted[0]);
    const after = await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.issuedGrants).toBe(0);
    expect(after.status).toBe("ACTIVE");
  });
});

describe("§42 'скидка в %' at issue time", () => {
  it("reserves the ceiling and remembers the share", async () => {
    const c = await campaign({ giftKwh: new Prisma.Decimal(30), discountPct: new Prisma.Decimal(20) });

    const granted = await awardAfterCharge((await charge(driverOne)).id);

    const grant = await prisma.promoGrant.findUniqueOrThrow({ where: { id: granted[0] } });
    expect(num(grant.discountPct!)).toBe(20);
    expect(num(grant.amountKwh)).toBe(30);
    const after = await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } });
    expect(num(after.issuedKwh)).toBe(30);
  });

  it("leaves a gift someone holds alone when the campaign is edited", async () => {
    const c = await campaign({ giftKwh: new Prisma.Decimal(30), discountPct: new Prisma.Decimal(20) });
    const granted = await awardAfterCharge((await charge(driverOne)).id);

    await prisma.campaign.update({
      where: { id: c.id },
      data: { discountPct: new Prisma.Decimal(5) },
    });

    const grant = await prisma.promoGrant.findUniqueOrThrow({ where: { id: granted[0] } });
    expect(num(grant.discountPct!)).toBe(20);
  });
});

describe("the two triggers a charge does not earn", () => {
  it("gives nothing for a promo-code campaign", async () => {
    await campaign({ trigger: "PROMO_CODE", promoCode: "TESTGIFT" });
    expect(await awardAfterCharge((await charge(driverOne)).id)).toHaveLength(0);
  });

  it("gives nothing for a birthday campaign", async () => {
    await campaign({ trigger: "BIRTHDAY" });
    expect(await awardAfterCharge((await charge(driverOne)).id)).toHaveLength(0);
  });
});
