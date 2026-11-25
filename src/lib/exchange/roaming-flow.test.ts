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
import {
  quoteRoaming,
  resolveRoamingLeg,
  upsertRoamingAgreement,
} from "./roaming-service";
import { chargeSession, quoteCharge } from "./payment-service";
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
let assetId: string;

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
  await prisma.receipt.deleteMany({
    where: { payment: { wallet: { owner: { username: { startsWith: PREFIX } } } } },
  });
  await prisma.payment.deleteMany({
    where: { wallet: { owner: { username: { startsWith: PREFIX } } } },
  });
  await prisma.energyToken.deleteMany({ where: { asset: { company: { regNumber: `${PREFIX}reg` } } } });
  await prisma.asset.deleteMany({ where: { company: { regNumber: `${PREFIX}reg` } } });
  await prisma.company.deleteMany({ where: { regNumber: `${PREFIX}reg` } });
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

/**
 * Put a known amount of kWh on the driver's home wallet — as real batches,
 * because a roaming session burns them and a balance without batches would
 * pass a test the production path cannot pass.
 */
async function setHomeBalance(kwh: number, zoneId = homeZoneId) {
  const wallet = await getOrCreateWallet(driverId, zoneId);
  await prisma.energyToken.deleteMany({ where: { ownerWalletId: wallet.id } });
  if (kwh > 0) {
    await prisma.energyToken.create({
      data: {
        zoneId,
        assetId,
        ownerWalletId: wallet.id,
        amountKwh: new Prisma.Decimal(kwh),
        intervalStart: new Date(),
        status: "AVAILABLE",
      },
    });
  }
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

  const company = await prisma.company.create({
    data: {
      legalName: `${PREFIX}company`,
      regNumber: `${PREFIX}reg`,
      country: "SK",
      type: "PRODUCER",
      ownerUserId: driverId,
    },
  });
  assetId = (
    await prisma.asset.create({
      data: {
        companyId: company.id,
        gridZoneId: homeZoneId,
        name: `${PREFIX}asset`,
        kind: "SOLAR",
        capacityKw: new Prisma.Decimal(10),
      },
    })
  ).id;
});

afterAll(cleanup);

beforeEach(async () => {
  await prisma.receipt.deleteMany({ where: { payment: { wallet: { ownerUserId: driverId } } } });
  await prisma.payment.deleteMany({ where: { wallet: { ownerUserId: driverId } } });
  await prisma.roamingSettlement.deleteMany({ where: { userId: driverId } });
  await prisma.roamingAgreement.deleteMany({
    where: { OR: [{ homeZoneId: { in: [homeZoneId, otherZoneId] } }, { visitedZoneId: visitZoneId }] },
  });
  await setHomeBalance(0);
  await setHomeBalance(0, otherZoneId);
  await setHomeBalance(0, visitZoneId);
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
    await setHomeBalance(10, otherZoneId); // rate 4 — 2.380 kWh abroad
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

describe("chargeSession abroad — the debit of US-11", () => {
  /** Money for the part of a session the corridor is not allowed to serve. */
  async function setVisitedFiat(amount: number) {
    const wallet = await getOrCreateWallet(driverId, visitZoneId);
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { fiatBalance: new Prisma.Decimal(amount) },
    });
  }

  async function homeBalance() {
    const wallet = await getOrCreateWallet(driverId, homeZoneId);
    return Number(wallet.kwhBalance);
  }

  it("shows the conversion in the quote the driver confirms", async () => {
    await setHomeBalance(21);
    await corridor(HOME, 5);

    const plan = await quoteCharge({ userId: driverId, zoneId: visitZoneId, requestedKwh: 10 });
    expect(plan.kwhFromRoaming).toBe(10);
    expect(plan.roamingDebitKwh).toBe(21);
    expect(plan.roamingFeeKwh).toBe(1);
    expect(plan.roaming?.homeZoneCode).toBe(HOME);
    expect(plan.roaming?.conversionRate).toBe(2);
    // The clearing partner delivered the energy — no money is due.
    expect(plan.total).toBe(0);
  });

  it("burns the home-zone batches and leaves a claim on the partner", async () => {
    await setHomeBalance(21);
    const agreement = await corridor(HOME, 5);

    const result = await chargeSession({
      userId: driverId,
      zoneId: visitZoneId,
      requestedKwh: 10,
      idempotencyKey: "roam-key-1",
    });

    expect(result.status).toBe("CAPTURED");
    expect(result.deliveredKwh).toBe(10);
    expect(result.kwhFromRoaming).toBe(10);
    expect(result.kwhFromBalance).toBe(0);
    expect(result.amountFiat).toBe(0);
    expect(await homeBalance()).toBe(0);

    const settlement = await prisma.roamingSettlement.findUniqueOrThrow({
      where: { paymentId: result.paymentId },
    });
    expect(settlement.agreementId).toBe(agreement.id);
    expect(settlement.userId).toBe(driverId);
    expect(Number(settlement.deliveredKwh)).toBe(10);
    expect(Number(settlement.debitedKwh)).toBe(21);
    expect(Number(settlement.feeKwh)).toBe(1);
    expect(Number(settlement.conversionRate)).toBe(2);
    expect(settlement.status).toBe("OPEN");
    expect(settlement.burnedTokenIds.length).toBeGreaterThan(0);

    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: result.receiptId! } });
    const breakdown = receipt.breakdown as Record<string, unknown>;
    expect(breakdown.kwhFromRoaming).toBe(10);
    expect(breakdown.roamingHomeZone).toBe(HOME);
    expect(breakdown.roamingRate).toBe(2);
    expect(breakdown.roamingDebitKwh).toBe(21);
    expect(breakdown.roamingPartner).toBe("Test Clearing");
    expect(Number(receipt.totalKwh)).toBe(10);
    expect(Number(receipt.totalFiat)).toBe(0);
  });

  it("replays the same key without a second claim (§15)", async () => {
    await setHomeBalance(42);
    await corridor(HOME, 5);

    const first = await chargeSession({
      userId: driverId,
      zoneId: visitZoneId,
      requestedKwh: 10,
      idempotencyKey: "roam-key-2",
    });
    const second = await chargeSession({
      userId: driverId,
      zoneId: visitZoneId,
      requestedKwh: 10,
      idempotencyKey: "roam-key-2",
    });

    expect(second.paymentId).toBe(first.paymentId);
    expect(second.idempotentReplay).toBe(true);
    expect(second.kwhFromRoaming).toBe(10);
    expect(await prisma.roamingSettlement.count({ where: { userId: driverId } })).toBe(1);
    expect(await homeBalance()).toBe(21);
  });

  it("two simultaneous retries of one intent debit once", async () => {
    await setHomeBalance(42);
    await corridor(HOME, 5);

    const results = await Promise.allSettled([
      chargeSession({
        userId: driverId,
        zoneId: visitZoneId,
        requestedKwh: 10,
        idempotencyKey: "roam-key-3",
      }),
      chargeSession({
        userId: driverId,
        zoneId: visitZoneId,
        requestedKwh: 10,
        idempotencyKey: "roam-key-3",
      }),
    ]);
    const captured = results.filter(
      (r) => r.status === "fulfilled" && r.value.status === "CAPTURED",
    );
    expect(captured.length).toBeGreaterThan(0);
    expect(await prisma.roamingSettlement.count({ where: { userId: driverId } })).toBe(1);
    expect(await homeBalance()).toBe(21);
  });

  it("serves only what the §24.2 allowance leaves and buys the rest", async () => {
    await setHomeBalance(1000);
    await setVisitedFiat(100);
    await corridor(HOME, 0, 4);

    const plan = await quoteCharge({ userId: driverId, zoneId: visitZoneId, requestedKwh: 10 });
    expect(plan.kwhFromRoaming).toBe(4);
    // The allowance stops the corridor at 4 kWh; the other 6 are paid for.
    expect(plan.energyCost).toBeGreaterThan(0);

    const result = await chargeSession({
      userId: driverId,
      zoneId: visitZoneId,
      requestedKwh: 10,
      idempotencyKey: "roam-key-4",
    });
    expect(result.kwhFromRoaming).toBe(4);
    expect(await homeBalance()).toBe(992);
    const settlement = await prisma.roamingSettlement.findUniqueOrThrow({
      where: { paymentId: result.paymentId },
    });
    expect(Number(settlement.deliveredKwh)).toBe(4);
  });

  it("two sessions in a row cannot together exceed the day's allowance", async () => {
    await setHomeBalance(1000);
    await setVisitedFiat(100);
    await corridor(HOME, 0, 6);

    const first = await chargeSession({
      userId: driverId,
      zoneId: visitZoneId,
      requestedKwh: 5,
      idempotencyKey: "roam-key-5a",
    });
    const second = await chargeSession({
      userId: driverId,
      zoneId: visitZoneId,
      requestedKwh: 5,
      idempotencyKey: "roam-key-5b",
    });

    expect(first.kwhFromRoaming).toBe(5);
    expect(second.kwhFromRoaming).toBe(1);
    const delivered = await prisma.roamingSettlement.aggregate({
      where: { userId: driverId },
      _sum: { deliveredKwh: true },
    });
    expect(Number(delivered._sum.deliveredKwh)).toBe(6);
  });

  it("does not touch the home balance for a session in the home zone itself", async () => {
    await setHomeBalance(21);
    await corridor(HOME, 5);

    const plan = await quoteCharge({ userId: driverId, zoneId: homeZoneId, requestedKwh: 10 });
    expect(plan.kwhFromRoaming).toBe(0);
    expect(plan.kwhFromBalance).toBe(10);
    expect(plan.roaming).toBeNull();
  });
});
