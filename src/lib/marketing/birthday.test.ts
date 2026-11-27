// §42's birthday gift: who gets one, and how often.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { birthdaysOn, issueBirthdayGifts } from "./birthday";

const PREFIX = "test_bday_";
const ZONE_CODE = "TESTBDAY";

let zoneId: string;
let operatorId: string;
let otherOperatorId: string;
let clientId: string;
let strangerId: string;
let pointA: string;
let foreignPoint: string;

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

async function charge(userId: string, pointId: string) {
  const wallet = await prisma.wallet.upsert({
    where: { ownerUserId_zoneId: { ownerUserId: userId, zoneId } },
    update: {},
    create: { ownerUserId: userId, zoneId },
  });
  return prisma.payment.create({
    data: {
      walletId: wallet.id,
      zoneId,
      pointId,
      requestedKwh: new Prisma.Decimal(10),
      kwhFromBalance: new Prisma.Decimal(10),
      status: "CAPTURED",
      capturedAt: new Date(),
      endedAt: new Date(),
    },
  });
}

async function campaign(over: Partial<Prisma.CampaignUncheckedCreateInput> = {}) {
  return prisma.campaign.create({
    data: {
      operatorId,
      zoneId,
      name: "Happy birthday",
      trigger: "BIRTHDAY",
      giftKwh: new Prisma.Decimal(10),
      validityDays: 30,
      budgetKwh: new Prisma.Decimal(1000),
      status: "ACTIVE",
      ...over,
    },
  });
}

beforeAll(async () => {
  await wipe();
  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE_CODE, country: "SK", name: "Birthday zone", currency: "EUR" },
    })
  ).id;
  const user = async (name: string, birth: { d: number; m: number } | null) =>
    (
      await prisma.user.upsert({
        where: { username: `${PREFIX}${name}` },
        update: { birthDay: birth?.d ?? null, birthMonth: birth?.m ?? null },
        create: {
          username: `${PREFIX}${name}`,
          passwordHash: "x",
          birthDay: birth?.d ?? null,
          birthMonth: birth?.m ?? null,
        },
      })
    ).id;
  clientId = await user("client", { d: 14, m: 3 });
  strangerId = await user("stranger", { d: 14, m: 3 });
  operatorId = (
    await prisma.chargerOperator.create({
      data: { slug: `${PREFIX}net`, displayName: "Birthday network", claimedAt: new Date() },
    })
  ).id;
  otherOperatorId = (
    await prisma.chargerOperator.create({
      data: { slug: `${PREFIX}other`, displayName: "Another network" },
    })
  ).id;
  pointA = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "A", gridZoneId: zoneId },
    })
  ).id;
  foreignPoint = (
    await prisma.acceptancePoint.create({
      data: { operatorId: otherOperatorId, type: "CHARGING_STATION", name: "T", gridZoneId: zoneId },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.promoGrant.deleteMany({ where: { operatorId: { in: [operatorId, otherOperatorId] } } });
  await prisma.campaign.deleteMany({ where: { operatorId: { in: [operatorId, otherOperatorId] } } });
  await prisma.payment.deleteMany({ where: { zoneId } });
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

const MARCH_14 = new Date("2026-03-14T03:00:00Z");

describe("birthdaysOn", () => {
  it("celebrates the date itself", () => {
    expect(birthdaysOn(MARCH_14)).toEqual([{ day: 14, month: 3 }]);
  });

  it("celebrates the 29th of February on the 28th in a year without one", () => {
    expect(birthdaysOn(new Date("2026-02-28T03:00:00Z"))).toEqual([
      { day: 28, month: 2 },
      { day: 29, month: 2 },
    ]);
  });

  it("leaves the 28th alone in a leap year", () => {
    expect(birthdaysOn(new Date("2028-02-28T03:00:00Z"))).toEqual([{ day: 28, month: 2 }]);
  });
});

describe("issueBirthdayGifts", () => {
  it("gives the gift to a client of the network", async () => {
    await campaign();
    await charge(clientId, pointA);

    const granted = await issueBirthdayGifts(MARCH_14);

    expect(granted).toHaveLength(1);
    const grant = await prisma.promoGrant.findUniqueOrThrow({ where: { id: granted[0] } });
    expect(grant.userId).toBe(clientId);
    expect(grant.onceKey).toBe("birthday-2026");
  });

  it("gives nothing to somebody who never charged in this network", async () => {
    await campaign();
    await charge(strangerId, foreignPoint);

    expect(await issueBirthdayGifts(MARCH_14)).toHaveLength(0);
  });

  it("gives nothing twice on the same day", async () => {
    await campaign();
    await charge(clientId, pointA);

    await issueBirthdayGifts(MARCH_14);
    const second = await issueBirthdayGifts(MARCH_14);

    expect(second).toHaveLength(0);
    expect(await prisma.promoGrant.count({ where: { operatorId } })).toBe(1);
  });

  it("gives one again next year", async () => {
    await campaign();
    await charge(clientId, pointA);

    await issueBirthdayGifts(MARCH_14);
    const nextYear = await issueBirthdayGifts(new Date("2027-03-14T03:00:00Z"));

    expect(nextYear).toHaveLength(1);
  });

  it("gives nothing on a day that is nobody's birthday", async () => {
    await campaign();
    await charge(clientId, pointA);

    expect(await issueBirthdayGifts(new Date("2026-03-15T03:00:00Z"))).toHaveLength(0);
  });

  it("counts a charge only inside the campaign's own points", async () => {
    const other = await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "B", gridZoneId: zoneId },
    });
    await campaign({ scopePointIds: [other.id] });
    await charge(clientId, pointA);

    expect(await issueBirthdayGifts(MARCH_14)).toHaveLength(0);
  });

  it("gives the energy and the booking of a combination", async () => {
    await campaign({ freeBooking: true });
    await charge(clientId, pointA);

    const granted = await issueBirthdayGifts(MARCH_14);

    expect(granted).toHaveLength(2);
    const grants = await prisma.promoGrant.findMany({ where: { id: { in: granted } } });
    expect(grants.map((g) => g.onceKey).sort()).toEqual([
      "birthday-2026",
      "birthday-2026-booking",
    ]);
  });
});
