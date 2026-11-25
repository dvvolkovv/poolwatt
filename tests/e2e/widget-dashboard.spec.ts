// US-27 on the live build: the producer adds a widget, removes another,
// changes the order, saves the layout under a name, and finds their own panel
// after a reload (§30 "настраиваемая панель виджетов").

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const USER = { username: "e2e_panel", password: "Pass1234" };
const ZONE_CODE = "E2EPANEL";
const REG_NUMBER = "E2E-PANEL-0001";

let userId: string;
let companyId: string;
let assetId: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.dashboard.deleteMany({ where: { user: { username: USER.username } } });
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.meterReading.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.asset.deleteMany({ where: { gridZone: { code: ZONE_CODE } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.company.deleteMany({ where: { regNumber: REG_NUMBER } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE_CODE } });
}

test.beforeAll(async () => {
  await wipe();

  const hash = await bcrypt.hash(USER.password, 10);
  userId = (
    await prisma.user.upsert({
      where: { username: USER.username },
      update: { passwordHash: hash },
      create: { username: USER.username, passwordHash: hash },
    })
  ).id;

  const zone = await prisma.gridZone.create({
    data: {
      code: ZONE_CODE,
      country: "SK",
      name: "E2E panel zone",
      currency: "EUR",
      spotPrice: new Prisma.Decimal(0.18),
      spotPriceAt: new Date(),
    },
  });

  companyId = (
    await prisma.company.create({
      data: {
        legalName: "E2E Panel Energy s.r.o.",
        country: "SK",
        regNumber: REG_NUMBER,
        type: "PRODUCER",
        kybStatus: "APPROVED",
        ownerUserId: userId,
      },
    })
  ).id;

  assetId = (
    await prisma.asset.create({
      data: {
        companyId,
        gridZoneId: zone.id,
        kind: "SOLAR",
        name: "E2E Panel Array",
        capacityKw: new Prisma.Decimal(10),
        status: "ACTIVE",
      },
    })
  ).id;
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: USER.username } });
  await prisma.$disconnect();
});

test("the built-in panel is what a producer who set nothing up sees", async ({ page }) => {
  await signInWithPassword(page, USER);
  await page.goto(`/en/me/listing/${companyId}/assets/${assetId}`);

  // Everything is on screen, and there are no layout tabs yet.
  await expect(page.getByTestId("widget-grid")).toBeVisible();
  await expect(page.getByTestId("station-now-kw")).toBeVisible();
  await expect(page.getByTestId("layout-tabs")).toHaveCount(0);
  await expect(page.getByTestId("dashboard-editor")).toBeVisible();
});

test("adds, removes, reorders and saves a layout", async ({ page }) => {
  await signInWithPassword(page, USER);
  await page.goto(`/en/me/listing/${companyId}/assets/${assetId}`);

  // Remove four widgets the producer does not want to see.
  for (const key of ["minted", "sold", "unsold", "stored"]) {
    await page.getByTestId(`layout-remove-${key}`).click();
  }
  // Add one the built-in panel does not carry.
  await page.getByTestId("layout-add-zonePrice").click();
  await expect(page.getByTestId("layout-widget-zonePrice")).toBeVisible();

  // Move it to the top: three clicks up over revenue, avgPrice, chart… the
  // widget list is the order of the panel, so position 1 is the first cell.
  const widgets = page.getByTestId("layout-widgets").locator("li");
  const countBefore = await widgets.count();
  for (let i = 0; i < countBefore - 1; i += 1) {
    await page.getByTestId("layout-up-zonePrice").click();
  }
  await expect(widgets.first()).toContainText("Zone price");

  await page.getByTestId("layout-name").fill("Finances");
  await page.getByTestId("layout-save").click();
  await expect(page.getByTestId("layout-saved")).toBeVisible();

  const saved = await prisma.dashboard.findFirstOrThrow({ where: { userId, name: "Finances" } });
  expect(saved.isDefault).toBe(true);
  const widgetKeys = (saved.widgets as { key: string }[]).map((w) => w.key);
  expect(widgetKeys[0]).toBe("zonePrice");
  expect(widgetKeys).not.toContain("minted");

  // And it survives a reload: the panel is the producer's own now.
  await page.reload();
  await expect(page.getByTestId("layout-tabs")).toContainText("Finances");
  await expect(page.getByTestId("widget-grid").locator("> div").first()).toContainText(
    "Zone price",
  );
  await expect(page.getByTestId("station-zone-price")).toBeVisible();
});

test("keeps several layouts and switches between them", async ({ page }) => {
  await signInWithPassword(page, USER);
  await page.goto(`/en/me/listing/${companyId}/assets/${assetId}`);

  // A second, much shorter panel.
  for (const key of ["today", "week", "month", "year", "efficiency", "revenue", "avgPrice", "routed", "generationChart", "alerts", "equipment"]) {
    const button = page.getByTestId(`layout-remove-${key}`);
    if (await button.count()) await button.click();
  }
  await page.getByTestId("layout-name").fill("Morning");
  await page.getByTestId("layout-save").click();
  await expect(page.getByTestId("layout-saved")).toBeVisible();

  await page.reload();
  const tabs = page.getByTestId("layout-tabs");
  await expect(tabs).toContainText("Finances");
  await expect(tabs).toContainText("Morning");

  // The default is the one just saved; switching goes by the address.
  await tabs.getByText("Finances").click();
  await expect(page.getByTestId("station-zone-price")).toBeVisible();
  await expect(page.getByTestId("station-revenue")).toBeVisible();

  await tabs.getByText("Morning").click();
  await expect(page.getByTestId("station-revenue")).toHaveCount(0);
});

test("refuses a layout with nothing on it", async ({ page }) => {
  await signInWithPassword(page, USER);
  await page.goto(`/en/me/listing/${companyId}/assets/${assetId}?layout=Morning`);

  const widgets = page.getByTestId("layout-widgets").locator("li");
  const count = await widgets.count();
  for (let i = 0; i < count; i += 1) {
    await widgets.first().getByRole("button", { name: /^Remove/ }).click();
  }
  await expect(page.getByTestId("layout-save")).toBeDisabled();
});
