// M2 — кошелёк в телефоне так, как его встречает человек: баланс, который
// обновляется сам, покупка впрок в один клик, лента с фильтром, чек, который
// открывается, и чужой чек, которого нет.
//
// Зона у теста своя, с настоящим предложением за ней (партия энергии и
// стоящая заявка на продажу): иначе «купить в один клик» нечего, кнопка
// честно гаснет, и проверка §22.3 ничего не проверяет.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const USER = { username: "e2e_mobile_wallet", password: "Pass1234" };
const OTHER = { username: "e2e_mobile_wallet_other", password: "Pass1234" };
const ZONE_CODE = "E2EMOBWALLET";
const REG_NUMBER = "E2E-MOBWALLET-0001";

let zoneId: string;
let myReceiptId: string;
let strangerReceiptId: string;

test.describe.configure({ mode: "serial" });

// Через nginx, а не прямо в :3000 — баланс обязан двигаться по каналу §15
// (US-17), а апгрейд до WebSocket отдаёт только публичный хост.
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.receipt.deleteMany({
    where: {
      OR: [
        { trade: { zone: { code: ZONE_CODE } } },
        { payment: { zone: { code: ZONE_CODE } } },
      ],
    },
  });
  await prisma.trade.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.payment.deleteMany({ where: { zone: { code: ZONE_CODE } } });
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

  const hash = await bcrypt.hash(USER.password, 10);
  const me = await prisma.user.upsert({
    where: { username: USER.username },
    update: { passwordHash: hash },
    create: { username: USER.username, passwordHash: hash },
  });
  const other = await prisma.user.upsert({
    where: { username: OTHER.username },
    update: { passwordHash: hash },
    create: { username: OTHER.username, passwordHash: hash },
  });

  const zone = await prisma.gridZone.create({
    data: {
      code: ZONE_CODE,
      country: "SK",
      name: "E2E mobile wallet zone",
      currency: "EUR",
      intervalMinutes: 60,
      corridorPct: new Prisma.Decimal(40),
      spotPrice: new Prisma.Decimal(0.2),
      spotPriceAt: new Date(),
    },
  });
  zoneId = zone.id;

  // У покупателя деньги и ни одного киловатт-часа.
  const myWallet = await prisma.wallet.create({
    data: {
      ownerUserId: me.id,
      zoneId,
      currency: "EUR",
      kwhBalance: new Prisma.Decimal(0),
      fiatBalance: new Prisma.Decimal(100),
    },
  });

  // Зарядка со чеком — чтобы в ленте было что открыть (§46).
  const myPayment = await prisma.payment.create({
    data: {
      walletId: myWallet.id,
      zoneId,
      requestedKwh: new Prisma.Decimal(8),
      kwhFromBalance: new Prisma.Decimal(8),
      amountFiat: new Prisma.Decimal(2.4),
      status: "CAPTURED",
      capturedAt: new Date(),
    },
  });
  myReceiptId = (
    await prisma.receipt.create({
      data: {
        paymentId: myPayment.id,
        totalKwh: new Prisma.Decimal(8),
        totalFiat: new Prisma.Decimal(2.4),
        currency: "EUR",
      },
    })
  ).id;

  // У кого-то энергия в продаже, иначе покупать в один клик нечего.
  const sellerWallet = await prisma.wallet.create({
    data: { ownerUserId: other.id, zoneId, currency: "EUR" },
  });
  const company = await prisma.company.create({
    data: {
      legalName: "E2E Mobile Wallet Energy s.r.o.",
      country: "SK",
      regNumber: REG_NUMBER,
      type: "PRODUCER",
      kybStatus: "APPROVED",
      ownerUserId: other.id,
    },
  });
  const asset = await prisma.asset.create({
    data: {
      companyId: company.id,
      gridZoneId: zoneId,
      kind: "SOLAR",
      name: "E2E Mobile Wallet Array",
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

  // Чужой чек: зарядка продавца, которая покупателя не касается.
  const strangerPayment = await prisma.payment.create({
    data: {
      walletId: sellerWallet.id,
      zoneId,
      requestedKwh: new Prisma.Decimal(7),
      kwhFromBalance: new Prisma.Decimal(7),
      amountFiat: new Prisma.Decimal(2.1),
      status: "CAPTURED",
      capturedAt: new Date(),
    },
  });
  strangerReceiptId = (
    await prisma.receipt.create({
      data: {
        paymentId: strangerPayment.id,
        totalKwh: new Prisma.Decimal(7),
        totalFiat: new Prisma.Decimal(2.1),
        currency: "EUR",
      },
    })
  ).id;
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { in: [USER.username, OTHER.username] } } });
  await prisma.$disconnect();
});

test("the wallet screen shows both balances and says whether it is live", async ({ page }) => {
  await signInWithPassword(page, USER, "ru");
  await page.goto("/ru/app/wallet");
  await expect(page.getByTestId("kwh-balance")).toBeVisible();
  await expect(page.getByTestId("fiat-balance")).toContainText("100.00 EUR");
  await expect(page.getByTestId(`zone-kwh-${ZONE_CODE}`)).toHaveText("0.000 kWh");
  // US-17 — канал жив через публичный хост.
  await expect(page.getByTestId("balance-live-state")).toHaveText("Обновляется", {
    timeout: 15_000,
  });
});

test("one click buys 10 kWh ahead and the balance moves", async ({ page }) => {
  await signInWithPassword(page, USER, "ru");
  await page.goto("/ru/app/wallet");

  // Цена посчитана по живой книге до нажатия (US-07).
  const quick = page.getByTestId("quick-buy-10");
  await expect(quick).toContainText("≈ 2.0");
  await quick.click();

  await expect(page.getByTestId("buy-result")).toContainText("10.000 kWh");
  await expect(page.getByTestId(`zone-kwh-${ZONE_CODE}`)).toHaveText("10.000 kWh", {
    timeout: 15_000,
  });

  const trade = await prisma.trade.findFirstOrThrow({
    where: { zoneId },
    orderBy: { executedAt: "desc" },
    include: { receipt: true },
  });
  expect(Number(trade.amountKwh)).toBe(10);

  // Покупка попала в ленту, и её чек открывается оттуда.
  await page.goto("/ru/app/wallet?kind=buy");
  const row = page.locator("[data-kind=BUY]").first();
  await expect(row).toContainText("+10.000 kWh");
  await page.locator(`[data-receipt="${trade.receipt!.id}"]`).first().click();
  await expect(page.getByTestId("mobile-receipt")).toContainText("10.000");
});

test("a charge in the history opens its receipt", async ({ page }) => {
  await signInWithPassword(page, USER, "ru");
  await page.goto("/ru/app/wallet?kind=charge");
  await page.locator(`[data-receipt="${myReceiptId}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/ru/app/wallet/receipts/${myReceiptId}$`));
  await expect(page.getByTestId("mobile-receipt")).toBeVisible();
});

test("the filter narrows the history to one kind", async ({ page }) => {
  await signInWithPassword(page, USER, "ru");
  await page.goto("/ru/app/wallet?kind=charge");
  await expect(page.locator("[data-chip=charge][aria-current=true]")).toBeVisible();
  await expect(page.locator("[data-kind=CHARGE]").first()).toBeVisible();
  await expect(page.locator("[data-kind=BUY]")).toHaveCount(0);
});

test("rubbish in the filter shows everything instead of breaking", async ({ page }) => {
  await signInWithPassword(page, USER, "ru");
  await page.goto("/ru/app/wallet?kind=../etc/passwd");
  await expect(page.locator("[data-chip=all][aria-current=true]")).toBeVisible();
  await expect(page.locator("[data-kind=CHARGE]").first()).toBeVisible();
});

test("somebody else's receipt does not exist here", async ({ page }) => {
  await signInWithPassword(page, USER, "ru");
  const response = await page.goto(`/ru/app/wallet/receipts/${strangerReceiptId}`);
  expect(response?.status()).toBe(404);
});

test("the main screen carries the same live balance", async ({ page }) => {
  await signInWithPassword(page, USER, "ru");
  await page.goto("/ru/app");
  await expect(page.getByTestId("kwh-balance")).toBeVisible();
  await expect(page.getByTestId("balance-live-state")).toHaveText("Обновляется", {
    timeout: 15_000,
  });
});
