// US-11 — "хочу пользоваться балансом кВт·ч в другой стране": the driver sees
// the conversion before confirming, the home balance pays for the session, and
// the receipt prints the rate. On the live build, through nginx.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DRIVER = { username: "e2e_roaming_driver", password: "Pass1234" };
const ADMIN = { username: "e2e_roaming_admin", password: "Pass1234" };
const HOME = "E2EROAMHOME";
const VISIT = "E2EROAMVISIT";
const REG_NUMBER = "E2E-ROAMING-0001";

let driverId: string;
let homeZoneId: string;
let visitZoneId: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.roamingSettlement.deleteMany({
    where: { user: { username: DRIVER.username } },
  });
  await prisma.receipt.deleteMany({
    where: { payment: { zone: { code: { in: [HOME, VISIT] } } } },
  });
  await prisma.payment.deleteMany({ where: { zone: { code: { in: [HOME, VISIT] } } } });
  await prisma.roamingAgreement.deleteMany({
    where: {
      OR: [
        { homeZone: { code: { in: [HOME, VISIT] } } },
        { visitedZone: { code: { in: [HOME, VISIT] } } },
      ],
    },
  });
  await prisma.energyToken.deleteMany({ where: { zone: { code: { in: [HOME, VISIT] } } } });
  await prisma.order.deleteMany({ where: { zone: { code: { in: [HOME, VISIT] } } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: { in: [HOME, VISIT] } } } });
  await prisma.asset.deleteMany({ where: { gridZone: { code: { in: [HOME, VISIT] } } } });
  await prisma.company.deleteMany({ where: { regNumber: REG_NUMBER } });
  await prisma.gridZone.deleteMany({ where: { code: { in: [HOME, VISIT] } } });
}

test.beforeAll(async () => {
  await wipe();

  const hash = await bcrypt.hash(DRIVER.password, 10);
  driverId = (
    await prisma.user.upsert({
      where: { username: DRIVER.username },
      update: { passwordHash: hash },
      create: { username: DRIVER.username, passwordHash: hash },
    })
  ).id;

  await prisma.user.upsert({
    where: { username: ADMIN.username },
    update: { passwordHash: hash, role: "ADMIN" },
    create: { username: ADMIN.username, passwordHash: hash, role: "ADMIN" },
  });

  const zone = async (code: string, country: string, spot: number) =>
    (
      await prisma.gridZone.create({
        data: {
          code,
          country,
          name: `E2E roaming ${code}`,
          currency: "EUR",
          spotPrice: new Prisma.Decimal(spot),
          spotPriceAt: new Date(),
        },
      })
    ).id;

  // Energy is twice as expensive abroad: 1 kWh there costs 2 kWh at home.
  homeZoneId = await zone(HOME, "SK", 0.1);
  visitZoneId = await zone(VISIT, "LT", 0.2);

  await prisma.roamingAgreement.create({
    data: {
      homeZoneId,
      visitedZoneId: visitZoneId,
      partnerName: "E2E Clearing",
      feePct: new Prisma.Decimal(5),
      dailyLimitKwh: new Prisma.Decimal(100),
    },
  });

  // The driver holds 21 kWh at home, as real batches: a roaming session burns
  // them, and a balance without batches is not a balance.
  const company = await prisma.company.create({
    data: {
      legalName: "E2E Roaming Energy s.r.o.",
      country: "SK",
      regNumber: REG_NUMBER,
      type: "PRODUCER",
      kybStatus: "APPROVED",
      ownerUserId: driverId,
    },
  });
  const asset = await prisma.asset.create({
    data: {
      companyId: company.id,
      gridZoneId: homeZoneId,
      kind: "SOLAR",
      name: "E2E Roaming Array",
      capacityKw: new Prisma.Decimal(20),
      status: "ACTIVE",
    },
  });
  const homeWallet = await prisma.wallet.create({
    data: {
      ownerUserId: driverId,
      zoneId: homeZoneId,
      currency: "EUR",
      kwhBalance: new Prisma.Decimal(21),
    },
  });
  await prisma.energyToken.create({
    data: {
      assetId: asset.id,
      zoneId: homeZoneId,
      intervalStart: new Date(),
      amountKwh: new Prisma.Decimal(21),
      ownerWalletId: homeWallet.id,
      status: "AVAILABLE",
    },
  });
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({
    where: { username: { in: [DRIVER.username, ADMIN.username] } },
  });
  await prisma.$disconnect();
});

test("shows the rate before the driver confirms, then debits the home zone", async ({ page }) => {
  await signInWithPassword(page, DRIVER);
  await page.goto("/en/me/roaming");

  // §9.10 — the corridor and its rate are on the page before anything is done.
  await expect(page.getByTestId("roaming-corridors")).toContainText("E2E Clearing");
  await expect(page.getByTestId("roaming-corridors")).toContainText(`${HOME} → ${VISIT}`);

  await page.getByTestId("roaming-zone").selectOption({ label: VISIT });
  await page.getByTestId("roaming-amount").fill("10");
  await page.getByTestId("roaming-calculate").click();

  // The conversion the driver confirms: 10 kWh abroad costs 21 kWh at home.
  const quote = page.getByTestId("roaming-quote");
  await expect(quote).toBeVisible();
  await expect(page.getByTestId("roaming-debit")).toHaveText("21.000 kWh");
  await expect(page.getByTestId("roaming-rate")).toContainText("2");

  // Nothing has moved yet.
  const before = await prisma.wallet.findFirstOrThrow({
    where: { ownerUserId: driverId, zoneId: homeZoneId },
  });
  expect(Number(before.kwhBalance)).toBe(21);

  await page.getByTestId("roaming-confirm").click();
  await expect(page.getByTestId("roaming-done")).toContainText("10.000");

  const after = await prisma.wallet.findFirstOrThrow({
    where: { ownerUserId: driverId, zoneId: homeZoneId },
  });
  expect(Number(after.kwhBalance)).toBe(0);

  // §8 — the claim on the clearing partner exists and carries the rate.
  const settlement = await prisma.roamingSettlement.findFirstOrThrow({
    where: { userId: driverId },
  });
  expect(Number(settlement.deliveredKwh)).toBe(10);
  expect(Number(settlement.debitedKwh)).toBe(21);
  expect(Number(settlement.feeKwh)).toBe(1);
  expect(settlement.status).toBe("OPEN");

  // §46 — the receipt prints the corridor and the rate.
  await page.getByTestId("roaming-receipt-link").click();
  const receipt = page.getByTestId("receipt");
  await expect(receipt).toContainText("Roaming");
  await expect(receipt).toContainText(HOME);
  await expect(receipt).toContainText("21.000 kWh");
});

test("the operator sees the position and closes the period with a document", async ({ page }) => {
  await signInWithPassword(page, ADMIN);
  await page.goto("/en/admin/roaming");

  const positions = page.getByTestId("roaming-positions");
  await expect(positions).toContainText("E2E Clearing");
  await expect(positions).toContainText(`${HOME} → ${VISIT}`);
  // The open claim of the session the driver just ran.
  await expect(positions).toContainText("10.000");
  await expect(positions).toContainText("21.000");

  const agreement = await prisma.roamingAgreement.findFirstOrThrow({
    where: { homeZone: { code: HOME }, visitedZone: { code: VISIT } },
  });
  await page.getByTestId(`net-reference-${agreement.id}`).fill("E2E-SEPA-7788");
  await page.getByTestId(`net-close-${agreement.id}`).click();

  await expect(positions).toContainText("E2E-SEPA-7788");

  const settlement = await prisma.roamingSettlement.findFirstOrThrow({
    where: { agreementId: agreement.id },
  });
  expect(settlement.status).toBe("NETTED");
  expect(settlement.nettedRef).toBe("E2E-SEPA-7788");
});

test("a corridor the operator creates by hand shows up for the driver", async ({ page }) => {
  await signInWithPassword(page, ADMIN);
  await page.goto("/en/admin/roaming");

  await page.getByLabel("Home zone").selectOption({ label: VISIT });
  await page.getByLabel("Visited zone").selectOption({ label: HOME });
  await page.getByTestId("corridor-partner").fill("E2E Reverse Clearing");
  await page.getByTestId("corridor-save").click();

  await expect(page.getByTestId("roaming-positions")).toContainText("E2E Reverse Clearing");

  const created = await prisma.roamingAgreement.findFirstOrThrow({
    where: { homeZone: { code: VISIT }, visitedZone: { code: HOME } },
  });
  expect(created.partnerName).toBe("E2E Reverse Clearing");
  expect(created.enabled).toBe(true);
});
