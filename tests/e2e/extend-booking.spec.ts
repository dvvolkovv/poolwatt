// US-31 on the live build: a late driver pushes the booking window back from
// the bookings page, and the owner's terms decide whether they may.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const OWNER = { username: "e2e_ext_owner", password: "Pass1234" };
const DRIVER = { username: "e2e_ext_driver", password: "Pass1234" };
const SLUG = "e2e-ext-network";
const ZONE = "E2EEXT";
const COOP = "e2e-ext-coop";

let operatorId: string;
let zoneId: string;
let pointId: string;
let connectorId: string;
let driverUserId: string;
let walletId: string;
let ownerUserId: string;
let reservationId: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.reservation.deleteMany({ where: { point: { operator: { slug: SLUG } } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.coopMember.deleteMany({ where: { coop: { name: COOP } } });
  await prisma.cooperative.deleteMany({ where: { name: COOP } });
  await prisma.company.deleteMany({ where: { regNumber: `${COOP}-reg` } });
  await prisma.reservationPolicy.deleteMany({
    where: { point: { operator: { slug: SLUG } } },
  });
  await prisma.pricingRule.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
}

/** A live booking whose window closes in five minutes. */
async function liveBooking() {
  const end = new Date(Date.now() + 5 * 60_000);
  await prisma.pointConnector.update({
    where: { id: connectorId },
    data: { status: "BOOKED" },
  });
  return prisma.reservation.create({
    data: {
      userId: driverUserId,
      pointId,
      connectorId,
      walletId,
      eta: new Date(end.getTime() - 15 * 60_000),
      windowStart: new Date(end.getTime() - 15 * 60_000),
      windowEnd: end,
      feeFiat: new Prisma.Decimal(2),
      guaranteeFiat: new Prisma.Decimal(5),
      noShowPenaltyFiat: new Prisma.Decimal(3),
      freeCancelMinutes: 30,
      currency: "EUR",
      status: "ACTIVE",
    },
  });
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
      data: { code: ZONE, country: "SK", name: "E2E extend zone", currency: "EUR" },
    })
  ).id;
  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "E2E Extend Network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;

  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId,
      type: "CHARGING_STATION",
      name: "E2E Extend Point",
      status: "PUBLISHED",
      gridZoneId: zoneId,
      connectors: {
        create: [{ type: "CCS2", powerKw: new Prisma.Decimal(50), quantity: 1 }],
      },
      policy: {
        create: {
          enabled: true,
          waitMinutes: 15,
          extendAllowed: true,
          extendFeeFiat: new Prisma.Decimal(1),
          feeFiat: new Prisma.Decimal(2),
          guaranteeFiat: new Prisma.Decimal(5),
        },
      },
    },
    include: { connectors: true },
  });
  pointId = point.id;
  connectorId = point.connectors[0]!.id;

  walletId = (
    await prisma.wallet.create({
      data: { ownerUserId: driverUserId, zoneId, fiatBalance: new Prisma.Decimal(50) },
    })
  ).id;

  // §34 wants a KYC-verified driver, which is cooperative membership here.
  const company = await prisma.company.create({
    data: {
      legalName: "E2E extend coop",
      country: "SK",
      regNumber: `${COOP}-reg`,
      type: "COOPERATIVE",
      kybStatus: "APPROVED",
    },
  });
  const coop = await prisma.cooperative.create({
    data: { companyId: company.id, zoneId, name: COOP },
  });
  await prisma.coopMember.create({
    data: {
      coopId: coop.id,
      userId: driverUserId,
      shares: 1,
      status: "ACTIVE",
      kycVerifiedAt: new Date(),
    },
  });

  reservationId = (await liveBooking()).id;
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { in: [OWNER.username, DRIVER.username] } } });
  await prisma.$disconnect();
});

test("the driver extends the booking from the bookings page (US-31)", async ({ page }) => {
  await signInWithPassword(page, DRIVER);
  await page.goto("/en/me/bookings");

  await expect(page.getByTestId("booking-list")).toContainText("E2E Extend Point");
  await expect(page.getByTestId("extend-booking")).toBeVisible();

  const before = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
  await page.getByTestId("extend-booking").click();

  await expect
    .poll(async () => {
      const after = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
      return after.extendCount;
    })
    .toBe(1);

  const after = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
  expect(
    Math.round((after.windowEnd.getTime() - before.windowEnd.getTime()) / 60_000),
  ).toBe(15);

  // The owner's extension fee came off the balance, and the connector is
  // still held — which is the whole point of extending.
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
  expect(Number(wallet.fiatBalance)).toBe(49);
  const connector = await prisma.pointConnector.findUniqueOrThrow({ where: { id: connectorId } });
  expect(connector.status).toBe("BOOKED");
});

test("the button is gone when the owner does not allow extending", async ({ page }) => {
  await prisma.reservationPolicy.update({
    where: { pointId },
    data: { extendAllowed: false },
  });

  await signInWithPassword(page, DRIVER);
  await page.goto("/en/me/bookings");

  await expect(page.getByTestId("booking-list")).toContainText("E2E Extend Point");
  await expect(page.getByTestId("extend-booking")).toHaveCount(0);

  await prisma.reservationPolicy.update({
    where: { pointId },
    data: { extendAllowed: true },
  });
});

test("a booking cannot be pushed back for ever", async ({ page }) => {
  // One extension has already happened; the second is the last one allowed.
  await prisma.reservation.update({
    where: { id: reservationId },
    data: { extendCount: 2, windowEnd: new Date(Date.now() + 5 * 60_000) },
  });

  await signInWithPassword(page, DRIVER);
  await page.goto("/en/me/bookings");

  // The page does not even offer it once the limit is reached.
  await expect(page.getByTestId("extend-booking")).toHaveCount(0);
});
