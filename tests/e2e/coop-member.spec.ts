// US-10 and US-21 on the live build: a member sees their shares, income and
// payout history, votes and changes their vote, and the score appears only
// once the vote is closed.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const MEMBER = { username: "e2e_coop_member", password: "Pass1234" };
const SECOND = { username: "e2e_coop_second", password: "Pass1234" };
const STRANGER = { username: "e2e_coop_stranger", password: "Pass1234" };
const COOP = "e2e-coop";
const ZONE = "E2ECOOP";

let coopId: string;
let memberUserId: string;
let secondUserId: string;
let memberId: string;
let voteId: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.coopBallot.deleteMany({ where: { vote: { coop: { name: COOP } } } });
  await prisma.coopVote.deleteMany({ where: { coop: { name: COOP } } });
  await prisma.coopPayoutAllocation.deleteMany({
    where: { payout: { coop: { name: COOP } } },
  });
  await prisma.coopPayout.deleteMany({ where: { coop: { name: COOP } } });
  await prisma.coopMember.deleteMany({ where: { coop: { name: COOP } } });
  await prisma.cooperative.deleteMany({ where: { name: COOP } });
  await prisma.company.deleteMany({ where: { regNumber: `${COOP}-reg` } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
}

test.beforeAll(async () => {
  await wipe();

  const hash = await bcrypt.hash(MEMBER.password, 10);
  const user = async (name: string) =>
    (
      await prisma.user.upsert({
        where: { username: name },
        update: { passwordHash: hash },
        create: { username: name, passwordHash: hash },
      })
    ).id;
  memberUserId = await user(MEMBER.username);
  secondUserId = await user(SECOND.username);
  await user(STRANGER.username);

  const zone = await prisma.gridZone.create({
    data: { code: ZONE, country: "SK", name: "E2E coop zone", currency: "EUR" },
  });
  const company = await prisma.company.create({
    data: {
      legalName: "E2E coop company",
      country: "SK",
      regNumber: `${COOP}-reg`,
      type: "COOPERATIVE",
      kybStatus: "APPROVED",
    },
  });
  coopId = (
    await prisma.cooperative.create({
      data: { companyId: company.id, zoneId: zone.id, name: COOP },
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

  // A paid-out quarter and an unpaid one, so the history has both kinds.
  const paid = await prisma.coopPayout.create({
    data: {
      coopId,
      periodStart: new Date(Date.UTC(2026, 0, 1)),
      periodEnd: new Date(Date.UTC(2026, 3, 1)),
      incomeAmount: new Prisma.Decimal(1000),
      totalShares: 100,
    },
  });
  await prisma.coopPayoutAllocation.create({
    data: {
      payoutId: paid.id,
      memberId,
      shares: 30,
      amount: new Prisma.Decimal(300),
      paidAt: new Date(Date.UTC(2026, 3, 5)),
    },
  });
  const unpaid = await prisma.coopPayout.create({
    data: {
      coopId,
      periodStart: new Date(Date.UTC(2026, 3, 1)),
      periodEnd: new Date(Date.UTC(2026, 6, 1)),
      incomeAmount: new Prisma.Decimal(500),
      totalShares: 100,
    },
  });
  await prisma.coopPayoutAllocation.create({
    data: { payoutId: unpaid.id, memberId, shares: 30, amount: new Prisma.Decimal(150) },
  });

  voteId = (
    await prisma.coopVote.create({
      data: {
        coopId,
        question: "Where should the next battery go?",
        options: ["Depot", "School", "Market"],
        closesAt: new Date(Date.now() + 7 * 86_400_000),
      },
    })
  ).id;
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({
    where: { username: { in: [MEMBER.username, SECOND.username, STRANGER.username] } },
  });
  await prisma.$disconnect();
});

test("a member sees their shares, income and payout history (US-10)", async ({ page }) => {
  await signInWithPassword(page, MEMBER);

  // The cabinet now has a door into the cooperative.
  await page.goto("/en/me");
  await expect(page.getByTestId("me-coop")).toContainText("Your cooperatives");

  await page.goto("/en/me/coop");
  await expect(page.getByTestId("coop-list")).toContainText(COOP);
  await expect(page.getByTestId("coop-list")).toContainText("30");

  await page.goto(`/en/me/coop/${coopId}`);
  await expect(page.getByTestId("coop-shares")).toContainText("30");
  // 30 of 100 shares.
  await expect(page.getByTestId("coop-shares")).toContainText("30%");
  // 300 paid plus 150 not yet.
  await expect(page.getByTestId("coop-shares")).toContainText("450.00");
  await expect(page.getByTestId("coop-shares")).toContainText("150.00");

  await expect(page.getByTestId("coop-payouts")).toContainText("2026-01-01");
  await expect(page.getByTestId("coop-payouts")).toContainText("300.00");
  await expect(page.getByTestId("coop-payouts")).toContainText("not paid yet");

  // "Доход за период": all time is 450, this month is nothing.
  await page.goto(`/en/me/coop/${coopId}?period=all`);
  await expect(page.getByTestId("coop-period-income")).toContainText("450.00");
  await page.goto(`/en/me/coop/${coopId}?period=month`);
  await expect(page.getByTestId("coop-period-income")).toContainText("0.00");
});

test("a member votes, changes their vote, and sees no score (US-21)", async ({ page }) => {
  await signInWithPassword(page, MEMBER);
  await page.goto(`/en/me/coop/${coopId}`);

  await expect(page.getByTestId("coop-votes")).toContainText("Where should the next battery go?");
  await expect(page.getByTestId(`ballot-${voteId}`)).toBeVisible();
  // While the vote is open there is no tally on the page at all.
  await expect(page.getByTestId(`result-${voteId}`)).toHaveCount(0);

  await page.getByTestId(`ballot-${voteId}`).getByRole("radio", { name: "School" }).check();
  await page.getByTestId(`cast-${voteId}`).click();

  await expect
    .poll(async () => {
      const b = await prisma.coopBallot.findFirst({ where: { voteId, memberId } });
      return b?.option;
    })
    .toBe("School");

  // One member, one vote: changing it replaces the ballot, not adds one.
  await page.reload();
  await page.getByTestId(`ballot-${voteId}`).getByRole("radio", { name: "Market" }).check();
  await page.getByTestId(`cast-${voteId}`).click();

  await expect
    .poll(async () => {
      const b = await prisma.coopBallot.findFirst({ where: { voteId, memberId } });
      return b?.option;
    })
    .toBe("Market");
  expect(await prisma.coopBallot.count({ where: { voteId } })).toBe(1);
});

test("the score appears once the vote is closed", async ({ page }) => {
  // The second member votes too, then the operator closes it.
  const second = await prisma.coopMember.findFirstOrThrow({
    where: { coopId, userId: secondUserId },
  });
  await prisma.coopBallot.create({
    data: { voteId, memberId: second.id, option: "Market" },
  });
  await prisma.coopVote.update({
    where: { id: voteId },
    data: { status: "CLOSED", closedAt: new Date(), winner: "Market" },
  });

  await signInWithPassword(page, MEMBER);
  await page.goto(`/en/me/coop/${coopId}`);

  await expect(page.getByTestId(`result-${voteId}`)).toContainText("Market");
  await expect(page.getByTestId(`result-${voteId}`)).toContainText("chosen");
  await expect(page.getByTestId(`result-${voteId}`)).toContainText("2");
  // And no way to vote on a closed one.
  await expect(page.getByTestId(`ballot-${voteId}`)).toHaveCount(0);
});

test("somebody else's cooperative does not exist", async ({ page }) => {
  await signInWithPassword(page, STRANGER);

  await page.goto("/en/me/coop");
  await expect(page.getByTestId("coop-empty")).toBeVisible();

  const res = await page.goto(`/en/me/coop/${coopId}`);
  expect(res?.status()).toBe(404);
});
