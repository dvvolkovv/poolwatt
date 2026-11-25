// §54 on the live build: the partner changes a price, sees both versions in
// the history, and a receipt issued before the change still prints the price
// it was issued at.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const OWNER = { username: "e2e_price_owner", password: "Pass1234" };
const DRIVER = { username: "e2e_price_driver", password: "Pass1234" };
const SLUG = "e2e-price-network";
const ZONE = "E2EPRICE";

let operatorId: string;
let zoneId: string;
let pointId: string;
let ownerUserId: string;
let driverUserId: string;
let assetId: string;
let receiptId: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.receipt.deleteMany({ where: { payment: { zone: { code: ZONE } } } });
  await prisma.payment.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.pricingRule.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.asset.deleteMany({ where: { company: { regNumber: `${SLUG}-reg` } } });
  await prisma.company.deleteMany({ where: { regNumber: `${SLUG}-reg` } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
}

test.beforeAll(async () => {
  await wipe();

  const hash = await bcrypt.hash(OWNER.password, 10);
  ownerUserId = (
    await prisma.user.upsert({
      where: { username: OWNER.username },
      update: { passwordHash: hash },
      create: { username: OWNER.username, passwordHash: hash },
    })
  ).id;
  driverUserId = (
    await prisma.user.upsert({
      where: { username: DRIVER.username },
      update: { passwordHash: hash },
      create: { username: DRIVER.username, passwordHash: hash },
    })
  ).id;

  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE, country: "SK", name: "E2E price zone", currency: "EUR" },
    })
  ).id;

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "E2E Price Network",
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
        name: "E2E Price Point",
        status: "PUBLISHED",
        publishedAt: new Date(),
        country: "SK",
        city: "Košice",
        addressLine: "Hlavná 6",
        gridZoneId: zoneId,
        tariffs: {
          create: [
            {
              fromMinute: 0,
              toMinute: 1440,
              priceFiat: new Prisma.Decimal(0.42),
              priceTokens: new Prisma.Decimal(1.05),
              currency: "EUR",
            },
          ],
        },
      },
    })
  ).id;

  // The version the tariff above is at: seeded directly, as if the partner had
  // saved it through the wizard.
  await prisma.pricingRule.create({
    data: {
      scope: "POINT_TARIFF",
      scopeId: pointId,
      operatorId,
      version: 1,
      params: {
        tariffs: [
          {
            label: null,
            fromMinute: 0,
            toMinute: 1440,
            priceFiat: 0.42,
            currency: "EUR",
            priceTokens: 1.05,
            idleFeePerMin: null,
            coopDiscount: 0,
          },
        ],
      },
      createdById: ownerUserId,
    },
  });

  const company = await prisma.company.create({
    data: {
      legalName: "E2E price producer",
      country: "SK",
      regNumber: `${SLUG}-reg`,
      type: "PRODUCER",
      kybStatus: "APPROVED",
    },
  });
  assetId = (
    await prisma.asset.create({
      data: {
        companyId: company.id,
        gridZoneId: zoneId,
        kind: "SOLAR",
        name: "E2E price roof",
        capacityKw: new Prisma.Decimal(10),
        status: "ACTIVE",
      },
    })
  ).id;

  const wallet = await prisma.wallet.create({
    data: { ownerUserId: driverUserId, zoneId, kwhBalance: new Prisma.Decimal(20) },
  });
  await prisma.energyToken.create({
    data: {
      zoneId,
      assetId,
      ownerWalletId: wallet.id,
      amountKwh: new Prisma.Decimal(20),
      intervalStart: new Date(),
      status: "AVAILABLE",
    },
  });
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { in: [OWNER.username, DRIVER.username] } } });
  await prisma.$disconnect();
});

test("a receipt is issued under the tariff version in force", async ({ page }) => {
  await signInWithPassword(page, DRIVER);
  const charge = await page.request.post("/api/v1/payments/charge", {
    headers: { "Idempotency-Key": "e2e-price-charge-1" },
    data: { zoneId, requestedKwh: 5, pointId },
  });
  expect(charge.status()).toBe(201);
  const body = (await charge.json()) as { payment: { receiptId: string } };
  receiptId = body.payment.receiptId;

  const payment = await prisma.payment.findFirstOrThrow({
    where: { zoneId, pointId },
    orderBy: { createdAt: "desc" },
  });
  expect(payment.tariffVersion).toBe(1);

  await page.goto(`/en/me/wallet/receipts/${receiptId}`);
  await expect(page.locator("body")).toContainText("1.05");
});

test("the partner raises the price and sees both versions", async ({ page }) => {
  await signInWithPassword(page, OWNER);

  const put = await page.request.put(`/api/v1/partners/${operatorId}/pricing`, {
    data: { pricePerKwh: 0.55, currency: "EUR", note: "winter" },
  });
  expect(put.status()).toBe(200);

  const again = await page.request.put(`/api/v1/partners/${operatorId}/pricing`, {
    data: { pricePerKwh: 0.6, currency: "EUR", note: "winter peak" },
  });
  expect(again.status()).toBe(200);
  expect(((await again.json()) as { pricing: { version: number } }).pricing.version).toBe(2);

  const history = await page.request.get(`/api/v1/partners/${operatorId}/pricing/history`);
  expect(history.status()).toBe(200);
  const json = (await history.json()) as {
    history: { version: number; scope: string; note: string | null }[];
  };
  const networkVersions = json.history.filter((h) => h.scope === "NETWORK_PRICE");
  expect(networkVersions.map((h) => h.version)).toEqual([2, 1]);

  await page.goto(`/en/me/charger-operator/${operatorId}/pricing`);
  await expect(page.getByTestId("network-price")).toContainText("0.6");
  await expect(page.getByTestId("pricing-history")).toContainText("winter peak");
  await expect(page.getByTestId("pricing-history")).toContainText("Network price");
});

test("the receipt issued before the change still prints the old price", async ({ page }) => {
  // The partner doubles the token price of the point itself.
  await prisma.pointTariff.updateMany({
    where: { pointId },
    data: { priceFiat: new Prisma.Decimal(0.9), priceTokens: new Prisma.Decimal(2.1) },
  });
  await prisma.pricingRule.create({
    data: {
      scope: "POINT_TARIFF",
      scopeId: pointId,
      operatorId,
      version: 2,
      params: {
        tariffs: [
          {
            label: null,
            fromMinute: 0,
            toMinute: 1440,
            priceFiat: 0.9,
            currency: "EUR",
            priceTokens: 2.1,
            idleFeePerMin: null,
            coopDiscount: 0,
          },
        ],
      },
      createdById: ownerUserId,
    },
  });

  await signInWithPassword(page, DRIVER);
  await page.goto(`/en/me/wallet/receipts/${receiptId}`);
  // Still the price it was issued at, not the one in force now.
  await expect(page.locator("body")).toContainText("1.05");
  await expect(page.locator("body")).not.toContainText("2.1");

  // A new session is priced under the new version.
  const charge = await page.request.post("/api/v1/payments/charge", {
    headers: { "Idempotency-Key": "e2e-price-charge-2" },
    data: { zoneId, requestedKwh: 5, pointId },
  });
  expect(charge.status()).toBe(201);
  const body = (await charge.json()) as { payment: { receiptId: string } };
  await page.goto(`/en/me/wallet/receipts/${body.payment.receiptId}`);
  await expect(page.locator("body")).toContainText("2.1");
});

test("somebody else's tariffs do not exist", async ({ page }) => {
  await signInWithPassword(page, DRIVER);

  const put = await page.request.put(`/api/v1/partners/${operatorId}/pricing`, {
    data: { pricePerKwh: 0.01, currency: "EUR" },
  });
  expect(put.status()).toBe(404);

  const history = await page.request.get(`/api/v1/partners/${operatorId}/pricing/history`);
  expect(history.status()).toBe(404);

  const page404 = await page.goto(`/en/me/charger-operator/${operatorId}/pricing`);
  expect(page404?.status()).toBe(404);
});
