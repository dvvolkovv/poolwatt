// US-41, US-42 and US-43 on the live build: the partner builds a campaign, a
// newcomer's first charge earns the gift, the client sees it with the network
// and the date, and the gift pays for a charge in that network and nowhere
// else.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const OWNER = { username: "e2e_gift_owner", password: "Pass1234" };
const DRIVER = { username: "e2e_gift_driver", password: "Pass1234" };
const SLUG = "e2e-gift-network";
const OTHER_SLUG = "e2e-gift-other";
const ZONE = "E2EGIFT";

let operatorId: string;
let zoneId: string;
let pointId: string;
let foreignPointId: string;
let ownerUserId: string;
let driverUserId: string;
let assetId: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.receipt.deleteMany({ where: { payment: { zone: { code: ZONE } } } });
  await prisma.payment.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.promoGrant.deleteMany({
    where: { operator: { slug: { in: [SLUG, OTHER_SLUG] } } },
  });
  await prisma.campaign.deleteMany({ where: { operator: { slug: { in: [SLUG, OTHER_SLUG] } } } });
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { in: [SLUG, OTHER_SLUG] } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { in: [SLUG, OTHER_SLUG] } } });
  await prisma.asset.deleteMany({ where: { company: { regNumber: `${SLUG}-reg` } } });
  await prisma.company.deleteMany({ where: { regNumber: `${SLUG}-reg` } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
}

/** Batches in a wallet — what the partner actually gives away. */
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
      data: { code: ZONE, country: "SK", name: "E2E gift zone", currency: "EUR" },
    })
  ).id;

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "E2E Gift Network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  const other = await prisma.chargerOperator.create({
    data: { slug: OTHER_SLUG, displayName: "E2E Other Network" },
  });

  pointId = (
    await prisma.acceptancePoint.create({
      data: {
        operatorId,
        type: "CHARGING_STATION",
        name: "E2E Gift Point",
        status: "PUBLISHED",
        publishedAt: new Date(),
        country: "SK",
        city: "Košice",
        addressLine: "Hlavná 4",
        latitude: 48.73,
        longitude: 21.27,
        gridZoneId: zoneId,
      },
    })
  ).id;
  foreignPointId = (
    await prisma.acceptancePoint.create({
      data: {
        operatorId: other.id,
        type: "CHARGING_STATION",
        name: "E2E Other Point",
        status: "PUBLISHED",
        gridZoneId: zoneId,
      },
    })
  ).id;

  const company = await prisma.company.create({
    data: {
      legalName: "E2E gift producer",
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
        name: "E2E gift roof",
        capacityKw: new Prisma.Decimal(50),
        status: "ACTIVE",
      },
    })
  ).id;

  // The partner's own generation is what pays for the gifts.
  await fund(ownerUserId, 100);
  // And the driver has some kWh of their own, so a charge in a foreign
  // network can still go through.
  await fund(driverUserId, 50);
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { in: [OWNER.username, DRIVER.username] } } });
  await prisma.$disconnect();
});

test("the partner builds a campaign and starts it", async ({ page }) => {
  await signInWithPassword(page, OWNER);
  await page.goto(`/en/me/charger-operator/${operatorId}/campaigns`);

  await expect(page.getByTestId("campaign-form")).toBeVisible();
  // Funding from a settlement account is shut, and the page says so.
  await expect(page.getByTestId("funding-note")).toBeVisible();

  await page.getByLabel("Name", { exact: true }).fill("Welcome 8 kWh");
  await page.getByLabel("Gift, kWh").fill("8");
  await page.getByLabel("Budget, kWh").fill("40");
  await page.getByLabel("Zone", { exact: true }).selectOption({ label: ZONE });
  await page.getByRole("button", { name: "Create as draft" }).click();

  await expect(page.getByTestId("campaign-list")).toContainText("Welcome 8 kWh");
  await expect(page.getByTestId("campaign-list")).toContainText("Draft");

  await page.getByTestId("start-campaign").first().click();
  await expect
    .poll(async () =>
      (await prisma.campaign.findFirst({ where: { operatorId, name: "Welcome 8 kWh" } }))?.status,
    )
    .toBe("ACTIVE");
});

test("a newcomer's first charge earns the gift, and the client sees it", async ({ page }) => {
  // The charge itself is the API the station calls (US-08 / §15).
  await signInWithPassword(page, DRIVER);
  const charge = await page.request.post("/api/v1/payments/charge", {
    headers: { "Idempotency-Key": "e2e-gift-first-charge" },
    data: { zoneId, requestedKwh: 5, pointId },
  });
  expect(charge.status()).toBe(201);
  const body = (await charge.json()) as { payment: { kwhFromGift: number } };
  // The first charge is what earns the gift; it does not pay for itself.
  expect(body.payment.kwhFromGift).toBe(0);

  // US-41 — "начисление в течение минуты".
  await expect
    .poll(
      async () =>
        prisma.promoGrant.count({ where: { operatorId, userId: driverUserId, status: "ACTIVE" } }),
      { timeout: 20_000 },
    )
    .toBe(1);

  // US-42 — the section with the partner, the amount, the date and the button.
  await page.goto("/en/me/gifts");
  await expect(page.getByTestId("gift-list")).toContainText("E2E Gift Network");
  await expect(page.getByTestId("gift-list")).toContainText("8");
  await expect(page.getByTestId("show-stations")).toBeVisible();

  const api = await page.request.get("/api/v1/wallets/me/gifts");
  expect(api.status()).toBe(200);
  const json = (await api.json()) as {
    gifts: { remainingKwh: number; transferable: boolean }[];
    totalRemainingKwh: number;
  };
  expect(json.totalRemainingKwh).toBe(8);
  expect(json.gifts[0].transferable).toBe(false);

  // §43 — shown apart from the balance, not inside it.
  await page.goto("/en/me/wallet");
  await expect(page.getByTestId("wallet-gifts")).toContainText("E2E Gift Network");
});

test("the gift pays for a charge in that network and is refused in another", async ({ page }) => {
  await signInWithPassword(page, DRIVER);

  const driverBefore = await prisma.wallet.findFirstOrThrow({
    where: { ownerUserId: driverUserId, zoneId },
  });

  // In the partner's own network: the gift goes first and costs nothing.
  const own = await page.request.post("/api/v1/payments/charge", {
    headers: { "Idempotency-Key": "e2e-gift-spend-own" },
    data: { zoneId, requestedKwh: 6, pointId },
  });
  expect(own.status()).toBe(201);
  const ownBody = (await own.json()) as {
    payment: { kwhFromGift: number; kwhFromBalance: number; amountFiat: number };
  };
  expect(ownBody.payment.kwhFromGift).toBe(6);
  expect(ownBody.payment.kwhFromBalance).toBe(0);
  expect(ownBody.payment.amountFiat).toBe(0);

  // The driver's own kWh are untouched: the partner paid for all six.
  const driverAfterOwn = await prisma.wallet.findUniqueOrThrow({ where: { id: driverBefore.id } });
  expect(Number(driverAfterOwn.kwhBalance)).toBe(Number(driverBefore.kwhBalance));

  // US-43 — in somebody else's network the gift is not applied at all.
  const foreign = await page.request.post("/api/v1/payments/charge", {
    headers: { "Idempotency-Key": "e2e-gift-spend-foreign" },
    data: { zoneId, requestedKwh: 2, pointId: foreignPointId },
  });
  expect(foreign.status()).toBe(201);
  const foreignBody = (await foreign.json()) as {
    payment: { kwhFromGift: number; kwhFromBalance: number };
  };
  expect(foreignBody.payment.kwhFromGift).toBe(0);
  expect(foreignBody.payment.kwhFromBalance).toBe(2);

  // What is left of the gift is 2 kWh, and the page says so.
  await page.goto("/en/me/gifts");
  await expect(page.getByTestId("gift-list")).toContainText("2");

  const grant = await prisma.promoGrant.findFirstOrThrow({
    where: { operatorId, userId: driverUserId },
  });
  expect(Number(grant.usedKwh)).toBe(6);
});
