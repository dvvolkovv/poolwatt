// Integration test for roaming with a real debit — ТЗ §8 "Роуминг", §16.6,
// §24.2, §46, US-11. Against the real database, like the other flow tests.
//
// The arithmetic is covered in roaming.test.ts and charge.test.ts; here the
// questions are the ones only the database can answer: which corridor serves
// a session, how much of the day's allowance is left, what the session burns
// at home, and what it leaves behind for the clearing partner.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { quoteRoaming, resolveRoamingLeg, upsertRoamingAgreement } from "./roaming-service";
import { getOrCreateWallet } from "./wallet-service";

const PREFIX = "test_roam_";
const HOME = "TESTROAMHOME";
const VISIT = "TESTROAMVISIT";
const OTHER = "TESTROAMOTHER";

let homeZoneId: string;
let visitZoneId: string;
let otherZoneId: string;
let driverId: string;
let operatorId: string;

async function seedUser(username: string) {
  const user = await prisma.user.upsert({
    where: { username },
    update: {},
    create: { username, passwordHash: "x" },
  });
  return user.id;
}

async function cleanup() {
  await prisma.roamingSettlement.deleteMany({
    where: { user: { username: { startsWith: PREFIX } } },
  });
  for (const code of [HOME, VISIT, OTHER]) {
    const zone = await prisma.gridZone.findUnique({ where: { code } });
    if (!zone) continue;
    await prisma.roamingAgreement.deleteMany({
      where: { OR: [{ homeZoneId: zone.id }, { visitedZoneId: zone.id }] },
    });
    await prisma.wallet.deleteMany({ where: { zoneId: zone.id } });
    await prisma.gridZone.delete({ where: { id: zone.id } });
  }
}

/** Put a known amount of kWh on the driver's home wallet. */
async function setHomeBalance(kwh: number) {
  const wallet = await getOrCreateWallet(driverId, homeZoneId);
  await prisma.wallet.update({
    where: { id: wallet.id },
    data: { kwhBalance: new Prisma.Decimal(kwh) },
  });
  return wallet.id;
}

beforeAll(async () => {
  await cleanup();
  driverId = await seedUser(`${PREFIX}driver`);
  operatorId = await seedUser(`${PREFIX}operator`);

  const zone = async (code: string, country: string, spot: number) =>
    (
      await prisma.gridZone.create({
        data: {
          code,
          country,
          name: code,
          spotPrice: new Prisma.Decimal(spot),
          spotPriceAt: new Date(),
        },
      })
    ).id;

  homeZoneId = await zone(HOME, "SK", 0.1);
  visitZoneId = await zone(VISIT, "LT", 0.2);
  otherZoneId = await zone(OTHER, "UA", 0.05);
});

afterAll(cleanup);

beforeEach(async () => {
  await prisma.roamingSettlement.deleteMany({ where: { userId: driverId } });
  await prisma.roamingAgreement.deleteMany({
    where: { OR: [{ homeZoneId: { in: [homeZoneId, otherZoneId] } }, { visitedZoneId: visitZoneId }] },
  });
  await setHomeBalance(0);
  const other = await getOrCreateWallet(driverId, otherZoneId);
  await prisma.wallet.update({ where: { id: other.id }, data: { kwhBalance: new Prisma.Decimal(0) } });
});

async function corridor(from: string, feePct: number, dailyLimitKwh: number | null = null) {
  return upsertRoamingAgreement({
    homeZone: from,
    visitedZone: VISIT,
    partnerName: "Test Clearing",
    feePct,
    dailyLimitKwh,
    actorUserId: operatorId,
  });
}

describe("resolveRoamingLeg — which corridor serves a session (§8, US-11)", () => {
  it("is null when the driver has no kWh anywhere else", async () => {
    await corridor(HOME, 5);
    expect(await resolveRoamingLeg({ userId: driverId, visitedZoneId: visitZoneId })).toBeNull();
  });

  it("is null without an enabled agreement, however full the home wallet", async () => {
    await setHomeBalance(100);
    expect(await resolveRoamingLeg({ userId: driverId, visitedZoneId: visitZoneId })).toBeNull();

    await corridor(HOME, 5);
    await prisma.roamingAgreement.updateMany({
      where: { homeZoneId, visitedZoneId: visitZoneId },
      data: { enabled: false },
    });
    expect(await resolveRoamingLeg({ userId: driverId, visitedZoneId: visitZoneId })).toBeNull();
  });

  it("prices the corridor and says how much of the session it can serve", async () => {
    await setHomeBalance(21);
    await corridor(HOME, 5);

    const leg = await resolveRoamingLeg({ userId: driverId, visitedZoneId: visitZoneId });
    expect(leg).not.toBeNull();
    expect(leg!.homeZoneCode).toBe(HOME);
    expect(leg!.partnerName).toBe("Test Clearing");
    expect(leg!.conversionRate).toBe(2);
    expect(leg!.feePct).toBe(5);
    expect(leg!.homeBalanceKwh).toBe(21);
    // 21 home kWh at rate 2 plus 5 % buys 10 kWh abroad.
    expect(leg!.maxKwh).toBe(10);
    expect(leg!.allowanceKwh).toBeNull();
  });

  it("prefers the corridor that serves the larger part of the session", async () => {
    await setHomeBalance(10); // 10 / (2 × 1.05) ≈ 4.761 kWh abroad
    const other = await getOrCreateWallet(driverId, otherZoneId);
    await prisma.wallet.update({
      where: { id: other.id },
      data: { kwhBalance: new Prisma.Decimal(10) }, // rate 4 — 2.380 kWh abroad
    });
    await corridor(HOME, 5);
    await corridor(OTHER, 5);

    const leg = await resolveRoamingLeg({ userId: driverId, visitedZoneId: visitZoneId });
    expect(leg!.homeZoneCode).toBe(HOME);
  });

  it("counts the day's sessions against the §24.2 limit, not the single one", async () => {
    await setHomeBalance(1000);
    const agreement = await corridor(HOME, 0, 50);

    const before = await resolveRoamingLeg({ userId: driverId, visitedZoneId: visitZoneId });
    expect(before!.allowanceKwh).toBe(50);
    expect(before!.maxKwh).toBe(50);

    await prisma.roamingSettlement.create({
      data: {
        agreementId: agreement.id,
        userId: driverId,
        deliveredKwh: new Prisma.Decimal(30),
        debitedKwh: new Prisma.Decimal(60),
        conversionRate: new Prisma.Decimal(2),
      },
    });

    const after = await resolveRoamingLeg({ userId: driverId, visitedZoneId: visitZoneId });
    expect(after!.allowanceKwh).toBe(20);
    expect(after!.maxKwh).toBe(20);
  });

  it("forgets yesterday's sessions", async () => {
    await setHomeBalance(1000);
    const agreement = await corridor(HOME, 0, 50);
    await prisma.roamingSettlement.create({
      data: {
        agreementId: agreement.id,
        userId: driverId,
        deliveredKwh: new Prisma.Decimal(40),
        debitedKwh: new Prisma.Decimal(80),
        conversionRate: new Prisma.Decimal(2),
        createdAt: new Date(Date.now() - 36 * 3600_000),
      },
    });

    const leg = await resolveRoamingLeg({ userId: driverId, visitedZoneId: visitZoneId });
    expect(leg!.allowanceKwh).toBe(50);
  });

  it("is null once the day's allowance is spent", async () => {
    await setHomeBalance(1000);
    const agreement = await corridor(HOME, 0, 10);
    await prisma.roamingSettlement.create({
      data: {
        agreementId: agreement.id,
        userId: driverId,
        deliveredKwh: new Prisma.Decimal(10),
        debitedKwh: new Prisma.Decimal(20),
        conversionRate: new Prisma.Decimal(2),
      },
    });
    expect(await resolveRoamingLeg({ userId: driverId, visitedZoneId: visitZoneId })).toBeNull();
  });
});

describe("quoteRoaming — the limit the user is told about is the day's (§24.2)", () => {
  it("refuses an amount over what is left today and names the remainder", async () => {
    await setHomeBalance(1000);
    const agreement = await corridor(HOME, 0, 50);
    await prisma.roamingSettlement.create({
      data: {
        agreementId: agreement.id,
        userId: driverId,
        deliveredKwh: new Prisma.Decimal(45),
        debitedKwh: new Prisma.Decimal(90),
        conversionRate: new Prisma.Decimal(2),
      },
    });

    await expect(
      quoteRoaming({ userId: driverId, visitedZone: VISIT, amountKwh: 10 }),
    ).rejects.toThrow(/5/);
  });

  it("still quotes what fits in the remainder", async () => {
    await setHomeBalance(1000);
    const agreement = await corridor(HOME, 0, 50);
    await prisma.roamingSettlement.create({
      data: {
        agreementId: agreement.id,
        userId: driverId,
        deliveredKwh: new Prisma.Decimal(45),
        debitedKwh: new Prisma.Decimal(90),
        conversionRate: new Prisma.Decimal(2),
      },
    });

    const view = await quoteRoaming({ userId: driverId, visitedZone: VISIT, amountKwh: 5 });
    expect(view.quote.totalKwh).toBe(10);
    expect(view.allowanceKwh).toBe(5);
  });
});
