// US-41 — "подарить новичку N кВт·ч после первой зарядки в моей сети".
// §42's triggers, limits and budget, and §43's expiry giving the budget back.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { awardAfterCharge, expireGrants, sweepPendingAwards } from "./campaign-engine";

const PREFIX = "test_camp_";
const ZONE_CODE = "TESTCAMP";

let zoneId: string;
let operatorId: string;
let otherOperatorId: string;
let partnerUserId: string;
let driverUserId: string;
let pointA: string;
let pointB: string;
let foreignPoint: string;

async function wipe() {
  await prisma.promoGrant.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.campaign.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.receipt.deleteMany({ where: { payment: { zone: { code: ZONE_CODE } } } });
  await prisma.payment.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE_CODE } });
}

/** A captured charge at one of our points, which is what a trigger reads. */
async function charge(args: {
  pointId: string | null;
  kwh?: number;
  at?: Date;
  userId?: string;
}) {
  const userId = args.userId ?? driverUserId;
  const wallet = await prisma.wallet.upsert({
    where: { ownerUserId_zoneId: { ownerUserId: userId, zoneId } },
    update: {},
    create: { ownerUserId: userId, zoneId },
  });
  const at = args.at ?? new Date();
  return prisma.payment.create({
    data: {
      walletId: wallet.id,
      zoneId,
      pointId: args.pointId,
      requestedKwh: new Prisma.Decimal(args.kwh ?? 10),
      kwhFromBalance: new Prisma.Decimal(args.kwh ?? 10),
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
      name: "Welcome",
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
      data: { code: ZONE_CODE, country: "SK", name: "Campaign test zone", currency: "EUR" },
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
  driverUserId = await user("driver");

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: `${PREFIX}net`,
        displayName: "Campaign test network",
        claimedById: partnerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  otherOperatorId = (
    await prisma.chargerOperator.create({
      data: { slug: `${PREFIX}other`, displayName: "Somebody else" },
    })
  ).id;

  const point = async (operator: string, name: string) =>
    (
      await prisma.acceptancePoint.create({
        data: { operatorId: operator, type: "CHARGING_STATION", name, gridZoneId: zoneId },
      })
    ).id;
  pointA = await point(operatorId, "A");
  pointB = await point(operatorId, "B");
  foreignPoint = await point(otherOperatorId, "Theirs");
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

describe("awardAfterCharge — US-41's first charge in the network", () => {
  it("gives the newcomer the gift and dates it by validityDays", async () => {
    const c = await campaign();
    const payment = await charge({ pointId: pointA });

    const granted = await awardAfterCharge(payment.id);

    expect(granted).toHaveLength(1);
    const grant = await prisma.promoGrant.findFirstOrThrow({ where: { campaignId: c.id } });
    expect(Number(grant.amountKwh)).toBe(5);
    expect(grant.userId).toBe(driverUserId);
    expect(grant.operatorId).toBe(operatorId);
    expect(grant.status).toBe("ACTIVE");
    const days = (grant.expiresAt.getTime() - grant.issuedAt.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
  });

  it("marks the payment looked at, so the sweep does not look again", async () => {
    await campaign();
    const payment = await charge({ pointId: pointA });
    await awardAfterCharge(payment.id);

    const after = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.campaignsEvaluatedAt).not.toBeNull();
  });

  it("counts the budget down and stops the campaign when it runs out", async () => {
    const c = await campaign({ budgetKwh: new Prisma.Decimal(5), oncePerClient: false });
    const first = await charge({ pointId: pointA });
    await awardAfterCharge(first.id);

    const mid = await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } });
    expect(Number(mid.issuedKwh)).toBe(5);
    expect(mid.status).toBe("EXHAUSTED");

    // §42 "кампания останавливается при исчерпании" — the next driver gets
    // nothing, and nothing is promised that cannot be paid for.
    const second = await charge({ pointId: pointA, userId: partnerUserId });
    expect(await awardAfterCharge(second.id)).toHaveLength(0);
    expect(await prisma.promoGrant.count({ where: { campaignId: c.id } })).toBe(1);
  });

  it("gives nothing for a second charge when the trigger is the first one", async () => {
    await campaign();
    const first = await charge({ pointId: pointA });
    await awardAfterCharge(first.id);

    const second = await charge({ pointId: pointB });
    expect(await awardAfterCharge(second.id)).toHaveLength(0);
    expect(await prisma.promoGrant.count({ where: { operatorId } })).toBe(1);
  });

  it("gives nothing twice to one client, even on two campaigns' worth of charges", async () => {
    const c = await campaign({ trigger: "NTH_CHARGE", triggerN: 1 });
    const first = await charge({ pointId: pointA });
    await awardAfterCharge(first.id);
    const second = await charge({ pointId: pointA });
    await awardAfterCharge(second.id);

    expect(await prisma.promoGrant.count({ where: { campaignId: c.id } })).toBe(1);
  });

  it("holds 'once per client' when two charges are evaluated at the same moment", async () => {
    await campaign({ trigger: "NTH_CHARGE", triggerN: 1 });
    const a = await charge({ pointId: pointA });
    const b = await charge({ pointId: pointB });

    const [ra, rb] = await Promise.all([awardAfterCharge(a.id), awardAfterCharge(b.id)]);

    expect(ra.length + rb.length).toBe(1);
    expect(await prisma.promoGrant.count({ where: { operatorId } })).toBe(1);
  });

  it("gives the N-th charge gift only on the N-th", async () => {
    await campaign({ trigger: "NTH_CHARGE", triggerN: 3 });
    const one = await charge({ pointId: pointA });
    expect(await awardAfterCharge(one.id)).toHaveLength(0);
    const two = await charge({ pointId: pointA });
    expect(await awardAfterCharge(two.id)).toHaveLength(0);
    const three = await charge({ pointId: pointA });
    expect(await awardAfterCharge(three.id)).toHaveLength(1);
  });

  it("gives the volume gift once the period's kWh add up", async () => {
    await campaign({ trigger: "VOLUME_PERIOD", triggerN: 50, triggerPeriodDays: 30 });
    const old = await charge({
      pointId: pointA,
      kwh: 40,
      at: new Date(Date.now() - 60 * 86_400_000),
    });
    await awardAfterCharge(old.id);
    expect(await prisma.promoGrant.count({ where: { operatorId } })).toBe(0);

    const recent = await charge({ pointId: pointA, kwh: 30 });
    await awardAfterCharge(recent.id);
    expect(await prisma.promoGrant.count({ where: { operatorId } })).toBe(0);

    const more = await charge({ pointId: pointA, kwh: 25 });
    expect(await awardAfterCharge(more.id)).toHaveLength(1);
  });

  it("gives nothing for a charge with no point — a gift needs a network", async () => {
    await campaign();
    const payment = await charge({ pointId: null });
    expect(await awardAfterCharge(payment.id)).toHaveLength(0);
  });

  it("gives nothing for a charge in somebody else's network (US-43 at issue time)", async () => {
    await campaign();
    const payment = await charge({ pointId: foreignPoint });
    expect(await awardAfterCharge(payment.id)).toHaveLength(0);
  });

  it("gives nothing at a point outside the campaign's own scope", async () => {
    await campaign({ scopePointIds: [pointB] });
    const atA = await charge({ pointId: pointA });
    expect(await awardAfterCharge(atA.id)).toHaveLength(0);

    const atB = await charge({ pointId: pointB });
    expect(await awardAfterCharge(atB.id)).toHaveLength(1);
  });

  it("ignores a campaign that is a draft, paused or out of its dates", async () => {
    await campaign({ status: "DRAFT" });
    await campaign({ name: "Paused", status: "PAUSED" });
    await campaign({
      name: "Future",
      startsAt: new Date(Date.now() + 86_400_000),
    });
    await campaign({
      name: "Past",
      endsAt: new Date(Date.now() - 86_400_000),
    });

    const payment = await charge({ pointId: pointA });
    expect(await awardAfterCharge(payment.id)).toHaveLength(0);
  });

  it("ignores a failed session: it is not a charge", async () => {
    await campaign();
    const wallet = await prisma.wallet.upsert({
      where: { ownerUserId_zoneId: { ownerUserId: driverUserId, zoneId } },
      update: {},
      create: { ownerUserId: driverUserId, zoneId },
    });
    const failed = await prisma.payment.create({
      data: {
        walletId: wallet.id,
        zoneId,
        pointId: pointA,
        requestedKwh: new Prisma.Decimal(10),
        status: "FAILED",
      },
    });
    expect(await awardAfterCharge(failed.id)).toHaveLength(0);
  });

  it("does not grant twice for the same payment", async () => {
    await campaign({ oncePerClient: false });
    const payment = await charge({ pointId: pointA });
    await awardAfterCharge(payment.id);
    expect(await awardAfterCharge(payment.id)).toHaveLength(0);
    expect(await prisma.promoGrant.count({ where: { operatorId } })).toBe(1);
  });

  it("writes what it did to the audit log", async () => {
    await campaign();
    const payment = await charge({ pointId: pointA });
    await awardAfterCharge(payment.id);

    const log = await prisma.auditLog.findFirst({
      where: { entity: "PromoGrant", action: "promo.granted" },
      orderBy: { at: "desc" },
    });
    expect(log).not.toBeNull();
  });
});

describe("sweepPendingAwards — US-41's 'within a minute'", () => {
  it("picks up a captured charge nobody looked at, and leaves the rest alone", async () => {
    await campaign();
    const pending = await charge({ pointId: pointA });
    const done = await charge({ pointId: pointB, userId: partnerUserId });
    await prisma.payment.update({
      where: { id: done.id },
      data: { campaignsEvaluatedAt: new Date() },
    });

    const touched = await sweepPendingAwards();

    expect(touched).toContain(pending.id);
    expect(touched).not.toContain(done.id);
    expect(await prisma.promoGrant.count({ where: { operatorId } })).toBe(1);
  });
});

describe("expireGrants — §43 'сгоревший объём возвращается в бюджет'", () => {
  async function expiredGrant(amount: number, used: number, campaignId: string) {
    return prisma.promoGrant.create({
      data: {
        campaignId,
        userId: driverUserId,
        operatorId,
        amountKwh: new Prisma.Decimal(amount),
        usedKwh: new Prisma.Decimal(used),
        expiresAt: new Date(Date.now() - 60_000),
        status: "ACTIVE",
      },
    });
  }

  it("burns the grant and gives the unused remainder back", async () => {
    const c = await campaign({ issuedKwh: new Prisma.Decimal(5) });
    const grant = await expiredGrant(5, 2, c.id);

    const expired = await expireGrants();

    expect(expired).toContain(grant.id);
    const after = await prisma.promoGrant.findUniqueOrThrow({ where: { id: grant.id } });
    expect(after.status).toBe("EXPIRED");
    const campaignAfter = await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } });
    expect(Number(campaignAfter.issuedKwh)).toBe(2);
  });

  it("gives nothing back for a grant that was spent to the last kWh", async () => {
    const c = await campaign({ issuedKwh: new Prisma.Decimal(5) });
    await expiredGrant(5, 5, c.id);

    await expireGrants();

    const after = await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } });
    expect(Number(after.issuedKwh)).toBe(5);
  });

  it("lets an exhausted campaign run again once the budget comes back", async () => {
    const c = await campaign({
      budgetKwh: new Prisma.Decimal(5),
      issuedKwh: new Prisma.Decimal(5),
      status: "EXHAUSTED",
    });
    await expiredGrant(5, 0, c.id);

    await expireGrants();

    const after = await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } });
    expect(Number(after.issuedKwh)).toBe(0);
    expect(after.status).toBe("ACTIVE");
  });

  it("leaves a grant that has not expired alone", async () => {
    const c = await campaign({ issuedKwh: new Prisma.Decimal(5) });
    await prisma.promoGrant.create({
      data: {
        campaignId: c.id,
        userId: driverUserId,
        operatorId,
        amountKwh: new Prisma.Decimal(5),
        expiresAt: new Date(Date.now() + 86_400_000),
        status: "ACTIVE",
      },
    });

    expect(await expireGrants()).toHaveLength(0);
    const after = await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } });
    expect(Number(after.issuedKwh)).toBe(5);
  });

  it("does not give the same remainder back twice", async () => {
    const c = await campaign({ issuedKwh: new Prisma.Decimal(5) });
    await expiredGrant(5, 1, c.id);

    await expireGrants();
    await expireGrants();

    const after = await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } });
    expect(Number(after.issuedKwh)).toBe(1);
  });
});
