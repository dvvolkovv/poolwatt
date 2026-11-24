// US-23 — "найти ближайший свободный пункт с моим разъёмом", on the live
// build. The three criteria: a filter by connector and availability, a result
// inside two seconds, and a route in one tap.

import { test, expect } from "@playwright/test";
import { PrismaClient, Prisma } from "@prisma/client";
import { createHash, createHmac, randomBytes } from "node:crypto";

const prisma = new PrismaClient();

const SLUG = "e2e-nav-network";
// Inside the map's default viewport, so the first fetch already covers the
// points. The names are unique, so neighbouring OpenStreetMap nodes do not
// disturb the assertions.
const LAT = 48.1612;
const LNG = 17.0944;

let operatorId: string;
let freePointId: string;
let busyPointId: string;
let keyToken: string;
let keySecret: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
}

async function seedPoint(args: {
  name: string;
  lat: number;
  lng: number;
  connector: string;
  status: string;
  powerKw: number;
}) {
  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId,
      type: "CHARGING_STATION",
      name: args.name,
      status: "PUBLISHED",
      publishedAt: new Date(),
      country: "SK",
      city: "Bratislava",
      addressLine: "Cesta 1",
      latitude: args.lat,
      longitude: args.lng,
      howToFind: "by the tram stop",
      energySource: "SOLAR",
      open24: true,
      paymentMethods: ["TOKEN"],
      connectors: {
        create: [
          {
            type: args.connector as never,
            powerKw: new Prisma.Decimal(args.powerKw),
            currentAc: false,
            quantity: 2,
            status: args.status as never,
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
  });
  return point.id;
}

test.beforeAll(async () => {
  await wipe();
  operatorId = (
    await prisma.chargerOperator.create({
      data: { slug: SLUG, displayName: "E2E Navigator Network" },
    })
  ).id;

  freePointId = await seedPoint({
    name: "E2E Free CCS",
    lat: LAT,
    lng: LNG,
    connector: "CCS2",
    status: "FREE",
    powerKw: 150,
  });
  busyPointId = await seedPoint({
    name: "E2E Busy CCS",
    lat: LAT + 0.004,
    lng: LNG,
    connector: "CCS2",
    status: "BUSY",
    powerKw: 150,
  });
  await seedPoint({
    name: "E2E Free Type2",
    lat: LAT + 0.008,
    lng: LNG,
    connector: "TYPE2",
    status: "FREE",
    powerKw: 22,
  });

  // A key for the point whose availability the test will flip.
  keyToken = `pwp_${randomBytes(32).toString("base64url")}`;
  keySecret = randomBytes(32).toString("base64url");
  await prisma.pointApiKey.create({
    data: {
      pointId: busyPointId,
      label: "e2e nav",
      tokenHash: createHash("sha256").update(keyToken).digest("hex"),
      prefix: keyToken.slice(0, 10),
      // No signing secret: this key is the pre-signature path, which the unit
      // tests cover for both shapes.
    },
  });
});

test.afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

test("the API answers the filtered search well inside two seconds", async ({ request }) => {
  const started = Date.now();
  const res = await request.get(
    `/api/chargers?south=${LAT - 0.05}&west=${LNG - 0.05}&north=${LAT + 0.05}&east=${LNG + 0.05}`,
  );
  const elapsed = Date.now() - started;

  expect(res.status()).toBe(200);
  expect(Number(res.headers()["x-points"])).toBeGreaterThanOrEqual(3);
  // US-23 — "результат за 2 секунды".
  expect(elapsed).toBeLessThan(2000);

  const stations = (await res.json()) as { title: string }[];
  expect(stations.map((s) => s.title)).toEqual(
    expect.arrayContaining(["E2E Free CCS", "E2E Busy CCS", "E2E Free Type2"]),
  );
});

test("filters by connector and availability, and keeps them in the address", async ({ page }) => {
  await page.goto(`/en/navigator?connector=CCS2&free=1`);

  // The filters arrived from the address, so the view is a link.
  await page.locator('button:has-text("Filters")').click();
  await expect(page.locator("#free-now")).toBeChecked();

  // Only the free CCS point survives both filters.
  await expect(page.locator("text=E2E Free CCS")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("text=E2E Busy CCS")).toHaveCount(0);
  await expect(page.locator("text=E2E Free Type2")).toHaveCount(0);
});

test("offers a route in one tap and a link to the full card", async ({ page }) => {
  await page.goto(`/en/navigator?connector=CCS2&free=1`);
  await page.locator("text=E2E Free CCS").first().click();

  // One tap: the button picks the device's own maps at click time.
  await expect(page.getByTestId("route-button")).toBeVisible();
  await expect(page.getByTestId("connector-availability").first()).toHaveText("free");

  const full = page.getByTestId("full-card-link");
  await expect(full).toHaveAttribute("href", `/en/c/${freePointId}`);
  await full.click();
  await page.waitForURL(`**/en/c/${freePointId}`);
  await expect(page.locator("h1")).toContainText("E2E Free CCS");
});

test("a point that reports itself busy drops out of the free filter", async ({ page, request }) => {
  // The equipment speaks: the second point frees up.
  const res = await request.post(`/api/v1/points/${busyPointId}/availability`, {
    headers: { authorization: `Bearer ${keyToken}`, "content-type": "application/json" },
    data: { connectors: [{ type: "CCS2", status: "FREE" }] },
  });
  expect(res.status()).toBe(202);

  await page.goto(`/en/navigator?connector=CCS2&free=1`);
  await expect(page.locator("text=E2E Busy CCS")).toBeVisible({ timeout: 20_000 });
});
