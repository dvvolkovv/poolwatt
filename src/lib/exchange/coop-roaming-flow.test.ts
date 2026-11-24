// Integration test for the cooperative and roaming slice, against the real
// dev DB: ТЗ §7, §8 "Роуминг", §16.10, §24, US-10, US-11, US-21.
//
// The arithmetic is unit-tested in coop.test.ts and roaming.test.ts; this
// covers the wiring — membership gating on KYC, a payout period that stays
// whole to the cent, one-member-one-vote enforced by the schema, and a
// cross-zone quote built from two zone spot references.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  addMember,
  castBallot,
  closeVote,
  createCooperative,
  openVote,
  readMemberShares,
  recordPayout,
  setMemberShares,
  verifyMemberKyc,
} from "./coop-service";
import { quoteRoaming, upsertRoamingAgreement } from "./roaming-service";
import { getOrCreateWallet } from "./wallet-service";

const PREFIX = "test_coop_";
const HOME_ZONE = "TESTCOOPHOME";
const VISIT_ZONE = "TESTCOOPVISIT";

let homeZoneId: string;
let companyId: string;
let coopId: string;
let aliceUserId: string;
let bobUserId: string;
let operatorUserId: string;
let aliceMemberId: string;
let bobMemberId: string;

const PERIOD_START = new Date("2026-10-01T00:00:00.000Z");
const PERIOD_END = new Date("2026-11-01T00:00:00.000Z");

async function seedUser(username: string) {
  const user = await prisma.user.upsert({
    where: { username },
    update: {},
    create: { username, passwordHash: "x" },
  });
  return user.id;
}

async function cleanup() {
  await prisma.coopBallot.deleteMany({ where: { vote: { coop: { name: { startsWith: PREFIX } } } } });
  await prisma.coopVote.deleteMany({ where: { coop: { name: { startsWith: PREFIX } } } });
  await prisma.coopPayoutAllocation.deleteMany({
    where: { payout: { coop: { name: { startsWith: PREFIX } } } },
  });
  await prisma.coopPayout.deleteMany({ where: { coop: { name: { startsWith: PREFIX } } } });
  await prisma.coopMember.deleteMany({ where: { coop: { name: { startsWith: PREFIX } } } });
  await prisma.cooperative.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
  for (const code of [HOME_ZONE, VISIT_ZONE]) {
    const zone = await prisma.gridZone.findUnique({ where: { code } });
    if (!zone) continue;
    await prisma.roamingAgreement.deleteMany({
      where: { OR: [{ homeZoneId: zone.id }, { visitedZoneId: zone.id }] },
    });
    await prisma.wallet.deleteMany({ where: { zoneId: zone.id } });
    await prisma.gridZone.delete({ where: { id: zone.id } });
  }
}

beforeAll(async () => {
  await cleanup();

  const home = await prisma.gridZone.create({
    data: {
      code: HOME_ZONE,
      country: "SK",
      name: "Test Coop Home",
      spotPrice: new Prisma.Decimal(0.1),
      spotPriceAt: new Date(),
    },
  });
  await prisma.gridZone.create({
    data: {
      code: VISIT_ZONE,
      country: "LT",
      name: "Test Coop Visited",
      spotPrice: new Prisma.Decimal(0.2),
      spotPriceAt: new Date(),
    },
  });
  homeZoneId = home.id;

  aliceUserId = await seedUser(`${PREFIX}alice`);
  bobUserId = await seedUser(`${PREFIX}bob`);
  operatorUserId = await seedUser(`${PREFIX}operator`);
});

afterAll(cleanup);

describe("cooperative membership — ТЗ §2, §24.1", () => {
  it("creates a cooperative on top of a COOPERATIVE company", async () => {
    const company = await prisma.company.create({
      data: {
        legalName: `${PREFIX}Powerbank Coop`,
        country: "SK",
        regNumber: `${PREFIX}reg`,
        type: "COOPERATIVE",
      },
    });
    companyId = company.id;

    const coop = await createCooperative({
      companyId,
      zoneId: homeZoneId,
      name: `${PREFIX}Coop`,
      actorUserId: operatorUserId,
    });
    coopId = coop.id;
    expect(coop.name).toBe(`${PREFIX}Coop`);
  });

  it("refuses a cooperative on a company that is not a cooperative", async () => {
    const other = await prisma.company.create({
      data: {
        legalName: `${PREFIX}Sunfarm`,
        country: "SK",
        regNumber: `${PREFIX}reg2`,
        type: "PRODUCER",
      },
    });
    await expect(
      createCooperative({
        companyId: other.id,
        zoneId: homeZoneId,
        name: `${PREFIX}Nope`,
        actorUserId: operatorUserId,
      }),
    ).rejects.toThrow(/COOPERATIVE/i);
  });

  it("admits members as PENDING until KYC is verified", async () => {
    const alice = await addMember({ coopId, userId: aliceUserId, shares: 3, actorUserId: operatorUserId });
    aliceMemberId = alice.id;
    expect(alice.status).toBe("PENDING");
    expect(alice.shares).toBe(3);

    const verified = await verifyMemberKyc({ memberId: alice.id, actorUserId: operatorUserId });
    expect(verified.status).toBe("ACTIVE");
    expect(verified.kycVerifiedAt).not.toBeNull();

    const bob = await addMember({ coopId, userId: bobUserId, shares: 1, actorUserId: operatorUserId });
    bobMemberId = bob.id;
    await verifyMemberKyc({ memberId: bob.id, actorUserId: operatorUserId });
  });

  it("keeps one membership row per user", async () => {
    const again = await addMember({ coopId, userId: aliceUserId, shares: 3, actorUserId: operatorUserId });
    expect(again.id).toBe(aliceMemberId);
    const count = await prisma.coopMember.count({ where: { coopId } });
    expect(count).toBe(2);
  });

  it("records a share change in the audit trail (§16.11)", async () => {
    await setMemberShares({ memberId: bobMemberId, shares: 1, actorUserId: operatorUserId });
    const entries = await prisma.auditLog.findMany({
      where: { entity: "CoopMember", entityId: bobMemberId },
    });
    expect(entries.length).toBeGreaterThan(0);
  });
});

describe("income distribution — ТЗ §16.10, US-10", () => {
  it("splits a period's income pro rata by shares", async () => {
    const payout = await recordPayout({
      coopId,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      incomeAmount: 100,
      actorUserId: operatorUserId,
    });
    expect(payout.totalShares).toBe(4);

    const allocations = await prisma.coopPayoutAllocation.findMany({
      where: { payoutId: payout.id },
      orderBy: { shares: "desc" },
    });
    expect(allocations.map((a) => Number(a.amount))).toEqual([75, 25]);
  });

  it("refuses a second payout for the same period", async () => {
    await expect(
      recordPayout({
        coopId,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        incomeAmount: 50,
        actorUserId: operatorUserId,
      }),
    ).rejects.toThrow(/already/i);
  });

  it("shows a member their shares, stake and payout history", async () => {
    const view = await readMemberShares(coopId, aliceUserId);
    expect(view).not.toBeNull();
    expect(view!.shares).toBe(3);
    expect(view!.totalShares).toBe(4);
    expect(view!.sharePercent).toBe(75);
    expect(view!.incomeToDate).toBe(75);
    expect(view!.payouts).toHaveLength(1);
    expect(view!.payouts[0].amount).toBe(75);
    expect(view!.payouts[0].paidAt).toBeNull();
  });

  it("has nothing to show for a non-member", async () => {
    expect(await readMemberShares(coopId, operatorUserId)).toBeNull();
  });
});

describe("governance — ТЗ §16.10 'один член, один голос', US-21", () => {
  let voteId: string;

  it("opens a vote", async () => {
    const vote = await openVote({
      coopId,
      question: "Where do we put the next powerbank?",
      options: ["Bratislava", "Košice"],
      closesAt: new Date(Date.now() + 60_000),
      actorUserId: operatorUserId,
    });
    voteId = vote.id;
    expect(vote.status).toBe("OPEN");
  });

  it("counts a member's last ballot only", async () => {
    await castBallot({ voteId, userId: aliceUserId, option: "Bratislava" });
    await castBallot({ voteId, userId: aliceUserId, option: "Košice" });
    const ballots = await prisma.coopBallot.findMany({ where: { voteId } });
    expect(ballots).toHaveLength(1);
    expect(ballots[0].option).toBe("Košice");
  });

  it("refuses a ballot for an option that is not on the paper", async () => {
    await expect(castBallot({ voteId, userId: bobUserId, option: "Vienna" })).rejects.toThrow(/option/i);
  });

  it("refuses a ballot from a member who has not passed KYC", async () => {
    const carolUserId = await seedUser(`${PREFIX}carol`);
    await addMember({ coopId, userId: carolUserId, shares: 10, actorUserId: operatorUserId });
    await expect(castBallot({ voteId, userId: carolUserId, option: "Košice" })).rejects.toThrow(/KYC|ACTIVE/i);
  });

  it("closes the vote and publishes the result", async () => {
    await castBallot({ voteId, userId: bobUserId, option: "Bratislava" });
    const result = await closeVote({ voteId, actorUserId: operatorUserId });
    expect(result.totalVotes).toBe(2);
    expect(result.winner).toBeNull(); // 1:1 tie — one member, one vote
    expect(result.tallies).toEqual([
      { option: "Bratislava", votes: 1 },
      { option: "Košice", votes: 1 },
    ]);

    const stored = await prisma.coopVote.findUniqueOrThrow({ where: { id: voteId } });
    expect(stored.status).toBe("CLOSED");
    expect(stored.closedAt).not.toBeNull();
  });

  it("refuses ballots once the vote is closed", async () => {
    await expect(castBallot({ voteId, userId: aliceUserId, option: "Košice" })).rejects.toThrow(/closed/i);
  });
});

describe("roaming quote — ТЗ §8, US-11", () => {
  beforeAll(async () => {
    // US-11 starts from a user who already holds kWh at home.
    const wallet = await getOrCreateWallet(aliceUserId, homeZoneId);
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { kwhBalance: new Prisma.Decimal(30) },
    });
  });

  it("refuses to quote without a clearing agreement between the zones", async () => {
    await expect(
      quoteRoaming({ userId: aliceUserId, visitedZone: VISIT_ZONE, amountKwh: 10 }),
    ).rejects.toThrow(/agreement/i);
  });

  it("quotes the conversion the user sees before confirming", async () => {
    await upsertRoamingAgreement({
      homeZone: HOME_ZONE,
      visitedZone: VISIT_ZONE,
      partnerName: "Test Clearing Partner",
      feePct: 5,
      actorUserId: operatorUserId,
    });

    const result = await quoteRoaming({ userId: aliceUserId, visitedZone: VISIT_ZONE, amountKwh: 10 });
    expect(result.homeZoneCode).toBe(HOME_ZONE);
    expect(result.visitedZoneCode).toBe(VISIT_ZONE);
    expect(result.partnerName).toBe("Test Clearing Partner");
    expect(result.quote.conversionRate).toBe(2);
    expect(result.quote.feeKwh).toBe(1);
    expect(result.quote.totalKwh).toBe(21);
    expect(result.quote.coveredKwh).toBe(21);
    expect(result.quote.shortfallKwh).toBe(0);
  });

  it("reports the shortfall that has to be bought on the exchange", async () => {
    const result = await quoteRoaming({ userId: aliceUserId, visitedZone: VISIT_ZONE, amountKwh: 20 });
    expect(result.quote.totalKwh).toBe(42);
    expect(result.quote.coveredKwh).toBe(30);
    expect(result.quote.shortfallKwh).toBe(12);
  });

  it("refuses an amount over the agreement's limit (§24.2 AML)", async () => {
    await upsertRoamingAgreement({
      homeZone: HOME_ZONE,
      visitedZone: VISIT_ZONE,
      partnerName: "Test Clearing Partner",
      feePct: 5,
      dailyLimitKwh: 5,
      actorUserId: operatorUserId,
    });
    await expect(
      quoteRoaming({ userId: aliceUserId, visitedZone: VISIT_ZONE, amountKwh: 10 }),
    ).rejects.toThrow(/limit/i);
  });

  it("refuses to quote a zone against itself", async () => {
    await expect(
      quoteRoaming({ userId: aliceUserId, visitedZone: HOME_ZONE, amountKwh: 10 }),
    ).rejects.toThrow(/same zone/i);
  });
});
