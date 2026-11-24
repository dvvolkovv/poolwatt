// US-30, US-32 and US-55 on the live build: the owner sets the booking terms
// on their point, a driver holds a connector from the station card, the
// navigator stops offering it as free, and cancelling in good time gives the
// fee back.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const OWNER = { username: "e2e_book_owner", password: "Pass1234" };
const DRIVER = { username: "e2e_book_driver", password: "Pass1234" };
const SLUG = "e2e-book-network";
const ZONE = "E2EBOOK";
// Inside the map's default viewport, with a name of its own so neighbouring
// OpenStreetMap nodes cannot be mistaken for it.
const LAT = 48.1623;
const LNG = 17.0981;

let operatorId: string;
let pointId: string;
let driverUserId: string;
let walletId: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.receipt.deleteMany({
    where: { reservation: { point: { operator: { slug: SLUG } } } },
  });
  await prisma.reservation.deleteMany({ where: { point: { operator: { slug: SLUG } } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.coopMember.deleteMany({ where: { coop: { name: `${SLUG}-coop` } } });
  await prisma.cooperative.deleteMany({ where: { name: `${SLUG}-coop` } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.company.deleteMany({ where: { regNumber: `${SLUG}-reg` } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
}

test.beforeAll(async () => {
  await wipe();

  const hash = await bcrypt.hash(OWNER.password, 10);
  const owner = await prisma.user.upsert({
    where: { username: OWNER.username },
    update: { passwordHash: hash },
    create: { username: OWNER.username, passwordHash: hash },
  });
  driverUserId = (
    await prisma.user.upsert({
      where: { username: DRIVER.username },
      update: { passwordHash: hash },
      create: { username: DRIVER.username, passwordHash: hash },
    })
  ).id;

  const zone = await prisma.gridZone.create({
    data: { code: ZONE, country: "SK", name: "E2E booking zone", currency: "EUR" },
  });

  // §34 — booking needs KYC, and KYC lives on cooperative membership.
  const company = await prisma.company.create({
    data: {
      legalName: "E2E booking coop",
      country: "SK",
      regNumber: `${SLUG}-reg`,
      type: "COOPERATIVE",
      kybStatus: "APPROVED",
      ownerUserId: owner.id,
    },
  });
  const coop = await prisma.cooperative.create({
    data: { name: `${SLUG}-coop`, zoneId: zone.id, companyId: company.id },
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

  // Money to pay the fee and cover the guarantee with.
  walletId = (
    await prisma.wallet.create({
      data: {
        ownerUserId: driverUserId,
        zoneId: zone.id,
        fiatBalance: new Prisma.Decimal(40),
        reservedFiat: new Prisma.Decimal(0),
      },
    })
  ).id;

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "E2E Booking Network",
        claimedById: owner.id,
        claimedAt: new Date(),
      },
    })
  ).id;

  pointId = (
    await prisma.acceptancePoint.create({
      data: {
        operatorId,
        type: "CHARGING_STATION",
        name: "E2E Booking Point",
        status: "PUBLISHED",
        publishedAt: new Date(),
        country: "SK",
        city: "Bratislava",
        addressLine: "Cesta 7",
        latitude: LAT,
        longitude: LNG,
        howToFind: "by the kiosk",
        energySource: "SOLAR",
        open24: true,
        paymentMethods: ["TOKEN"],
        gridZoneId: zone.id,
        connectors: {
          create: [
            {
              type: "CCS2",
              powerKw: new Prisma.Decimal(150),
              currentAc: false,
              quantity: 1,
              status: "FREE",
              statusAt: new Date(),
            },
          ],
        },
        tariffs: {
          create: [
            {
              fromMinute: 0,
              toMinute: 1440,
              priceFiat: new Prisma.Decimal(0.41),
              currency: "EUR",
              priceTokens: new Prisma.Decimal(1),
            },
          ],
        },
      },
    })
  ).id;
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({
    where: { username: { in: [OWNER.username, DRIVER.username] } },
  });
  await prisma.$disconnect();
});

test("the owner opens the point to bookings and names the terms (US-32)", async ({ page }) => {
  await signInWithPassword(page, OWNER);

  await page.goto(`/en/me/charger-operator/${operatorId}/points/${pointId}`);
  const form = page.getByTestId("policy-form");
  await expect(form).toBeVisible();

  await form.locator('input[type="checkbox"]').first().check();
  const num = (label: string) => form.getByRole("textbox", { name: label });
  await num("Fee").fill("0.5");
  await num("Guarantee").fill("5");
  await num("No-show penalty").fill("3");
  await num("Waiting, min").fill("15");
  await num("Free cancel, min").fill("30");
  await num("Keep free for walk-ups").fill("0");
  await page.getByTestId("policy-save").click();

  await expect(form).toContainText("Saved");

  const policy = await prisma.reservationPolicy.findUniqueOrThrow({ where: { pointId } });
  expect(policy.enabled).toBe(true);
  expect(Number(policy.feeFiat)).toBe(0.5);
  expect(Number(policy.guaranteeFiat)).toBe(5);
  expect(policy.waitMinutes).toBe(15);
});

test("a driver books a connector from the station card (US-30)", async ({ page }) => {
  await signInWithPassword(page, DRIVER);

  await page.goto(`/en/c/${pointId}`);
  await expect(page.getByTestId("book-form")).toBeVisible();
  // The terms the driver agrees to are on the screen, not in a document.
  await expect(page.getByTestId("book-form")).toContainText("0.50 EUR");

  // Two hours out, comfortably past the owner's 30-minute free-cancel
  // threshold, so the cancellation below is the "in good time" case.
  await page.getByTestId("book-form").getByRole("button", { name: "+120 min" }).click();

  const started = Date.now();
  await page.getByTestId("book-submit").click();
  await expect(page.getByTestId("booking-made")).toBeVisible();
  // US-30 — "бронь подтверждается за 3 секунды".
  expect(Date.now() - started).toBeLessThan(3000);

  const reservation = await prisma.reservation.findFirstOrThrow({
    where: { userId: driverUserId, pointId },
  });
  expect(reservation.status).toBe("ACTIVE");
  expect(Number(reservation.feeFiat)).toBe(0.5);

  // The fee is charged and the guarantee is held.
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
  expect(Number(wallet.fiatBalance)).toBe(39.5);
  expect(Number(wallet.reservedFiat)).toBe(5);

  const connector = await prisma.pointConnector.findFirstOrThrow({ where: { pointId } });
  expect(connector.status).toBe("BOOKED");
});

test("the navigator marks the booked connector and drops it from 'free now'", async ({
  page,
}) => {
  await page.goto("/en/navigator?connector=CCS2&free=1");
  await expect(page.locator("text=E2E Booking Point")).toHaveCount(0, { timeout: 20_000 });

  // Without the filter the point is there, and it says what happened to it.
  await page.goto("/en/navigator?connector=CCS2");
  await expect(page.locator("text=E2E Booking Point").first()).toBeVisible({ timeout: 20_000 });
  await page.locator("text=E2E Booking Point").first().click();
  await expect(page.getByTestId("connector-availability").first()).toHaveText("booked");
});

test("cancelling in good time gives the fee back (§32.7)", async ({ page }) => {
  await signInWithPassword(page, DRIVER);

  await page.goto("/en/me/bookings");
  await expect(page.getByTestId("booking-list")).toContainText("E2E Booking Point");
  await page.getByTestId("cancel-booking").click();

  await expect(page.getByTestId("booking-list")).toContainText("Cancelled");

  const reservation = await prisma.reservation.findFirstOrThrow({
    where: { userId: driverUserId, pointId },
  });
  expect(reservation.status).toBe("CANCELLED");
  expect(Number(reservation.refundFiat)).toBe(0.5);

  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
  expect(Number(wallet.fiatBalance)).toBe(40);
  expect(Number(wallet.reservedFiat)).toBe(0);

  // The place is free again, so the navigator may promise it.
  const connector = await prisma.pointConnector.findFirstOrThrow({ where: { pointId } });
  expect(connector.status).toBe("FREE");
});
