// US-34 on the live build: the owner opens the month and sees the days, the
// no-shows, the fees and the penalties.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const OWNER = { username: "e2e_bkrep_owner", password: "Pass1234" };
const DRIVER = { username: "e2e_bkrep_driver", password: "Pass1234" };
const SLUG = "e2e-bkrep-network";
const ZONE = "E2EBKREP";

let operatorId: string;
let zoneId: string;
let pointId: string;
let connectorId: string;
let walletId: string;
let driverUserId: string;
let month: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.reservation.deleteMany({ where: { point: { operator: { slug: SLUG } } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.reservationPolicy.deleteMany({
    where: { point: { operator: { slug: SLUG } } },
  });
  await prisma.pricingRule.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
}

/** A day of this month, so the report's default month shows it. */
function dayThisMonth(day: number, hour = 10): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, hour));
}

test.beforeAll(async () => {
  await wipe();

  const now = new Date();
  month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

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

  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE, country: "SK", name: "E2E bookings zone", currency: "EUR" },
    })
  ).id;
  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "E2E Bookings Network",
        claimedById: owner.id,
        claimedAt: new Date(),
      },
    })
  ).id;

  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId,
      type: "CHARGING_STATION",
      name: "E2E Bookings Point",
      status: "PUBLISHED",
      gridZoneId: zoneId,
      connectors: {
        create: [{ type: "CCS2", powerKw: new Prisma.Decimal(50), quantity: 1 }],
      },
    },
    include: { connectors: true },
  });
  pointId = point.id;
  connectorId = point.connectors[0]!.id;

  walletId = (await prisma.wallet.create({ data: { ownerUserId: driverUserId, zoneId } })).id;

  const booking = async (args: {
    day: number;
    status: "FULFILLED" | "NO_SHOW" | "CANCELLED";
    feeFiat: number;
    penaltyFiat?: number;
    refundFiat?: number;
  }) => {
    const start = dayThisMonth(args.day);
    await prisma.reservation.create({
      data: {
        userId: driverUserId,
        pointId,
        connectorId,
        walletId,
        eta: start,
        windowStart: start,
        windowEnd: new Date(start.getTime() + 30 * 60_000),
        feeFiat: new Prisma.Decimal(args.feeFiat),
        guaranteeFiat: new Prisma.Decimal(5),
        noShowPenaltyFiat: new Prisma.Decimal(3),
        freeCancelMinutes: 30,
        status: args.status,
        penaltyFiat:
          args.penaltyFiat == null ? null : new Prisma.Decimal(args.penaltyFiat),
        refundFiat: args.refundFiat == null ? null : new Prisma.Decimal(args.refundFiat),
      },
    });
  };

  await booking({ day: 2, status: "FULFILLED", feeFiat: 2 });
  await booking({ day: 2, status: "FULFILLED", feeFiat: 2 });
  await booking({ day: 3, status: "NO_SHOW", feeFiat: 2, penaltyFiat: 3 });
  await booking({ day: 4, status: "CANCELLED", feeFiat: 2, refundFiat: 2 });
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { in: [OWNER.username, DRIVER.username] } } });
  await prisma.$disconnect();
});

test("the owner reads the month by days, with fees and penalties (US-34)", async ({ page }) => {
  await signInWithPassword(page, OWNER);
  await page.goto(`/en/me/charger-operator/${operatorId}/bookings-report?month=${month}`);

  const totals = page.getByTestId("bookings-totals");
  // 4 booked, 2 charged, 1 no-show — a quarter of them.
  await expect(totals).toContainText("4");
  await expect(totals).toContainText("25%");
  // Fees 8.00, penalties 3.00, refunded 2.00, kept 9.00.
  await expect(totals).toContainText("8.00 EUR");
  await expect(totals).toContainText("3.00 EUR");
  await expect(totals).toContainText("9.00 EUR");

  const byDay = page.getByTestId("bookings-by-day");
  await expect(byDay).toContainText(`${month}-02`);
  await expect(byDay).toContainText(`${month}-03`);
  await expect(byDay).toContainText(`${month}-04`);

  await expect(page.getByTestId("bookings-by-point")).toContainText("E2E Bookings Point");
});

test("a month with no bookings says so", async ({ page }) => {
  await signInWithPassword(page, OWNER);
  await page.goto(`/en/me/charger-operator/${operatorId}/bookings-report?month=2020-01`);

  await expect(page.getByTestId("bookings-empty")).toBeVisible();
  await expect(page.getByTestId("bookings-totals")).toContainText("—");
});

test("the report belongs to the network, not to a passer-by", async ({ page }) => {
  await signInWithPassword(page, DRIVER);
  const res = await page.goto(`/en/me/charger-operator/${operatorId}/bookings-report`);
  expect(res?.status()).toBe(404);
});
