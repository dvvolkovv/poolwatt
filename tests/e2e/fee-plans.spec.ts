// §53 on the live build: the operator keeps the plans, puts a network on one,
// writes individual terms over it, and the commission a driver is quoted
// changes accordingly.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const ADMIN = { username: "e2e_plan_admin", password: "Pass1234" };
const DRIVER = { username: "e2e_plan_driver", password: "Pass1234" };
const SLUG = "e2e-plan-network";
const ZONE = "E2EPLAN";
const PLAN = "e2e-plan-corporate";

let operatorId: string;
let zoneId: string;
let pointId: string;
let driverUserId: string;
let planId: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.partnerPlan.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.platformFeePlan.deleteMany({ where: { name: { startsWith: "e2e-plan-" } } });
  await prisma.order.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.pricingRule.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.asset.deleteMany({ where: { company: { regNumber: `${SLUG}-reg` } } });
  await prisma.company.deleteMany({ where: { regNumber: `${SLUG}-reg` } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
}

test.beforeAll(async () => {
  await wipe();

  const hash = await bcrypt.hash(ADMIN.password, 10);
  const admin = await prisma.user.upsert({
    where: { username: ADMIN.username },
    update: { passwordHash: hash, role: "ADMIN" },
    create: { username: ADMIN.username, passwordHash: hash, role: "ADMIN" },
  });
  driverUserId = (
    await prisma.user.upsert({
      where: { username: DRIVER.username },
      update: { passwordHash: hash },
      create: { username: DRIVER.username, passwordHash: hash },
    })
  ).id;

  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE, country: "SK", name: "E2E plan zone", currency: "EUR" },
    })
  ).id;

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "E2E Plan Network",
        claimedById: admin.id,
        claimedAt: new Date(),
      },
    })
  ).id;
  pointId = (
    await prisma.acceptancePoint.create({
      data: {
        operatorId,
        type: "CHARGING_STATION",
        name: "E2E Plan Point",
        status: "PUBLISHED",
        gridZoneId: zoneId,
      },
    })
  ).id;

  const company = await prisma.company.create({
    data: {
      legalName: "E2E plan producer",
      country: "SK",
      regNumber: `${SLUG}-reg`,
      type: "PRODUCER",
      kybStatus: "APPROVED",
    },
  });
  const asset = await prisma.asset.create({
    data: {
      companyId: company.id,
      gridZoneId: zoneId,
      kind: "SOLAR",
      name: "E2E plan roof",
      capacityKw: new Prisma.Decimal(10),
      status: "ACTIVE",
    },
  });

  // A resting ask, so a quoted session has something to buy and therefore a
  // commission to pay.
  const sellerWallet = await prisma.wallet.create({
    data: { ownerUserId: admin.id, zoneId, kwhBalance: new Prisma.Decimal(50) },
  });
  await prisma.energyToken.create({
    data: {
      zoneId,
      assetId: asset.id,
      ownerWalletId: sellerWallet.id,
      amountKwh: new Prisma.Decimal(50),
      intervalStart: new Date(),
      status: "AVAILABLE",
    },
  });
  await prisma.order.create({
    data: {
      walletId: sellerWallet.id,
      zoneId,
      side: "SELL",
      type: "LIMIT",
      amountKwh: new Prisma.Decimal(50),
      limitPrice: new Prisma.Decimal(0.2),
      status: "NEW",
    },
  });
  await prisma.wallet.create({ data: { ownerUserId: driverUserId, zoneId } });
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { in: [ADMIN.username, DRIVER.username] } } });
  await prisma.$disconnect();
});

test("the operator creates a plan and puts the network on it", async ({ page }) => {
  await signInWithPassword(page, ADMIN);
  await page.goto("/en/admin/fee-plans");

  await expect(page.getByTestId("plan-form-new")).toBeVisible();
  // Card tariffs are shut and the page says why.
  await expect(page.getByTestId("card-tariffs-note")).toBeVisible();

  await page.getByTestId("plan-form-new").getByLabel("Name", { exact: true }).fill(PLAN);
  await page.getByTestId("plan-form-new").getByLabel("Tier", { exact: true }).selectOption("CORPORATE");
  await page.getByTestId("plan-form-new").getByLabel("Charging %", { exact: true }).fill("0.5");
  await page.getByTestId("save-plan-new").click();

  await expect
    .poll(async () => (await prisma.platformFeePlan.findUnique({ where: { name: PLAN } }))?.tier)
    .toBe("CORPORATE");
  planId = (await prisma.platformFeePlan.findUniqueOrThrow({ where: { name: PLAN } })).id;

  await page.reload();
  await expect(page.getByTestId("plan-list")).toContainText(PLAN);

  await page.getByTestId("assign-form").getByLabel("Plan", { exact: true }).selectOption(planId);
  await page.getByTestId("assign-form").getByLabel("Network", { exact: true }).selectOption(operatorId);
  await page.getByTestId("assign-plan").click();

  await expect
    .poll(async () => prisma.partnerPlan.count({ where: { operatorId, planId } }))
    .toBe(1);
  await page.reload();
  await expect(page.getByTestId("assignment-list")).toContainText("E2E Plan Network");
});

test("the plan decides the commission a driver is quoted", async ({ page }) => {
  await signInWithPassword(page, DRIVER);

  const quote = await page.request.post("/api/v1/payments/quote", {
    data: { zoneId, requestedKwh: 10, pointId },
  });
  expect(quote.status()).toBe(200);
  const body = (await quote.json()) as { quote: { energyCost: number; fee: number } };

  // 10 kWh at 0.20 = 2.00; the corporate plan takes 0.5 %.
  expect(body.quote.energyCost).toBe(2);
  expect(body.quote.fee).toBe(0.01);
});

test("individual terms override the plan", async ({ page }) => {
  await signInWithPassword(page, ADMIN);
  await page.goto("/en/admin/fee-plans");

  await page.getByTestId("assign-form").getByLabel("Plan", { exact: true }).selectOption(planId);
  await page
    .getByTestId("assign-form")
    .getByLabel("Network", { exact: true })
    .selectOption(operatorId);
  await page
    .getByTestId("assign-form")
    .getByLabel("Charging % override", { exact: true })
    .fill("0");
  await page.getByTestId("assign-form").getByLabel("Note", { exact: true }).fill("pilot");
  await page.getByTestId("assign-plan").click();

  await expect
    .poll(async () => {
      const row = await prisma.partnerPlan.findFirst({ where: { operatorId } });
      return (row?.overrides as { chargeFeePct?: number } | null)?.chargeFeePct;
    })
    .toBe(0);

  await page.context().clearCookies();
  await signInWithPassword(page, DRIVER);
  const quote = await page.request.post("/api/v1/payments/quote", {
    data: { zoneId, requestedKwh: 10, pointId },
  });
  const body = (await quote.json()) as { quote: { fee: number; total: number } };
  expect(body.quote.fee).toBe(0);
  expect(body.quote.total).toBe(2);
});

test("PUT /v1/admin/fee-plans/{id} changes a rate, and refuses a card tariff", async ({ page }) => {
  await signInWithPassword(page, ADMIN);

  const put = await page.request.put(`/api/v1/admin/fee-plans/${planId}`, {
    data: { tradeFeePct: 0.25, bookingFeePct: 1 },
  });
  expect(put.status()).toBe(200);
  const body = (await put.json()) as { plan: { tradeFeePct: number; bookingFeePct: number } };
  expect(body.plan.tradeFeePct).toBe(0.25);
  expect(body.plan.bookingFeePct).toBe(1);

  // §53's card tariffs are shut: 503, not a silently ignored field.
  const cards = await page.request.put(`/api/v1/admin/fee-plans/${planId}`, {
    data: { cardInterchangePct: 0.3 },
  });
  expect(cards.status()).toBe(503);

  const missing = await page.request.put("/api/v1/admin/fee-plans/no-such-plan", {
    data: { tradeFeePct: 1 },
  });
  expect(missing.status()).toBe(404);
});

test("the plans are the operator's, not a partner's", async ({ page }) => {
  await signInWithPassword(page, DRIVER);

  const put = await page.request.put(`/api/v1/admin/fee-plans/${planId}`, {
    data: { tradeFeePct: 0 },
  });
  expect(put.status()).toBe(401);

  const res = await page.goto("/en/admin/fee-plans");
  expect(res?.status()).toBe(404);
});
