// US-10 and US-21 — what the member's own pages read. The service already had
// the arithmetic; these are the three readers the pages needed, and the one
// rule that matters most: nobody sees a tally before the vote closes.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  castBallot,
  closeVote,
  openVote,
  readIncomeForPeriod,
  readMemberVotes,
  readMyCooperatives,
} from "./coop-service";

const PREFIX = "test_coopboard_";
const ZONE_CODE = "TESTCOOPPG";

let zoneId: string;
let coopId: string;
let companyId: string;
let memberUserId: string;
let secondUserId: string;
let strangerUserId: string;
let memberId: string;
let adminUserId: string;

async function wipe() {
  await prisma.coopBallot.deleteMany({ where: { vote: { coop: { name: { startsWith: PREFIX } } } } });
  await prisma.coopVote.deleteMany({ where: { coop: { name: { startsWith: PREFIX } } } });
  await prisma.coopPayoutAllocation.deleteMany({
    where: { payout: { coop: { name: { startsWith: PREFIX } } } },
  });
  await prisma.coopPayout.deleteMany({ where: { coop: { name: { startsWith: PREFIX } } } });
  await prisma.coopMember.deleteMany({ where: { coop: { name: { startsWith: PREFIX } } } });
  await prisma.cooperative.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.company.deleteMany({ where: { regNumber: `${PREFIX}reg` } });
}

/** The zone outlives the per-test cooperatives; dropped once at the end. */
async function dropZone() {
  await prisma.gridZone.deleteMany({ where: { code: ZONE_CODE } });
}

beforeAll(async () => {
  await wipe();

  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE_CODE, country: "SK", name: "Coop page zone", currency: "EUR" },
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
  memberUserId = await user("member");
  secondUserId = await user("second");
  strangerUserId = await user("stranger");
  adminUserId = await user("admin");

});

/**
 * A fresh cooperative for every test.
 *
 * A fixture that lives for the whole file has to survive every other suite
 * running beside it for twenty seconds; one that lives for a single test does
 * not. Cheap, and it took a flake to learn.
 */
beforeEach(async () => {
  await wipe();

  companyId = (
    await prisma.company.create({
      data: {
        legalName: `${PREFIX}company`,
        country: "SK",
        regNumber: `${PREFIX}reg`,
        type: "COOPERATIVE",
        kybStatus: "APPROVED",
      },
    })
  ).id;

  coopId = (
    await prisma.cooperative.create({
      data: { companyId, zoneId, name: `${PREFIX}coop` },
    })
  ).id;

  memberId = (
    await prisma.coopMember.create({
      data: {
        coopId,
        userId: memberUserId,
        shares: 30,
        status: "ACTIVE",
        kycVerifiedAt: new Date(),
      },
    })
  ).id;
  await prisma.coopMember.create({
    data: {
      coopId,
      userId: secondUserId,
      shares: 70,
      status: "ACTIVE",
      kycVerifiedAt: new Date(),
    },
  });
});

afterAll(async () => {
  await wipe();
  await dropZone();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("readMyCooperatives — US-10's list", () => {
  it("shows the member their shares and their share of the whole", async () => {
    const mine = await readMyCooperatives(memberUserId);

    expect(mine).toHaveLength(1);
    expect(mine[0].coopName).toBe(`${PREFIX}coop`);
    expect(mine[0].zoneCode).toBe(ZONE_CODE);
    expect(mine[0].shares).toBe(30);
    expect(mine[0].sharePercent).toBe(30);
    expect(mine[0].memberStatus).toBe("ACTIVE");
  });

  it("says nothing to somebody who is in no cooperative", async () => {
    expect(await readMyCooperatives(strangerUserId)).toEqual([]);
  });

  it("counts the open votes this member still owes an answer on", async () => {
    await openVote({
      coopId,
      question: "Where next?",
      options: ["North", "South"],
      closesAt: new Date(Date.now() + 86_400_000),
      actorUserId: adminUserId,
    });

    expect((await readMyCooperatives(memberUserId))[0].openVotes).toBe(1);

    const [vote] = await prisma.coopVote.findMany({ where: { coopId } });
    await castBallot({ voteId: vote.id, userId: memberUserId, option: "North" });
    expect((await readMyCooperatives(memberUserId))[0].openVotes).toBe(0);
    // The other member still owes one.
    expect((await readMyCooperatives(secondUserId))[0].openVotes).toBe(1);
  });
});

describe("readMemberVotes — US-21's page", () => {
  async function aVote(closesInMs = 86_400_000) {
    return openVote({
      coopId,
      question: "Where should the next battery go?",
      options: ["Depot", "School", "Market"],
      closesAt: new Date(Date.now() + closesInMs),
      actorUserId: adminUserId,
    });
  }

  it("shows an open vote with no tally at all", async () => {
    const vote = await aVote();
    await castBallot({ voteId: vote.id, userId: memberUserId, option: "School" });
    await castBallot({ voteId: vote.id, userId: secondUserId, option: "Depot" });

    const [view] = await readMemberVotes(coopId, memberUserId);

    expect(view.status).toBe("OPEN");
    expect(view.myOption).toBe("School");
    // The whole point: the last voter must not read the outcome off the page.
    expect(view.result).toBeNull();
  });

  it("shows the result once the vote is closed", async () => {
    const vote = await aVote();
    await castBallot({ voteId: vote.id, userId: memberUserId, option: "School" });
    await castBallot({ voteId: vote.id, userId: secondUserId, option: "School" });
    await closeVote({ voteId: vote.id, actorUserId: adminUserId });

    const [view] = await readMemberVotes(coopId, memberUserId);

    expect(view.status).toBe("CLOSED");
    expect(view.result?.winner).toBe("School");
    expect(view.result?.totalVotes).toBe(2);
  });

  it("counts one vote per member however many shares they hold", async () => {
    const vote = await aVote();
    // 30 shares against 70, and the small holder wins two to... one.
    await castBallot({ voteId: vote.id, userId: memberUserId, option: "School" });
    await castBallot({ voteId: vote.id, userId: secondUserId, option: "Depot" });
    await closeVote({ voteId: vote.id, actorUserId: adminUserId });

    const [view] = await readMemberVotes(coopId, memberUserId);
    const tallies = Object.fromEntries(
      (view.result?.tallies ?? []).map((t) => [t.option, t.votes]),
    );
    expect(tallies.School).toBe(1);
    expect(tallies.Depot).toBe(1);
  });

  it("shows a changed ballot as the member's current answer", async () => {
    const vote = await aVote();
    await castBallot({ voteId: vote.id, userId: memberUserId, option: "School" });
    await castBallot({ voteId: vote.id, userId: memberUserId, option: "Market" });

    const [view] = await readMemberVotes(coopId, memberUserId);
    expect(view.myOption).toBe("Market");
    expect(await prisma.coopBallot.count({ where: { voteId: vote.id } })).toBe(1);
  });

  it("tells a non-member nothing about who voted how", async () => {
    const vote = await aVote();
    await castBallot({ voteId: vote.id, userId: memberUserId, option: "School" });

    const [view] = await readMemberVotes(coopId, strangerUserId);
    expect(view.myOption).toBeNull();
    expect(view.result).toBeNull();
  });
});

describe("readIncomeForPeriod — US-10's 'доход за период'", () => {
  async function payout(args: { from: Date; to: Date; income: number }) {
    const p = await prisma.coopPayout.create({
      data: {
        coopId,
        periodStart: args.from,
        periodEnd: args.to,
        incomeAmount: new Prisma.Decimal(args.income),
        totalShares: 100,
      },
    });
    await prisma.coopPayoutAllocation.create({
      data: {
        payoutId: p.id,
        memberId,
        shares: 30,
        amount: new Prisma.Decimal(args.income * 0.3),
      },
    });
    return p;
  }

  it("counts a payout in the period it was for, not when it was processed", async () => {
    await payout({
      from: new Date(Date.UTC(2026, 2, 1)),
      to: new Date(Date.UTC(2026, 3, 1)),
      income: 1000,
    });

    const march = await readIncomeForPeriod(
      coopId,
      memberUserId,
      new Date(Date.UTC(2026, 2, 1)),
      new Date(Date.UTC(2026, 3, 1)),
    );
    expect(march?.amount).toBe(300);
    expect(march?.payouts).toBe(1);

    const april = await readIncomeForPeriod(
      coopId,
      memberUserId,
      new Date(Date.UTC(2026, 3, 1)),
      new Date(Date.UTC(2026, 4, 1)),
    );
    expect(april?.amount).toBe(0);
  });

  it("adds up several payouts in one window", async () => {
    await payout({
      from: new Date(Date.UTC(2026, 0, 1)),
      to: new Date(Date.UTC(2026, 1, 1)),
      income: 1000,
    });
    await payout({
      from: new Date(Date.UTC(2026, 1, 1)),
      to: new Date(Date.UTC(2026, 2, 1)),
      income: 500,
    });

    const year = await readIncomeForPeriod(
      coopId,
      memberUserId,
      new Date(Date.UTC(2026, 0, 1)),
      new Date(Date.UTC(2027, 0, 1)),
    );
    expect(year?.amount).toBe(450);
    expect(year?.payouts).toBe(2);
  });

  it("says nothing at all to a non-member", async () => {
    expect(
      await readIncomeForPeriod(
        coopId,
        strangerUserId,
        new Date(Date.UTC(2026, 0, 1)),
        new Date(Date.UTC(2027, 0, 1)),
      ),
    ).toBeNull();
  });
});
