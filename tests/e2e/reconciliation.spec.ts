// ТЗ §16.11 — the operator's view of the nightly registry check. A run whose
// findings live only in a log file is a run nobody acts on, so this walks the
// page: run it, see the result, see a planted drift named on screen.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const OPERATOR = { username: "e2e_recon_operator", password: "Pass1234" };
const ZONE_CODE = "E2ERECON";
const REG_NUMBER = "E2E-RECON-0001";

let zoneId: string;
let walletId: string;
let userId: string;

test.describe.configure({ mode: "serial" });

async function wipe() {
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.meterReading.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.asset.deleteMany({ where: { gridZone: { code: ZONE_CODE } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE_CODE } });
  await prisma.company.deleteMany({ where: { regNumber: REG_NUMBER } });
  await prisma.reconciliationRun.deleteMany({ where: { scope: "manual" } });
}

test.beforeAll(async () => {
  await wipe();
  const hash = await bcrypt.hash(OPERATOR.password, 10);
  const user = await prisma.user.upsert({
    where: { username: OPERATOR.username },
    update: { passwordHash: hash, role: "ADMIN" },
    create: { username: OPERATOR.username, passwordHash: hash, role: "ADMIN" },
  });
  userId = user.id;

  const zone = await prisma.gridZone.create({
    data: {
      code: ZONE_CODE,
      country: "SK",
      name: "E2E reconciliation zone",
      currency: "EUR",
      intervalMinutes: 60,
      corridorPct: new Prisma.Decimal(30),
    },
  });
  zoneId = zone.id;

  // A wallet claiming kWh it does not hold: the drift the page must name.
  const wallet = await prisma.wallet.create({
    data: {
      ownerUserId: userId,
      zoneId,
      currency: "EUR",
      kwhBalance: new Prisma.Decimal(123.456),
    },
  });
  walletId = wallet.id;
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: OPERATOR.username } });
  await prisma.$disconnect();
});

test("operator runs the reconciliation and sees the drift it found", async ({ page }) => {
  await signInWithPassword(page, OPERATOR);
  await page.goto("/en/admin/reconciliation");
  await expect(
    page.getByRole("heading", { level: 1, name: "Token registry reconciliation" }),
  ).toBeVisible();

  await page.click('button:has-text("Run now")');

  // The planted wallet has a balance with no batches behind it.
  await expect(page.getByTestId("reconcile-message")).toContainText("drift");
  const row = page.locator("tr", { hasText: walletId });
  await expect(row).toContainText("123.456");
  await expect(row).toContainText("wallet-balances");

  // And the finding is never repaired behind the operator's back.
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
  expect(Number(wallet.kwhBalance)).toBe(123.456);
});
