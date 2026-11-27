// §42 on the live build: the partner builds the two campaigns the gift
// constructor could not express before — a promo code with a discount in
// percent, and a free booking — and the driver redeems the code, sees the
// discount take its share of a real charge, and finds the booking fee waived
// before confirming (§54).

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const OWNER = { username: "e2e_gc_owner", password: "Pass1234" };
const DRIVER = { username: "e2e_gc_driver", password: "Pass1234" };
const SLUG = "e2e-gift-constructor";
const ZONE = "E2EGIFTC";
const CODE = "E2EGIFT2026";

let operatorId: string;
let zoneId: string;
let pointId: string;
let connectorId: string;
let ownerUserId: string;
let driverUserId: string;
let assetId: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.receipt.deleteMany({ where: { payment: { zone: { code: ZONE } } } });
  await prisma.reservation.deleteMany({ where: { point: { operator: { slug: SLUG } } } });
  await prisma.reservationPolicy.deleteMany({ where: { point: { operator: { slug: SLUG } } } });
  await prisma.promoGrant.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.payment.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.campaign.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.coopMember.deleteMany({ where: { coop: { name: `${SLUG}-coop` } } });
  await prisma.cooperative.deleteMany({ where: { name: `${SLUG}-coop` } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.asset.deleteMany({ where: { company: { regNumber: `${SLUG}-reg` } } });
  await prisma.company.deleteMany({ where: { regNumber: { startsWith: `${SLUG}-` } } });
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
    data: {
      kwhBalance: { increment: new Prisma.Decimal(amount) },
      fiatBalance: new Prisma.Decimal(50),
    },
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
      data: { code: ZONE, country: "SK", name: "E2E gift constructor zone", currency: "EUR" },
    })
  ).id;

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "E2E Gift Constructor Network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;

  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId,
      type: "CHARGING_STATION",
      name: "E2E Gift Point",
      status: "PUBLISHED",
      publishedAt: new Date(),
      country: "SK",
      city: "Košice",
      addressLine: "Hlavná 2",
      latitude: 48.72,
      longitude: 21.26,
      howToFind: "by the gate",
      energySource: "SOLAR",
      open24: true,
      paymentMethods: ["TOKEN"],
      gridZoneId: zoneId,
      connectors: {
        create: [
          {
            type: "CCS2",
            powerKw: new Prisma.Decimal(150),
            currentAc: false,
            quantity: 1,
            status: "FREE",
          },
        ],
      },
    },
    include: { connectors: true },
  });
  pointId = point.id;
  connectorId = point.connectors[0].id;

  // §33 — a booking fee to waive, and §34's KYC, which lives on cooperative
  // membership.
  await prisma.reservationPolicy.create({
    data: {
      pointId,
      enabled: true,
      walkUpConnectors: 0,
      feeFiat: new Prisma.Decimal(2),
      guaranteeFiat: new Prisma.Decimal(5),
      noShowPenaltyFiat: new Prisma.Decimal(3),
      waitMinutes: 15,
      freeCancelMinutes: 30,
      maxAheadHours: 24,
      currency: "EUR",
    },
  });
  const coopCompany = await prisma.company.create({
    data: {
      legalName: `${SLUG} coop`,
      country: "SK",
      regNumber: `${SLUG}-coopreg`,
      type: "COOPERATIVE",
      kybStatus: "APPROVED",
      ownerUserId,
    },
  });
  const coop = await prisma.cooperative.create({
    data: { name: `${SLUG}-coop`, zoneId, companyId: coopCompany.id },
  });
  await prisma.coopMember.create({
    data: {
      coopId: coop.id,
      userId: driverUserId,
      status: "ACTIVE",
      shares: 1,
      kycVerifiedAt: new Date(),
    },
  });

  const producer = await prisma.company.create({
    data: {
      legalName: `${SLUG} producer`,
      country: "SK",
      regNumber: `${SLUG}-reg`,
      type: "PRODUCER",
      kybStatus: "APPROVED",
    },
  });
  assetId = (
    await prisma.asset.create({
      data: {
        companyId: producer.id,
        gridZoneId: zoneId,
        kind: "SOLAR",
        name: "E2E gift roof",
        capacityKw: new Prisma.Decimal(50),
        status: "ACTIVE",
      },
    })
  ).id;

  // The partner's own generation pays for every gift; the driver has tokens
  // for the part the discount does not cover.
  await fund(ownerUserId, 100);
  await fund(driverUserId, 40);
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { in: [OWNER.username, DRIVER.username] } } });
  await prisma.$disconnect();
});

test("the partner builds a promo code with a discount, and a free booking", async ({ page }) => {
  await signInWithPassword(page, OWNER);
  await page.goto(`/en/me/charger-operator/${operatorId}/campaigns`);

  // The list carries a "Budget, kWh" field of its own per campaign, so every
  // field below is addressed inside the form.
  const form = page.getByTestId("campaign-form");

  // §42 — a code the driver types, paying a 20 % discount out of up to 30 kWh.
  await form.getByLabel("Trigger", { exact: true }).selectOption({ label: "Promo code or QR sticker" });
  await form.getByLabel("Name", { exact: true }).fill("Come in with the code");
  await page.getByTestId("campaign-promo-code").fill(CODE);
  await form.getByLabel("Gift, kWh").fill("30");
  await page.getByTestId("campaign-discount-pct").fill("20");
  await form.getByLabel("Budget, kWh").fill("100");
  await form.getByLabel("Zone", { exact: true }).selectOption({ label: ZONE });
  await expect(page.getByTestId("discount-note")).toBeVisible();
  await page.getByRole("button", { name: "Create as draft" }).click();

  const list = page.getByTestId("campaign-list");
  await expect(list).toContainText("Come in with the code");
  await expect(list).toContainText("−20 %");
  await expect(page.getByTestId("promo-code-row")).toContainText(CODE);

  // §42 — the free booking, on the first charge in the network.
  await form.getByLabel("Trigger", { exact: true }).selectOption({ label: "First charge in the network" });
  await form.getByLabel("Name", { exact: true }).fill("A booking on us");
  await form.getByLabel("Gift, kWh").fill("0");
  await page.getByTestId("campaign-discount-pct").fill("");
  await page.getByTestId("campaign-free-booking").check();
  await page.getByTestId("campaign-budget-grants").fill("5");
  await form.getByLabel("Budget, kWh").fill("0");
  await expect(page.getByTestId("booking-note")).toBeVisible();
  await page.getByRole("button", { name: "Create as draft" }).click();
  await expect(list).toContainText("A booking on us");

  // Both start: a campaign only pays out once the partner says so.
  for (const name of ["Come in with the code", "A booking on us"]) {
    const campaign = await prisma.campaign.findFirstOrThrow({ where: { operatorId, name } });
    await page.goto(`/en/me/charger-operator/${operatorId}/campaigns`);
    await page
      .getByTestId("campaign-list")
      .locator("li")
      .filter({ hasText: name })
      .getByTestId("start-campaign")
      .click();
    await expect
      .poll(async () => (await prisma.campaign.findUnique({ where: { id: campaign.id } }))?.status)
      .toBe("ACTIVE");
  }
});

test("the driver opens the QR link and the discount is theirs", async ({ page }) => {
  await signInWithPassword(page, DRIVER);

  await page.goto(`/en/promo/${CODE}`);
  await expect(page.getByTestId("promo-landing-done")).toContainText(
    "E2E Gift Constructor Network",
  );

  await page.goto("/en/me/gifts");
  await expect(page.getByTestId("gift-discount-badge")).toContainText("20 %");

  // The same code twice gives nothing, and says so.
  await page.goto(`/en/promo/${CODE}`);
  await expect(page.getByTestId("promo-landing-error")).toContainText("already used");
});

test("the discount takes its share of a real charge, and the partner pays it", async ({ page }) => {
  await signInWithPassword(page, DRIVER);

  const before = await prisma.wallet.findUniqueOrThrow({
    where: { ownerUserId_zoneId: { ownerUserId: ownerUserId, zoneId } },
  });

  const charge = await page.request.post("/api/v1/payments/charge", {
    headers: { "Idempotency-Key": "e2e-gift-constructor-charge" },
    data: { zoneId, requestedKwh: 40, pointId },
  });
  expect(charge.status()).toBe(201);
  const body = (await charge.json()) as {
    payment: { kwhFromGift: number; kwhFromBalance: number };
  };

  // 20 % of 40 kWh out of the partner's wallet; the driver pays for the rest.
  expect(body.payment.kwhFromGift).toBe(8);
  expect(body.payment.kwhFromBalance).toBe(32);

  const after = await prisma.wallet.findUniqueOrThrow({ where: { id: before.id } });
  expect(Number(before.kwhBalance) - Number(after.kwhBalance)).toBe(8);
});

test("the booking fee is waived before the driver confirms", async ({ page }) => {
  await signInWithPassword(page, DRIVER);

  // The charge above was the driver's first in this network, so the
  // free-booking campaign has issued its gift by now (US-41's minute).
  await expect
    .poll(
      async () =>
        await prisma.promoGrant.count({
          where: { userId: driverUserId, operatorId, kind: "FREE_BOOKING", status: "ACTIVE" },
        }),
      { timeout: 90_000 },
    )
    .toBe(1);

  await page.goto("/en/me/gifts");
  await expect(page.getByTestId("gift-booking-badge")).toBeVisible();

  // §54 — the fee line says "free" before anything is confirmed.
  await page.goto(`/en/c/${pointId}`);
  await expect(page.getByTestId("booking-fee-gift")).toBeVisible();
  await expect(page.getByTestId("booking-gift-note")).toContainText(
    "E2E Gift Constructor Network",
  );

  await page.getByRole("button", { name: "Book", exact: false }).click();
  await expect(page.getByTestId("booking-made")).toBeVisible();

  const reservation = await prisma.reservation.findFirstOrThrow({
    where: { userId: driverUserId, pointId },
  });
  expect(Number(reservation.feeFiat)).toBe(0);
  expect(reservation.promoGrantId).not.toBeNull();
  expect(connectorId).toBe(reservation.connectorId);
});
