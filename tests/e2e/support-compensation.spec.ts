// §51 «Компенсации» на живой сборке: водитель жалуется на списание из
// истории зарядок, поддержка возвращает часть денег и выдаёт подарочные
// кВт·ч, и водитель видит оба факта у себя — в заявке и в кошельке.

import { test, expect } from "@playwright/test";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { signInWithPassword } from "./login";
import { notifyPendingRefunds } from "../../src/lib/work/refund-mail";

const prisma = new PrismaClient();

const DRIVER = { username: "e2e_comp_driver", password: "Pass1234" };
const SUPPORT = { username: "e2e_comp_agent", password: "Pass1234" };
const OWNER = { username: "e2e_comp_owner", password: "Pass1234" };
const SLUG = "e2e-support-compensation";
const ZONE = "E2ECOMP";

let operatorId: string;
let pointId: string;
let zoneId: string;
let driverUserId: string;
let walletId: string;
let paymentId: string;
let receiptId: string;
let ticketId: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.paymentRefund.deleteMany({
    where: { ticket: { operator: { slug: SLUG } } },
  });
  await prisma.ticketMessage.deleteMany({
    where: { ticket: { operator: { slug: SLUG } } },
  });
  await prisma.ticket.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.promoGrant.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.campaign.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.receipt.deleteMany({ where: { payment: { zone: { code: ZONE } } } });
  await prisma.payment.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.employee.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.staffRole.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
}

test.beforeAll(async () => {
  await wipe();

  const hash = await bcrypt.hash(DRIVER.password, 10);
  const user = async (username: string) =>
    (
      await prisma.user.upsert({
        where: { username },
        update: { passwordHash: hash },
        create: { username, passwordHash: hash },
      })
    ).id;
  driverUserId = await user(DRIVER.username);
  const supportUserId = await user(SUPPORT.username);
  const ownerUserId = await user(OWNER.username);

  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE, country: "SK", name: "E2E compensation zone", currency: "EUR" },
    })
  ).id;
  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "E2E Compensation Network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  pointId = (
    await prisma.acceptancePoint.create({
      data: {
        operatorId,
        type: "CHARGING_STATION",
        name: "E2E Compensation Point",
        status: "PUBLISHED",
        publishedAt: new Date(),
        country: "SK",
        city: "Košice",
        addressLine: "Hlavná 11",
        latitude: 48.73,
        longitude: 21.26,
        howToFind: "by the bakery",
        energySource: "SOLAR",
        open24: true,
        paymentMethods: ["TOKEN"],
        connectors: {
          create: [
            {
              type: "CCS2",
              powerKw: new Prisma.Decimal(50),
              currentAc: false,
              quantity: 1,
              status: "FREE",
            },
          ],
        },
        tariffs: { create: [{ fromMinute: 0, toMinute: 1440, priceFiat: 0.4, currency: "EUR" }] },
      },
    })
  ).id;

  // §47 — та же роль поддержки, что в разговоре.
  const role = await prisma.staffRole.create({
    data: {
      operatorId,
      name: "SUPPORT",
      permissions: ["points.read", "tickets.read", "tickets.write", "workorders.read"],
      builtIn: true,
    },
  });
  await prisma.employee.create({
    data: { operatorId, userId: supportUserId, roleId: role.id, pointIds: [] },
  });

  // Кошелёк с деньгами и зарядка, которую водитель считает списанной неверно.
  walletId = (
    await prisma.wallet.create({
      data: {
        ownerUserId: driverUserId,
        zoneId,
        currency: "EUR",
        fiatBalance: new Prisma.Decimal(20),
      },
    })
  ).id;
  const payment = await prisma.payment.create({
    data: {
      walletId,
      zoneId,
      pointId,
      requestedKwh: new Prisma.Decimal(25),
      kwhFromBalance: new Prisma.Decimal(25),
      amountFiat: new Prisma.Decimal(10),
      status: "CAPTURED",
      capturedAt: new Date(),
    },
  });
  paymentId = payment.id;
  receiptId = (
    await prisma.receipt.create({
      data: {
        paymentId: payment.id,
        number: `PW-2026-E2EC01`,
        verifyCode: `e2ecomp${Date.now()}`,
        burnedTokenIds: [],
        totalKwh: new Prisma.Decimal(25),
        totalFiat: new Prisma.Decimal(10),
        currency: "EUR",
        breakdown: { kind: "charge", pointId } as Prisma.InputJsonValue,
      },
    })
  ).id;

  // §51 — компенсация, которую настроил партнёр: 5 кВт·ч за неудобство.
  await prisma.campaign.create({
    data: {
      operatorId,
      zoneId,
      name: "E2E sorry about that",
      trigger: "COMPENSATION",
      giftKwh: new Prisma.Decimal(5),
      budgetKwh: new Prisma.Decimal(100),
      validityDays: 30,
      oncePerClient: false,
      status: "ACTIVE",
    },
  });
});

test.afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

test("§51.1 — the driver complains about a debit from the charge history", async ({ page }) => {
  await signInWithPassword(page, DRIVER);
  await page.goto(`/en/me/wallet/receipts/${receiptId}`);

  await page.locator('[data-testid="receipt-report"]').click();
  await page.waitForURL(/\/report\?payment=/);

  await page.fill('textarea[aria-label="Anything to add (optional)"]', "Charged twice the price");
  await page.locator('[data-testid="report-WRONG_PRICE"]').click();
  await expect(page.locator('[data-testid="report-sent"]')).toBeVisible();

  const ticket = await prisma.ticket.findFirstOrThrow({
    where: { operatorId, reporterId: driverUserId },
    orderBy: { createdAt: "desc" },
  });
  ticketId = ticket.id;
  // Это и есть предмет возврата: заявка знает сеанс.
  expect(ticket.paymentId).toBe(paymentId);
});

test("support gives part of the debit back and hands out the compensation", async ({ page }) => {
  await signInWithPassword(page, SUPPORT);
  await page.goto(`/en/me/charger-operator/${operatorId}/tickets/${ticketId}`);

  const panel = page.locator('[data-testid="ticket-compensation"]');
  await expect(panel).toBeVisible();
  // Сумма подставлена: весь сеанс ещё не возвращён.
  await expect(page.locator('[data-testid="ticket-refund-amount"]')).toHaveValue("10.00");

  await page.fill('[data-testid="ticket-refund-amount"]', "4.20");
  await page.fill('[data-testid="ticket-refund-reason"]', "Tariff was applied twice");
  await page.locator('[data-testid="ticket-refund"]').click();
  await expect(page.locator('[data-testid="ticket-compensation-given"]')).toContainText("4.20");

  await page.locator('[data-testid="ticket-compensate"]').click();
  await expect(page.locator('[data-testid="ticket-compensation-given"]')).toContainText("5.000");

  const refunds = await prisma.paymentRefund.findMany({ where: { ticketId } });
  expect(refunds).toHaveLength(1);
  expect(Number(refunds[0].amountFiat)).toBe(4.2);

  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
  expect(Number(wallet.fiatBalance)).toBe(24.2);

  const grants = await prisma.promoGrant.findMany({ where: { userId: driverUserId } });
  expect(grants.filter((g) => g.onceKey === `ticket-${ticketId}`)).toHaveLength(1);
});

test("the driver sees both in the ticket and the refund in the wallet", async ({ page }) => {
  await signInWithPassword(page, DRIVER);
  await page.goto(`/en/me/tickets/${ticketId}`);

  await expect(page.locator('[data-testid="ticket-compensation-given"]')).toContainText("4.20");
  await expect(page.locator('[data-testid="ticket-compensation-given"]')).toContainText("5.000");
  // Системные записи разговора говорят то же словами.
  const thread = page.locator('[data-testid="ticket-thread"]');
  await expect(thread).toContainText("refund of 4.20");
  await expect(thread).toContainText("5.000 kWh");

  await page.goto("/en/me/wallet");
  // §51 — деньги на балансе, и подарок виден отдельно от него (§43).
  await expect(page.locator("body")).toContainText("24.20");
});

test("the refund letter goes out once", async () => {
  const told = await notifyPendingRefunds(new Date(), { sendTo: async () => undefined });
  expect(told).toBeGreaterThanOrEqual(1);
  expect(await notifyPendingRefunds(new Date(), { sendTo: async () => undefined })).toBe(0);
});

test("one review, one refund: the method refuses a second one", async ({ page }) => {
  await signInWithPassword(page, SUPPORT);
  const again = await page.request.post(`/api/v1/tickets/${ticketId}/refund`, {
    headers: { "Idempotency-Key": `e2e-comp-${Date.now()}` },
    data: { amountFiat: 1, reason: "again" },
  });
  expect(again.status()).toBe(400);

  const twice = await page.request.post(`/api/v1/tickets/${ticketId}/compensation`, {
    headers: { "Idempotency-Key": `e2e-comp-gift-${Date.now()}` },
  });
  expect(twice.status()).toBe(400);

  const refunds = await prisma.paymentRefund.findMany({ where: { ticketId } });
  expect(refunds).toHaveLength(1);
});

test("the driver cannot refund their own ticket", async ({ page }) => {
  await signInWithPassword(page, DRIVER);
  const mine = await page.request.post(`/api/v1/tickets/${ticketId}/refund`, {
    headers: { "Idempotency-Key": `e2e-comp-driver-${Date.now()}` },
    data: { amountFiat: 1, reason: "please" },
  });
  expect(mine.status()).toBe(404);
});
