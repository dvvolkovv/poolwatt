// ТЗ §6, §16.5 — the operator's view of the spot reference: which zones take
// their price from the external feed, what the reference is now, and the
// history behind it.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const OPERATOR = { username: "e2e_zones_operator", password: "Pass1234" };
const ZONE_CODE = "E2EZONE";

let zoneId: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const hash = await bcrypt.hash(OPERATOR.password, 10);
  await prisma.user.upsert({
    where: { username: OPERATOR.username },
    update: { passwordHash: hash, role: "ADMIN" },
    create: { username: OPERATOR.username, passwordHash: hash, role: "ADMIN" },
  });

  await prisma.zoneSpotPrice.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE_CODE } });
  const zone = await prisma.gridZone.create({
    data: {
      code: ZONE_CODE,
      country: "SK",
      name: "E2E spot zone",
      currency: "EUR",
      intervalMinutes: 60,
      corridorPct: 25,
      spotSource: "entsoe",
      spotAreaCode: "10YSK-SEPS---K",
      spotPrice: 0.0881,
      spotPriceAt: new Date("2026-11-24T11:00:00.000Z"),
    },
  });
  zoneId = zone.id;
  await prisma.zoneSpotPrice.create({
    data: {
      zoneId,
      intervalStart: new Date("2026-11-24T11:00:00.000Z"),
      price: 0.0881,
      currency: "EUR",
      source: "entsoe",
    },
  });
});

test.afterAll(async () => {
  await prisma.zoneSpotPrice.deleteMany({ where: { zoneId } });
  await prisma.gridZone.deleteMany({ where: { id: zoneId } });
  await prisma.user.deleteMany({ where: { username: OPERATOR.username } });
  await prisma.$disconnect();
});

test("operator sees each zone's price source, reference and history", async ({ page }) => {
  await signInWithPassword(page, OPERATOR);

  await page.goto(`/en/admin/zones?zone=${ZONE_CODE}`);
  await expect(page.getByRole("heading", { level: 1, name: "Zones and prices" })).toBeVisible();

  // The zone row: source, bidding zone at the source, corridor, reference.
  const row = page.locator("tr", { has: page.getByRole("link", { name: ZONE_CODE }) });
  await expect(row).toContainText("entsoe");
  await expect(row).toContainText("10YSK-SEPS---K");
  await expect(row).toContainText("0.0881");

  // The history of the selected zone, which §16.7 settlements rely on.
  await expect(page.getByText("Reference history")).toBeVisible();
  await expect(page.getByText("2026-11-24 11:00:00Z").first()).toBeVisible();
});
