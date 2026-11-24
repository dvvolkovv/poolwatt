// US-17 — "видеть баланс кВт·ч и денег на главном экране", ТЗ §15 WebSocket
// channels. The page is loaded once and never reloaded: when the producer's
// equipment sends a reading and tokens are minted, the balance on the open
// page has to change by itself.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";

const prisma = new PrismaClient();

const USER = { username: "e2e_wallet_live", password: "Pass1234" };
const ZONE_CODE = "E2ELIVE";
const REG_NUMBER = "E2E-LIVE-0001";

let userId: string;
let zoneId: string;
let assetId: string;
let keyPlaintext: string;

test.describe.configure({ mode: "serial" });

// Through nginx, not straight at :3000: the WebSocket upgrade is served by a
// separate process behind the /ws location, so only the public host exercises
// the path a real browser takes.
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.meterReading.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.assetApiKey.deleteMany({ where: { asset: { gridZone: { code: ZONE_CODE } } } });
  await prisma.asset.deleteMany({ where: { gridZone: { code: ZONE_CODE } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE_CODE } });
  await prisma.company.deleteMany({ where: { regNumber: REG_NUMBER } });
}

test.beforeAll(async () => {
  await wipe();

  const hash = await bcrypt.hash(USER.password, 10);
  const user = await prisma.user.upsert({
    where: { username: USER.username },
    update: { passwordHash: hash },
    create: { username: USER.username, passwordHash: hash },
  });
  userId = user.id;

  const zone = await prisma.gridZone.create({
    data: {
      code: ZONE_CODE,
      country: "SK",
      name: "E2E live zone",
      currency: "EUR",
      intervalMinutes: 60,
      corridorPct: 30,
      spotPrice: 0.2,
    },
  });
  zoneId = zone.id;

  // A wallet with something in it, so the page shows balances rather than
  // "no wallet yet".
  await prisma.wallet.create({
    data: { ownerUserId: userId, zoneId, currency: "EUR", kwhBalance: 1, fiatBalance: 7.25 },
  });

  const company = await prisma.company.create({
    data: {
      legalName: "E2E Live Energy s.r.o.",
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
      name: "E2E Live Array",
      capacityKw: 20,
      status: "ACTIVE",
      activatedAt: new Date("2026-01-01T00:00:00.000Z"),
      telemetryCleanSince: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  assetId = asset.id;

  // A telemetry key without a signing secret: the pre-§15 path, still
  // supported, and the one this test does not need to exercise.
  keyPlaintext = `pwt_${randomBytes(32).toString("base64url")}`;
  await prisma.assetApiKey.create({
    data: {
      assetId,
      label: "e2e live",
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

test("wallet balance updates over the live channel, without a reload", async ({ page }) => {
  await signInWithPassword(page, USER);
  await page.goto("/en/me/wallet");

  const kwh = page.getByTestId(`wallet-kwh-${ZONE_CODE}`);
  await expect(kwh).toHaveText("1.000");

  // The socket has to be up before the event, or there is nobody to tell.
  await expect(page.getByTestId("wallet-live-state")).toHaveText("Live");

  // The producer's equipment sends one interval. Nothing touches this page.
  const intervalStart = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - 3_600_000);
  const posted = await page.request.post("/api/v1/telemetry/readings", {
    headers: {
      authorization: `Bearer ${keyPlaintext}`,
      "content-type": "application/json",
      "idempotency-key": `e2e-live-${Date.now()}`,
    },
    data: { readings: [{ intervalStart: intervalStart.toISOString(), energyKwh: 4.125 }] },
  });
  expect(posted.status()).toBe(202);
  expect((await posted.json()).outcome.mintedKwh).toBe(4.125);

  // 1 kWh was there, 4.125 kWh were minted — and the page was never reloaded.
  await expect(kwh).toHaveText("5.125");
});
