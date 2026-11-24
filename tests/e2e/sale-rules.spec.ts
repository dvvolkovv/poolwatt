// US-28 — "задать минимальную цену продажи и резерв заряда", on the live
// build: the owner sets the rules, they are stored, and the change is in the
// audit log (§16.11).

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const USER = { username: "e2e_rules", password: "Pass1234" };
const ZONE_CODE = "E2ERULES";
const REG_NUMBER = "E2E-RULES-0001";

let userId: string;
let companyId: string;
let assetId: string;

test.describe.configure({ mode: "serial" });

async function wipe() {
  await prisma.asset.deleteMany({ where: { gridZone: { code: ZONE_CODE } } });
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
      name: "E2E rules zone",
      currency: "EUR",
      intervalMinutes: 60,
      corridorPct: new Prisma.Decimal(50),
      spotPrice: new Prisma.Decimal(0.2),
      spotPriceAt: new Date(),
    },
  });

  companyId = (
    await prisma.company.create({
      data: {
        legalName: "E2E Rules Energy s.r.o.",
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
        kind: "MIXED",
        name: "E2E Rules Bank",
        capacityKw: new Prisma.Decimal(30),
        storageKwh: new Prisma.Decimal(40),
        status: "ACTIVE",
      },
    })
  ).id;
});

test.afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: assetId } });
  await wipe();
  await prisma.user.deleteMany({ where: { username: USER.username } });
  await prisma.$disconnect();
});

test("sets the minimum sale price and the charge reserve, and logs the change", async ({
  page,
}) => {
  await signInWithPassword(page, USER);
  await page.goto(`/en/me/listing/${companyId}/assets`);

  await page.getByLabel("Minimum price, €/kWh").fill("0.21");
  // The reserve field only exists for an asset that can store (§30).
  const reserve = page.getByLabel("Reserve, %");
  await expect(reserve).toBeVisible();
  await reserve.fill("30");
  await page.locator('button:has-text("Save rules")').first().click();
  await expect(page.locator("text=Saved").first()).toBeVisible();

  const stored = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
  expect(Number(stored.minSalePrice)).toBe(0.21);
  expect(stored.reserveSocPct).toBe(30);

  const entry = await prisma.auditLog.findFirstOrThrow({
    where: { entity: "Asset", entityId: assetId, action: "asset.rules.updated" },
    orderBy: { at: "desc" },
  });
  expect(JSON.stringify(entry.after)).toContain("30");
});

test("offers no reserve field for an asset that cannot store", async ({ page }) => {
  const solar = await prisma.asset.create({
    data: {
      companyId,
      gridZoneId: (await prisma.gridZone.findUniqueOrThrow({ where: { code: ZONE_CODE } })).id,
      kind: "SOLAR",
      name: "E2E Rules Array",
      capacityKw: new Prisma.Decimal(10),
      status: "ACTIVE",
    },
  });

  await signInWithPassword(page, USER);
  await page.goto(`/en/me/listing/${companyId}/assets`);

  await expect(page.locator("text=E2E Rules Array")).toBeVisible();
  // One reserve field on the page, belonging to the bank — not to the array.
  await expect(page.getByLabel("Reserve, %")).toHaveCount(1);

  await prisma.asset.delete({ where: { id: solar.id } });
});
