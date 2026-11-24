// US-52, US-53 and US-54 on the live build: a driver reports a broken cable
// from the station card, is immediately offered somewhere else to charge, and
// an engineer finds the work order waiting.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const OWNER = { username: "e2e_report_owner", password: "Pass1234" };
const SLUG = "e2e-report-network";
const LAT = 48.1711;
const LNG = 17.0855;

let operatorId: string;
let brokenPointId: string;
let nearbyPointId: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.ticket.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.workOrder.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
}

async function seedPoint(name: string, lat: number, status: string) {
  return prisma.acceptancePoint.create({
    data: {
      operatorId,
      type: "CHARGING_STATION",
      name,
      status: "PUBLISHED",
      publishedAt: new Date(),
      country: "SK",
      city: "Bratislava",
      addressLine: "Hlavná 3",
      latitude: lat,
      longitude: LNG,
      howToFind: "level -1, by the lift",
      energySource: "SOLAR",
      open24: true,
      paymentMethods: ["TOKEN"],
      connectors: {
        create: [
          {
            type: "CCS2",
            powerKw: new Prisma.Decimal(150),
            currentAc: false,
            quantity: 1,
            status: status as never,
            statusAt: new Date(),
          },
        ],
      },
      tariffs: {
        create: [{ fromMinute: 0, toMinute: 1440, priceFiat: new Prisma.Decimal(0.42), currency: "EUR" }],
      },
    },
  });
}

test.beforeAll(async () => {
  await wipe();
  const hash = await bcrypt.hash(OWNER.password, 10);
  const owner = await prisma.user.upsert({
    where: { username: OWNER.username },
    update: { passwordHash: hash },
    create: { username: OWNER.username, passwordHash: hash },
  });

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "E2E Report Network",
        claimedById: owner.id,
        claimedAt: new Date(),
      },
    })
  ).id;

  brokenPointId = (await seedPoint("E2E Broken Point", LAT, "FREE")).id;
  nearbyPointId = (await seedPoint("E2E Nearby Point", LAT + 0.003, "FREE")).id;
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: OWNER.username } });
  await prisma.$disconnect();
});

test("a driver reports a broken cable in one tap and is sent somewhere else", async ({
  page,
}) => {
  await page.goto(`/en/c/${brokenPointId}`);

  // §51 — the button is on the card the driver is already looking at.
  await page.getByTestId("report-problem").click();
  await expect(page.locator("h1")).toContainText("Report a problem");
  // The station is already filled in; nothing is asked for it.
  await expect(page.locator("text=E2E Broken Point").first()).toBeVisible();

  // One tap: the type is the button.
  await page.getByTestId("report-DAMAGED_CABLE").click();

  await expect(page.getByTestId("report-sent")).toBeVisible();
  // US-54 — a technical fault opened a work order.
  await expect(page.getByTestId("report-sent")).toContainText("work order");
  // US-53 — somewhere else to charge, right away.
  await expect(page.getByTestId("report-alternatives")).toContainText("E2E Nearby Point");

  const ticket = await prisma.ticket.findFirstOrThrow({
    where: { pointId: brokenPointId },
    include: { workOrder: true },
  });
  expect(ticket.problemType).toBe("DAMAGED_CABLE");
  expect(ticket.workOrder).not.toBeNull();
  expect(ticket.workOrder!.partsNeeded).toContain("charging cable");

  // §51 — the connector is out of service, so the map stops promising it.
  const connector = await prisma.pointConnector.findFirstOrThrow({
    where: { pointId: brokenPointId },
  });
  expect(connector.status).toBe("OUT_OF_SERVICE");
});

test("the network sees the ticket and the work order behind it", async ({ page }) => {
  await signInWithPassword(page, OWNER);

  await page.goto(`/en/me/charger-operator/${operatorId}/tickets`);
  await expect(page.getByTestId("ticket-queue")).toContainText("Cable or connector damaged");

  await page.goto("/en/me/work-orders");
  await expect(page.getByTestId("work-order-list")).toContainText("E2E Broken Point");

  await page.locator('a:has-text("DAMAGED_CABLE")').first().click();
  await expect(page.getByTestId("work-order-parts")).toContainText("charging cable");
  await expect(page.getByTestId("work-order")).toContainText("level -1, by the lift");
});

test("the broken point drops out of the free-now filter", async ({ page }) => {
  await page.goto(`/en/navigator?connector=CCS2&free=1`);

  await expect(page.locator("text=E2E Nearby Point")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("text=E2E Broken Point")).toHaveCount(0);
});
