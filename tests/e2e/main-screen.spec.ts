// US-17 — "видеть баланс кВт·ч и денег на главном экране", ТЗ §22.2.
// The screen is loaded once and never reloaded: when energy is minted into
// the wallet, the big figure has to change by itself. The status badge of
// §20 is checked on the same screen.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";

const prisma = new PrismaClient();

const USER = { username: "e2e_main_screen", password: "Pass1234" };
const ZONE_CODE = "E2EMAIN";
const REG_NUMBER = "E2E-MAIN-0001";

let userId: string;
let zoneId: string;
let keyPlaintext: string;

test.describe.configure({ mode: "serial" });

// Through nginx: the WebSocket upgrade lives behind /ws on the public host.
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.meterReading.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.assetApiKey.deleteMany({ where: { asset: { gridZone: { code: ZONE_CODE } } } });
  await prisma.asset.deleteMany({ where: { gridZone: { code: ZONE_CODE } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.coopMember.deleteMany({ where: { user: { username: USER.username } } });
  await prisma.cooperative.deleteMany({ where: { zone: { code: ZONE_CODE } } });
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
      name: "E2E main screen zone",
      currency: "EUR",
      intervalMinutes: 60,
      corridorPct: new Prisma.Decimal(30),
      spotPrice: new Prisma.Decimal(0.2),
      spotPriceAt: new Date(),
    },
  });
  zoneId = zone.id;

  await prisma.wallet.create({
    data: {
      ownerUserId: userId,
      zoneId,
      currency: "EUR",
      kwhBalance: new Prisma.Decimal(2),
      fiatBalance: new Prisma.Decimal(12.5),
    },
  });

  // An asset of their own makes them a prosumer (§20) and gives the test
  // something to send a reading from.
  const company = await prisma.company.create({
    data: {
      legalName: "E2E Main Screen Energy s.r.o.",
      country: "SK",
      regNumber: REG_NUMBER,
      type: "PRODUCER",
      kybStatus: "APPROVED",
      ownerUserId: userId,
    },
  });
  const asset = await prisma.asset.create({
    data: {
      companyId: company.id,
      gridZoneId: zoneId,
      kind: "SOLAR",
      name: "E2E Main Screen Array",
      capacityKw: new Prisma.Decimal(20),
      status: "ACTIVE",
      activatedAt: new Date("2026-01-01T00:00:00.000Z"),
      telemetryCleanSince: new Date("2026-01-01T00:00:00.000Z"),
    },
  });

  keyPlaintext = `pwt_${randomBytes(32).toString("base64url")}`;
  await prisma.assetApiKey.create({
    data: {
      assetId: asset.id,
      label: "e2e main screen",
      tokenHash: createHash("sha256").update(keyPlaintext).digest("hex"),
      prefix: keyPlaintext.slice(0, 10),
    },
  });
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: USER.username } });
  await prisma.$disconnect();
});

test("shows the balance, the status badge and the zone price, and keeps the balance current", async ({
  page,
}) => {
  await signInWithPassword(page, USER);
  await page.goto("/en/me");

  // §22.2 — kWh large, money under it, status badge, zone price.
  await expect(page.getByTestId(`home-kwh-${ZONE_CODE}`)).toHaveText("2.000");
  await expect(page.getByTestId(`home-fiat-${ZONE_CODE}`)).toHaveText("12.50 EUR");
  await expect(page.getByTestId("status-badge")).toHaveText("Prosumer");
  await expect(page.locator("text=0.2000 EUR").first()).toBeVisible();

  // The four quick actions, two of them waiting on the outside world.
  await expect(page.locator("text=Buy")).toBeVisible();
  await expect(page.locator("text=awaiting a bank")).toBeVisible();

  // US-17 — the socket has to be up before the event, or nobody is listening.
  await expect(page.getByTestId("home-live-state")).toHaveText("Live");

  const intervalStart = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - 3_600_000);
  const posted = await page.request.post("/api/v1/telemetry/readings", {
    headers: {
      authorization: `Bearer ${keyPlaintext}`,
      "content-type": "application/json",
      "idempotency-key": `e2e-main-${Date.now()}`,
    },
    data: { readings: [{ intervalStart: intervalStart.toISOString(), energyKwh: 3.5 }] },
  });
  expect(posted.status()).toBe(202);

  // 2 kWh were there, 3.5 were minted — and the page was never reloaded.
  await expect(page.getByTestId(`home-kwh-${ZONE_CODE}`)).toHaveText("5.500");
});
