// US-03 / US-05 end to end: the producer connects an asset, issues a telemetry
// key, equipment posts a reading, and the cabinet shows it along with the token
// it minted.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHash, createHmac } from "node:crypto";

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
  // §15 — a signing secret is shown next to the key when the server can hold
  // one, and from then on the equipment must sign.
  const secret = await page.locator("code").nth(1).innerText();
  expect(secret).toMatch(/^pws_/);

  const asset = await prisma.asset.findFirstOrThrow({ where: { companyId } });
  // The asset must be ACTIVE for the reading to mint (§4); the probation window
  // is what US-04 guards, and it is already covered by the unit tests.
  await prisma.asset.update({
    where: { id: asset.id },
    data: { status: "ACTIVE", activatedAt: new Date() },
  });

  // Equipment posts one interval with its Bearer key.
  const intervalStart = new Date(Math.floor(Date.now() / 900_000) * 900_000 - 900_000);
  const batch = { readings: [{ intervalStart: intervalStart.toISOString(), energyKwh: 3.25 }] };

  const rawBody = JSON.stringify(batch);
  const PATH = "/api/v1/telemetry/readings";
  const signedHeaders = (idemKey: string, body = rawBody, at = Date.now()) => {
    const ts = Math.floor(at / 1000);
    const digest = createHash("sha256").update(body, "utf8").digest("hex");
    const canonical = `v1.${ts}.POST.${PATH}.${digest}`;
    return {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "idempotency-key": idemKey,
      "x-poolwatt-timestamp": String(ts),
      "x-poolwatt-signature": `v1=${createHmac("sha256", secret).update(canonical, "utf8").digest("hex")}`,
    };
  };

  // §15 — "Все POST-запросы с ключом идемпотентности": a properly signed
  // request without one is still refused. (Authentication comes first, so an
  // unsigned request fails on the signature before anyone looks at the key.)
  const { "idempotency-key": _omitted, ...headersWithoutKey } = signedHeaders("unused");
  const unkeyed = await page.request.post(PATH, {
    headers: headersWithoutKey,
    data: rawBody,
  });
  expect(unkeyed.status()).toBe(400);

  // §15 — equipment that holds a signing secret must sign.
  const unsigned = await page.request.post(PATH, {
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "idempotency-key": `e2e-unsigned-${Date.now()}`,
    },
    data: rawBody,
  });
  expect(unsigned.status()).toBe(401);

  // A signature over a body that was edited afterwards is refused too.
  const tamperedHeaders = signedHeaders(`e2e-tampered-${Date.now()}`);
  const tampered = await page.request.post(PATH, {
    headers: tamperedHeaders,
    data: rawBody.replace("3.25", "32.5"),
  });
  expect(tampered.status()).toBe(401);

  const idemKey = `e2e-${Date.now()}`;
  const response = await page.request.post(PATH, {
    headers: signedHeaders(idemKey),
    data: rawBody,
  });
  expect(response.status()).toBe(202);
  const body = await response.json();
  expect(body.outcome.mintedKwh).toBe(3.25);

  // The same key again replays the stored answer rather than minting twice.
  const replay = await page.request.post(PATH, {
    headers: signedHeaders(idemKey),
    data: rawBody,
  });
  expect(replay.status()).toBe(202);
  expect(replay.headers()["idempotency-replayed"]).toBe("true");
  expect((await replay.json()).outcome.mintedKwh).toBe(3.25);

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
