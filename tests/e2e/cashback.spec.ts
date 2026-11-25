// US-12 on the live build: the partner sets up a cashback campaign, a charge
// paid with tokens earns the share, and the driver finds it in the gifts
// section and on the receipt of the charge that earned it (§46.6).

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const OWNER = { username: "e2e_cashback_owner", password: "Pass1234" };
const DRIVER = { username: "e2e_cashback_driver", password: "Pass1234" };
const SLUG = "e2e-cashback-network";
const ZONE = "E2ECASHB";

let operatorId: string;
let zoneId: string;
let pointId: string;
let ownerUserId: string;
let driverUserId: string;
let assetId: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.receipt.deleteMany({ where: { payment: { zone: { code: ZONE } } } });
  await prisma.promoGrant.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.payment.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.campaign.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.asset.deleteMany({ where: { company: { regNumber: `${SLUG}-reg` } } });
  await prisma.company.deleteMany({ where: { regNumber: `${SLUG}-reg` } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
}

async function fund(userId: string, amount: number) {
  const wallet = await prisma.wallet.upsert({
    where: { ownerUserId_zoneId: { ownerUserId: userId, zoneId } },
    update: {},
    create: { ownerUserId: userId, zoneId },
  });
  await prisma.energyToken.create({
    data: {
      zoneId,
      assetId,
      ownerWalletId: wallet.id,
      amountKwh: new Prisma.Decimal(amount),
      intervalStart: new Date(),
      status: "AVAILABLE",
    },
  });
  await prisma.wallet.update({
    where: { id: wallet.id },
    data: { kwhBalance: { increment: new Prisma.Decimal(amount) } },
  });
  return wallet;
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

  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE, country: "SK", name: "E2E cashback zone", currency: "EUR" },
    })
  ).id;

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "E2E Cashback Network",
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
        name: "E2E Cashback Point",
        status: "PUBLISHED",
        publishedAt: new Date(),
        country: "SK",
        city: "Košice",
        gridZoneId: zoneId,
      },
    })
  ).id;

  const company = await prisma.company.create({
    data: {
      legalName: "E2E cashback producer",
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
        name: "E2E cashback roof",
        capacityKw: new Prisma.Decimal(50),
        status: "ACTIVE",
      },
    })
  ).id;

  // The partner's own generation pays the cashback; the driver has tokens to
  // pay with.
  await fund(ownerUserId, 100);
  await fund(driverUserId, 40);
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { in: [OWNER.username, DRIVER.username] } } });
  await prisma.$disconnect();
});

test("the partner sets up a cashback campaign in percent, not in kWh", async ({ page }) => {
  await signInWithPassword(page, OWNER);
  await page.goto(`/en/me/charger-operator/${operatorId}/campaigns`);

  await page.getByLabel("Trigger", { exact: true }).selectOption({ label: "Payment in tokens" });
  await page.getByLabel("Name", { exact: true }).fill("5 % back on tokens");
  await page.getByTestId("campaign-cashback-pct").fill("5");
  await page.getByLabel("Budget, kWh").fill("50");
  await page.getByLabel("Zone", { exact: true }).selectOption({ label: ZONE });
  await page.getByRole("button", { name: "Create as draft" }).click();

  const list = page.getByTestId("campaign-list");
  await expect(list).toContainText("5 % back on tokens");
  await expect(list).toContainText("Payment in tokens");
  await expect(list).toContainText("5 %");

  await page.getByTestId("start-campaign").first().click();
  await expect
    .poll(
      async () =>
        (await prisma.campaign.findFirst({ where: { operatorId, trigger: "TOKEN_PAYMENT" } }))
          ?.status,
    )
    .toBe("ACTIVE");
});

test("a charge paid with tokens earns the share, and it is in the history", async ({ page }) => {
  await signInWithPassword(page, DRIVER);

  const charge = await page.request.post("/api/v1/payments/charge", {
    headers: { "Idempotency-Key": "e2e-cashback-charge" },
    data: { zoneId, requestedKwh: 20, pointId },
  });
  expect(charge.status()).toBe(201);
  const body = (await charge.json()) as {
    payment: { kwhFromBalance: number; cashbackKwh: number; receiptId: string };
  };
  expect(body.payment.kwhFromBalance).toBe(20);
  // 5 % of 20 kWh paid in tokens.
  expect(body.payment.cashbackKwh).toBe(1);

  const grant = await prisma.promoGrant.findFirstOrThrow({
    where: { operatorId, userId: driverUserId },
  });
  expect(Number(grant.amountKwh)).toBe(1);

  // §46.6 — on the receipt of the charge that earned it.
  await page.goto(`/en/me/wallet/receipts/${body.payment.receiptId}`);
  const receipt = page.getByTestId("receipt");
  await expect(receipt).toContainText("Cashback earned");
  await expect(receipt).toContainText("1.000 kWh");

  // US-12 "отображение в истории" — in the gifts section, marked as cashback.
  await page.goto("/en/me/gifts");
  const gifts = page.getByTestId("gift-list");
  await expect(gifts).toContainText("E2E Cashback Network");
  await expect(page.getByTestId("gift-cashback-badge")).toContainText("5 %");
  await expect(page.getByTestId("gift-receipt-link")).toBeVisible();
});

test("a second charge earns cashback again, unlike a once-per-client gift", async ({ page }) => {
  await signInWithPassword(page, DRIVER);

  const charge = await page.request.post("/api/v1/payments/charge", {
    headers: { "Idempotency-Key": "e2e-cashback-charge-2" },
    data: { zoneId, requestedKwh: 10, pointId },
  });
  expect(charge.status()).toBe(201);
  const body = (await charge.json()) as { payment: { cashbackKwh: number } };
  expect(body.payment.cashbackKwh).toBeGreaterThan(0);

  expect(
    await prisma.promoGrant.count({ where: { operatorId, userId: driverUserId } }),
  ).toBe(2);
});
