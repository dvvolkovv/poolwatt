// US-18 and US-26 — the station console of ТЗ §30 on the live build: the
// owner sees what the station is generating, the chart of the period, and the
// figure moves by itself when a reading lands.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";

const prisma = new PrismaClient();

const USER = { username: "e2e_station", password: "Pass1234" };
const ZONE_CODE = "E2ESTATION";
const REG_NUMBER = "E2E-STATION-0001";

let userId: string;
let zoneId: string;
let companyId: string;
let assetId: string;
let keyPlaintext: string;

test.describe.configure({ mode: "serial" });

// Through nginx: the console refreshes off the §15 telemetry channel.
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.assetAlert.deleteMany({ where: { asset: { gridZone: { code: ZONE_CODE } } } });
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.meterReading.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.assetApiKey.deleteMany({ where: { asset: { gridZone: { code: ZONE_CODE } } } });
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
      name: "E2E station zone",
      currency: "EUR",
      intervalMinutes: 60,
      corridorPct: new Prisma.Decimal(30),
      spotPrice: new Prisma.Decimal(0.2),
      spotPriceAt: new Date(),
    },
  });
  zoneId = zone.id;

  companyId = (
    await prisma.company.create({
      data: {
        legalName: "E2E Station Energy s.r.o.",
        country: "SK",
        regNumber: REG_NUMBER,
        type: "PRODUCER",
        kybStatus: "APPROVED",
        ownerUserId: userId,
      },
    })
  ).id;

  const asset = await prisma.asset.create({
    data: {
      companyId,
      gridZoneId: zoneId,
      kind: "SOLAR",
      name: "E2E Station Array",
      capacityKw: new Prisma.Decimal(20),
      status: "ACTIVE",
      activatedAt: new Date("2026-01-01T00:00:00.000Z"),
      telemetryCleanSince: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  assetId = asset.id;

  keyPlaintext = `pwt_${randomBytes(32).toString("base64url")}`;
  await prisma.assetApiKey.create({
    data: {
      assetId,
      label: "e2e station",
      tokenHash: createHash("sha256").update(keyPlaintext).digest("hex"),
      prefix: keyPlaintext.slice(0, 10),
    },
  });

  // One hour already on the books, so the chart has something to draw.
  const earlier = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - 2 * 3_600_000);
  await prisma.meterReading.create({
    data: {
      assetId,
      zoneId,
      intervalStart: earlier,
      intervalEnd: new Date(earlier.getTime() + 3_600_000),
      energyKwh: new Prisma.Decimal(6),
      source: "rest",
      validationStatus: "VALID",
      mintedAt: new Date(),
    },
  });
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: USER.username } });
  await prisma.$disconnect();
});

test("shows generation, the chart, and moves when a reading lands", async ({ page }) => {
  await signInWithPassword(page, USER);
  await page.goto(`/en/me/listing/${companyId}/assets/${assetId}`);

  await expect(page.getByTestId("station-today")).toHaveText("6.000");
  await expect(page.getByTestId("generation-chart")).toBeVisible();
  await expect(page.getByTestId("station-live-state")).toHaveText("Live");

  // The chart switches period without losing the page.
  await page.locator('a:has-text("Week")').click();
  await expect(page.getByTestId("generation-chart")).toBeVisible();
  await page.locator('a:has-text("Day")').click();

  // US-26 — a reading from the equipment moves the console, no reload.
  const intervalStart = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - 3_600_000);
  const posted = await page.request.post("/api/v1/telemetry/readings", {
    headers: {
      authorization: `Bearer ${keyPlaintext}`,
      "content-type": "application/json",
      "idempotency-key": `e2e-station-${Date.now()}`,
    },
    data: { readings: [{ intervalStart: intervalStart.toISOString(), energyKwh: 5.5 }] },
  });
  expect(posted.status()).toBe(202);

  await expect(page.getByTestId("station-today")).toHaveText("11.500", { timeout: 20_000 });
  await expect(page.getByTestId("station-now-kw")).toHaveText("5.500");
});

test("shows an alarm raised by the equipment, and clears it", async ({ page }) => {
  // A reading above the nameplate: the validator refuses it and US-29 says
  // the engineer must hear about it.
  const bad = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - 5 * 3_600_000);
  const posted = await page.request.post(
    `${process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com"}/api/v1/telemetry/readings`,
    {
      headers: {
        authorization: `Bearer ${keyPlaintext}`,
        "content-type": "application/json",
        "idempotency-key": `e2e-station-bad-${Date.now()}`,
      },
      data: { readings: [{ intervalStart: bad.toISOString(), energyKwh: 9999 }] },
    },
  );
  expect(posted.status()).toBe(202);

  const alert = await prisma.assetAlert.findFirstOrThrow({
    where: { assetId, resolvedAt: null },
  });
  expect(alert.kind).toBe("TELEMETRY_ANOMALY");

  await signInWithPassword(page, USER);
  await page.goto(`/en/me/listing/${companyId}/assets/${assetId}`);

  const panel = page.getByTestId("asset-alerts");
  await expect(panel).toContainText("Telemetry anomaly");

  await panel.getByLabel("What was done").fill("inverter firmware updated");
  await panel.locator('button:has-text("Clear")').click();
  await expect(panel).toContainText("No open alarms");

  const cleared = await prisma.assetAlert.findUniqueOrThrow({ where: { id: alert.id } });
  expect(cleared.resolvedAt).not.toBeNull();
  expect(cleared.resolutionNote).toBe("inverter firmware updated");
});

test("keeps the console away from someone else's company", async ({ page }) => {
  const other = { username: "e2e_station_other", password: "Pass1234" };
  await prisma.user.upsert({
    where: { username: other.username },
    update: { passwordHash: await bcrypt.hash(other.password, 10) },
    create: { username: other.username, passwordHash: await bcrypt.hash(other.password, 10) },
  });

  await signInWithPassword(page, other);
  const res = await page.goto(`/en/me/listing/${companyId}/assets/${assetId}`);
  expect(res?.status()).toBe(404);

  await prisma.user.deleteMany({ where: { username: other.username } });
});
