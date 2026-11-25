// US-44 on the live build: a show and a click on the partner's content reach
// the dashboard of §44, the campaign's own numbers are there, and the CSV
// export carries the same figures.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const OWNER = { username: "e2e_analytics_owner", password: "Pass1234" };
const DRIVER = { username: "e2e_analytics_driver", password: "Pass1234" };
const SLUG = "e2e-analytics-network";
const ZONE = "E2EANLT";

let operatorId: string;
let ownerUserId: string;
let driverUserId: string;
let pointId: string;
let campaignId: string;
let contentId: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.contentEvent.deleteMany({ where: { content: { operator: { slug: SLUG } } } });
  await prisma.marketingContent.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.promoGrant.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.receipt.deleteMany({ where: { payment: { zone: { code: ZONE } } } });
  await prisma.payment.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.campaign.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
}

test.beforeAll(async () => {
  await wipe();

  const hash = await bcrypt.hash(OWNER.password, 10);
  const user = async (username: string) =>
    (
      await prisma.user.upsert({
        where: { username },
        update: { passwordHash: hash },
        create: { username, passwordHash: hash },
      })
    ).id;
  ownerUserId = await user(OWNER.username);
  driverUserId = await user(DRIVER.username);

  const zone = await prisma.gridZone.create({
    data: { code: ZONE, country: "SK", name: "E2E analytics zone", currency: "EUR" },
  });

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "E2E Analytics Network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  pointId = (
    await prisma.acceptancePoint.create({
      data: {
        operatorId,
        type: "CHARGING_STATION",
        name: "E2E Analytics Point",
        status: "PUBLISHED",
        publishedAt: new Date(),
        country: "SK",
        city: "Košice",
        latitude: 48.72,
        longitude: 21.26,
        gridZoneId: zone.id,
      },
    })
  ).id;

  contentId = (
    await prisma.marketingContent.create({
      data: {
        operatorId,
        type: "PROMO",
        title: "E2E Analytics Promo",
        body: "Come and charge",
        linkUrl: "https://example.com/promo",
        status: "APPROVED",
        placements: ["FULL_CARD"],
      },
    })
  ).id;

  campaignId = (
    await prisma.campaign.create({
      data: {
        operatorId,
        zoneId: zone.id,
        name: "E2E Analytics Campaign",
        trigger: "FIRST_CHARGE",
        giftKwh: new Prisma.Decimal(10),
        validityDays: 30,
        budgetKwh: new Prisma.Decimal(100),
        status: "ACTIVE",
      },
    })
  ).id;

  // A client the campaign reached: one charge and the gift it earned.
  const wallet = await prisma.wallet.create({
    data: { ownerUserId: driverUserId, zoneId: zone.id, currency: "EUR" },
  });
  const payment = await prisma.payment.create({
    data: {
      walletId: wallet.id,
      zoneId: zone.id,
      pointId,
      requestedKwh: new Prisma.Decimal(12),
      kwhFromBalance: new Prisma.Decimal(12),
      amountFiat: new Prisma.Decimal(3.4),
      status: "CAPTURED",
      capturedAt: new Date(),
    },
  });
  await prisma.promoGrant.create({
    data: {
      campaignId,
      userId: driverUserId,
      operatorId,
      paymentId: payment.id,
      onceKey: "once",
      amountKwh: new Prisma.Decimal(10),
      usedKwh: new Prisma.Decimal(2),
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    },
  });
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { in: [OWNER.username, DRIVER.username] } } });
  await prisma.$disconnect();
});

test("a show and a click on the point card are counted (§44)", async ({ page }) => {
  // The full card of §28 is reached by the point's own id.
  await page.goto(`/en/c/${pointId}`);
  await expect(page.getByTestId("marketing-promo")).toBeVisible();

  // The browser reports the show by itself.
  await expect
    .poll(
      async () => prisma.contentEvent.count({ where: { contentId, kind: "IMPRESSION" } }),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);

  // And the click on the partner's own link.
  await page
    .getByTestId("marketing-promo")
    .getByRole("link", { name: "E2E Analytics Promo" })
    .click({ modifiers: ["Alt"] });
  await expect
    .poll(async () => prisma.contentEvent.count({ where: { contentId, kind: "CLICK" } }), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
});

test("the partner's dashboard shows the numbers of §44", async ({ page }) => {
  await signInWithPassword(page, OWNER);
  await page.goto(`/en/me/charger-operator/${operatorId}/campaigns`);
  await page.getByTestId("analytics-link").click();

  const table = page.getByTestId("analytics-campaigns");
  await expect(table).toContainText("E2E Analytics Campaign");
  await expect(page.getByTestId(`clients-${campaignId}`)).toHaveText("1");
  // Given 10 kWh, 2 of them spent, and what that client paid in 30 days.
  await expect(table).toContainText("10.000");
  await expect(table).toContainText("2.000");
  await expect(table).toContainText("3.40");

  const content = page.getByTestId("analytics-content");
  await expect(content).toContainText("E2E Analytics Promo");
  await expect(page.getByTestId(`impressions-${contentId}`)).not.toHaveText("0");
  await expect(page.getByTestId(`clicks-${contentId}`)).not.toHaveText("0");
});

test("the CSV export carries the same figures (§44)", async ({ page }) => {
  await signInWithPassword(page, OWNER);
  const res = await page.request.get(`/api/v1/campaigns/${campaignId}/stats?format=csv`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");

  const csv = await res.text();
  const lines = csv.trim().split("\r\n");
  expect(lines[0]).toContain("cost_per_client_kwh");
  expect(lines[1]).toContain("E2E Analytics Campaign");
  expect(lines[1]).toContain('"1"');
  expect(csv).toContain("E2E Analytics Promo");
});

test("somebody else's campaign is not theirs to read", async ({ page }) => {
  await signInWithPassword(page, DRIVER);
  const res = await page.request.get(`/api/v1/campaigns/${campaignId}/stats`);
  expect(res.status()).toBeGreaterThanOrEqual(400);

  const page404 = await page.goto(`/en/me/charger-operator/${operatorId}/campaigns/analytics`);
  expect(page404?.status()).toBe(404);
});
