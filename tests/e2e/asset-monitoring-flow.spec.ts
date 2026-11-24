// US-03 / US-05 end to end: the producer connects an asset, issues a telemetry
// key, equipment posts a reading, and the cabinet shows it along with the token
// it minted.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const PRODUCER = { username: "e2e_asset_producer", password: "Pass1234" };
const REG_NUMBER = "E2E-ASSET-0001";
const ASSET_NAME = "E2E Roof Array";

let companyId: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const hash = await bcrypt.hash(PRODUCER.password, 10);
  const user = await prisma.user.upsert({
    where: { username: PRODUCER.username },
    update: { passwordHash: hash },
    create: { username: PRODUCER.username, passwordHash: hash },
  });
  await prisma.company.deleteMany({ where: { regNumber: REG_NUMBER } });
  // Already listed: US-03 starts where US-02 ended.
  companyId = (
    await prisma.company.create({
      data: {
        legalName: "E2E Asset Energy s.r.o.",
        country: "SK",
        regNumber: REG_NUMBER,
        type: "PRODUCER",
        kybStatus: "APPROVED",
        ownerUserId: user.id,
      },
    })
  ).id;
});

test.afterAll(async () => {
  const assets = await prisma.asset.findMany({ where: { companyId }, select: { id: true } });
  const assetIds = assets.map((a) => a.id);
  await prisma.energyToken.deleteMany({ where: { assetId: { in: assetIds } } });
  await prisma.meterReading.deleteMany({ where: { assetId: { in: assetIds } } });
  await prisma.wallet.deleteMany({ where: { owner: { username: PRODUCER.username } } });
  await prisma.company.deleteMany({ where: { regNumber: REG_NUMBER } });
  await prisma.user.deleteMany({ where: { username: PRODUCER.username } });
  await prisma.$disconnect();
});

test("asset is connected, a reading arrives and shows up with its token", async ({ page }) => {
  await signInWithPassword(page, PRODUCER);

  await page.goto(`/en/me/listing/${companyId}/assets`);
  await page.click('button:has-text("Add an asset")');
  await page.fill('input[name="name"]', ASSET_NAME);
  await page.fill('input[name="capacityKw"]', "20");
  // The option label is "<code> — <name>"; pick the Slovak zone by its code.
  const zone = await prisma.gridZone.findFirstOrThrow({ where: { code: "SK" } });
  await page.selectOption('select[name="gridZoneId"]', zone.id);
  await page.click('button[type="submit"]');

  await expect(page.getByRole("heading", { level: 2, name: new RegExp(ASSET_NAME) })).toBeVisible();
  // §4 — an approved company's new asset starts its telemetry probation.
  await expect(page.locator("text=test connection")).toBeVisible();
  await expect(page.locator("text=No readings yet")).toBeVisible();

  // US-03 — "Выдача API-ключа объекта", shown exactly once.
  await page.click('button:has-text("Issue a key")');
  const key = await page.locator("code").first().innerText();
  expect(key).toMatch(/^pwt_/);

  const asset = await prisma.asset.findFirstOrThrow({ where: { companyId } });
  // The asset must be ACTIVE for the reading to mint (§4); the probation window
  // is what US-04 guards, and it is already covered by the unit tests.
  await prisma.asset.update({
    where: { id: asset.id },
    data: { status: "ACTIVE", activatedAt: new Date() },
  });

  // Equipment posts one interval with its Bearer key.
  const intervalStart = new Date(Math.floor(Date.now() / 900_000) * 900_000 - 900_000);
  const response = await page.request.post("/api/v1/telemetry/readings", {
    headers: { authorization: `Bearer ${key}` },
    data: { readings: [{ intervalStart: intervalStart.toISOString(), energyKwh: 3.25 }] },
  });
  expect(response.status()).toBe(202);
  const body = await response.json();
  expect(body.outcome.mintedKwh).toBe(3.25);

  // US-03 — "первые показания видны в кабинете".
  await page.reload();
  await expect(page.locator("text=3.250").first()).toBeVisible();
  await expect(page.locator("text=valid").first()).toBeVisible();

  // US-05 — the dashboard and its CSV export.
  await page.goto(`/en/me/listing/${companyId}/tokens`);
  await expect(page.getByRole("heading", { level: 1, name: "Tokens" })).toBeVisible();
  const minted = page.locator("dt:has-text('Minted') + dd");
  await expect(minted).toHaveText("3.250");
  await expect(page.locator("text=available").first()).toBeVisible();

  const csv = await page.request.get(
    `/api/v1/assets/${asset.id}/tokens?format=csv&from=${new Date(Date.now() - 7 * 864e5).toISOString()}&to=${new Date().toISOString()}`,
  );
  expect(csv.status()).toBe(200);
  const text = await csv.text();
  expect(text.split("\n")[0]).toBe("batch_id,interval_start,amount_kwh,status,go_certificate_ref");
  expect(text).toContain("3.25");
});
