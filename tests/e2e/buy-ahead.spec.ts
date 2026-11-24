// US-07 — "купить кВт·ч впрок": one click at the market price, the kWh
// balance moves straight away, and the receipt is in the history and opens.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const BUYER = { username: "e2e_buyahead_buyer", password: "Pass1234" };
const SELLER = { username: "e2e_buyahead_seller", password: "Pass1234" };
const ZONE_CODE = "E2EBUYAHEAD";
const REG_NUMBER = "E2E-BUYAHEAD-0001";

let buyerId: string;
let sellerId: string;
let zoneId: string;
let buyerWalletId: string;

test.describe.configure({ mode: "serial" });

// Through nginx, not straight at :3000: the balance is meant to move over the
// §15 channel, and only the public host serves the WebSocket upgrade.
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.receipt.deleteMany({ where: { trade: { zone: { code: ZONE_CODE } } } });
  await prisma.trade.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.order.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.meterReading.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.asset.deleteMany({ where: { gridZone: { code: ZONE_CODE } } });
  await prisma.company.deleteMany({ where: { regNumber: REG_NUMBER } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE_CODE } });
}

test.beforeAll(async () => {
  await wipe();

  const hash = await bcrypt.hash(BUYER.password, 10);
  buyerId = (
    await prisma.user.upsert({
      where: { username: BUYER.username },
      update: { passwordHash: hash },
      create: { username: BUYER.username, passwordHash: hash },
    })
  ).id;
  sellerId = (
    await prisma.user.upsert({
      where: { username: SELLER.username },
      update: { passwordHash: hash },
      create: { username: SELLER.username, passwordHash: hash },
    })
  ).id;

  const zone = await prisma.gridZone.create({
    data: {
      code: ZONE_CODE,
      country: "SK",
      name: "E2E buy-ahead zone",
      currency: "EUR",
      intervalMinutes: 60,
      corridorPct: new Prisma.Decimal(40),
      spotPrice: new Prisma.Decimal(0.2),
      spotPriceAt: new Date(),
    },
  });
  zoneId = zone.id;

  // The buyer has money but no energy.
  buyerWalletId = (
    await prisma.wallet.create({
      data: {
        ownerUserId: buyerId,
        zoneId,
        currency: "EUR",
        kwhBalance: new Prisma.Decimal(0),
        fiatBalance: new Prisma.Decimal(100),
      },
    })
  ).id;

  // Somebody has energy on offer, or there is nothing to buy in one click.
  const sellerWallet = await prisma.wallet.create({
    data: { ownerUserId: sellerId, zoneId, currency: "EUR" },
  });
  const company = await prisma.company.create({
    data: {
      legalName: "E2E Buy-ahead Energy s.r.o.",
      country: "SK",
      regNumber: REG_NUMBER,
      type: "PRODUCER",
      kybStatus: "APPROVED",
      ownerUserId: sellerId,
    },
  });
  const asset = await prisma.asset.create({
    data: {
      companyId: company.id,
      gridZoneId: zoneId,
      kind: "SOLAR",
      name: "E2E Buy-ahead Array",
      capacityKw: new Prisma.Decimal(50),
      status: "ACTIVE",
    },
  });
  const intervalStart = new Date(Date.now() + 2 * 3_600_000);
  const reading = await prisma.meterReading.create({
    data: {
      assetId: asset.id,
      zoneId,
      intervalStart,
      intervalEnd: new Date(intervalStart.getTime() + 3_600_000),
      energyKwh: new Prisma.Decimal(60),
      source: "rest",
      validationStatus: "VALID",
      mintedAt: new Date(),
    },
  });
  await prisma.energyToken.create({
    data: {
      assetId: asset.id,
      zoneId,
      readingId: reading.id,
      intervalStart,
      amountKwh: new Prisma.Decimal(60),
      ownerWalletId: sellerWallet.id,
      status: "AVAILABLE",
    },
  });
  await prisma.wallet.update({
    where: { id: sellerWallet.id },
    data: { kwhBalance: new Prisma.Decimal(60) },
  });
  await prisma.order.create({
    data: {
      walletId: sellerWallet.id,
      zoneId,
      side: "SELL",
      type: "LIMIT",
      amountKwh: new Prisma.Decimal(60),
      limitPrice: new Prisma.Decimal(0.2),
      status: "NEW",
    },
  });
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { in: [BUYER.username, SELLER.username] } } });
  await prisma.$disconnect();
});

test("buys 10 kWh in one click and opens the receipt it produced", async ({ page }) => {
  await signInWithPassword(page, BUYER);
  await page.goto("/en/me/wallet");

  await expect(page.getByTestId(`wallet-kwh-${ZONE_CODE}`)).toHaveText("0.000");

  // One click: the amount is the button, priced off the live book.
  const quick = page.getByTestId("quick-buy-10");
  await expect(quick).toContainText("≈ 2.0");
  await quick.click();

  // The kWh balance moves straight away (US-07), over the live channel.
  await expect(page.getByTestId(`wallet-kwh-${ZONE_CODE}`)).toHaveText("10.000", {
    timeout: 15_000,
  });
  await expect(page.getByTestId("buy-result")).toContainText("10.000 kWh");

  const trade = await prisma.trade.findFirstOrThrow({
    where: { zoneId },
    orderBy: { executedAt: "desc" },
    include: { receipt: true },
  });
  expect(Number(trade.amountKwh)).toBe(10);
  expect(trade.receipt).not.toBeNull();

  // The receipt is in the history and opens as a document (§46).
  await page.reload();
  await page.locator(`a[href$="/me/wallet/receipts/${trade.receipt!.id}"]`).first().click();
  const receipt = page.getByTestId("receipt");
  await expect(receipt).toContainText("10.000 kWh");
  await expect(receipt).toContainText("0.2000 EUR/kWh");
  await expect(receipt).toContainText(ZONE_CODE);
});

test("hides someone else's receipt", async ({ page }) => {
  const receipt = await prisma.receipt.findFirstOrThrow({
    where: { trade: { zoneId } },
  });
  await signInWithPassword(page, SELLER);

  // The seller stood on the other leg, so this one is theirs.
  await page.goto(`/en/me/wallet/receipts/${receipt.id}`);
  await expect(page.getByTestId("receipt")).toBeVisible();

  // A receipt from no trade of theirs is simply not there.
  const res = await page.goto("/en/me/wallet/receipts/no-such-receipt");
  expect(res?.status()).toBe(404);
});
