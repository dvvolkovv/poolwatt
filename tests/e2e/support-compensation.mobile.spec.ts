// §51 «Компенсации» в телефоне, на живой сборке: кнопка «Сообщить о
// проблеме» на чеке, строка «что вернула сеть» в своей заявке и возврат
// отдельным видом в ленте кошелька.

import { test, expect } from "@playwright/test";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { signInWithPassword } from "./login";

const prisma = new PrismaClient();

const DRIVER = { username: "e2e_mcomp_driver", password: "Pass1234" };
const SUPPORT = { username: "e2e_mcomp_agent", password: "Pass1234" };
const OWNER = { username: "e2e_mcomp_owner", password: "Pass1234" };
const SLUG = "e2e-mcomp-network";
const ZONE = "E2EMCMP";

let operatorId: string;
let pointId: string;
let zoneId: string;
let driverUserId: string;
let supportUserId: string;
let walletId: string;
let paymentId: string;
let receiptId: string;
let ticketId: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.paymentRefund.deleteMany({ where: { ticket: { operator: { slug: SLUG } } } });
  await prisma.ticketMessage.deleteMany({ where: { ticket: { operator: { slug: SLUG } } } });
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
  supportUserId = await user(SUPPORT.username);
  const ownerUserId = await user(OWNER.username);

  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE, country: "SK", name: "E2E mobile compensation", currency: "EUR" },
    })
  ).id;
  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "E2E Mobile Compensation",
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
        name: "E2E Mobile Comp Point",
        status: "PUBLISHED",
        publishedAt: new Date(),
        country: "SK",
        city: "Košice",
        addressLine: "Hlavná 13",
        latitude: 48.74,
        longitude: 21.27,
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

  const role = await prisma.staffRole.create({
    data: {
      operatorId,
      name: "SUPPORT",
      permissions: ["points.read", "tickets.read", "tickets.write"],
      builtIn: true,
    },
  });
  await prisma.employee.create({
    data: { operatorId, userId: supportUserId, roleId: role.id, pointIds: [] },
  });

  walletId = (
    await prisma.wallet.create({
      data: {
        ownerUserId: driverUserId,
        zoneId,
        currency: "EUR",
        fiatBalance: new Prisma.Decimal(15),
      },
    })
  ).id;
  const payment = await prisma.payment.create({
    data: {
      walletId,
      zoneId,
      pointId,
      requestedKwh: new Prisma.Decimal(12),
      kwhFromBalance: new Prisma.Decimal(12),
      amountFiat: new Prisma.Decimal(6),
      status: "CAPTURED",
      capturedAt: new Date(),
    },
  });
  paymentId = payment.id;
  receiptId = (
    await prisma.receipt.create({
      data: {
        paymentId: payment.id,
        number: "PW-2026-E2EM01",
        verifyCode: `e2emcomp${Date.now()}`,
        burnedTokenIds: [],
        totalKwh: new Prisma.Decimal(12),
        totalFiat: new Prisma.Decimal(6),
        currency: "EUR",
        breakdown: { kind: "charge", pointId } as Prisma.InputJsonValue,
      },
    })
  ).id;

  await prisma.campaign.create({
    data: {
      operatorId,
      zoneId,
      name: "E2E mobile sorry",
      trigger: "COMPENSATION",
      giftKwh: new Prisma.Decimal(3),
      budgetKwh: new Prisma.Decimal(50),
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

test("§51.1 — the phone's receipt carries the report button", async ({ page }) => {
  await signInWithPassword(page, DRIVER);
  await page.goto(`/en/app/wallet/receipts/${receiptId}`);
  await expect(page.locator('[data-testid="mobile-receipt"]')).toBeVisible();

  await page.locator('[data-testid="receipt-report"]').click();
  await page.waitForURL(/\/report\?payment=/);
  await page.locator('[data-testid="report-WRONG_PRICE"]').click();
  await expect(page.locator('[data-testid="report-sent"]')).toBeVisible();

  const ticket = await prisma.ticket.findFirstOrThrow({
    where: { operatorId, reporterId: driverUserId },
    orderBy: { createdAt: "desc" },
  });
  ticketId = ticket.id;
  expect(ticket.paymentId).toBe(paymentId);
});

test("the phone shows what the network gave back, and the refund in the wallet", async ({
  page,
}) => {
  // Решение принимает поддержка — здесь через метод §50, чтобы проверять
  // именно телефонные экраны водителя.
  await signInWithPassword(page, SUPPORT);
  const refunded = await page.request.post(`/api/v1/tickets/${ticketId}/refund`, {
    headers: { "Idempotency-Key": `e2e-mcomp-${Date.now()}` },
    data: { amountFiat: 2.5, reason: "Tariff was wrong" },
  });
  expect(refunded.status()).toBe(201);
  const gift = await page.request.post(`/api/v1/tickets/${ticketId}/compensation`, {
    headers: { "Idempotency-Key": `e2e-mcomp-gift-${Date.now()}` },
  });
  expect(gift.status()).toBe(201);

  await page.context().clearCookies();
  await signInWithPassword(page, DRIVER);

  await page.goto(`/en/app/tickets/${ticketId}`);
  const given = page.locator('[data-testid="ticket-compensation-given"]');
  await expect(given).toContainText("2.50");
  await expect(given).toContainText("3.000");

  // §22.3 — возврат отдельным видом в ленте, и баланс уже с ним.
  await page.goto("/en/app/wallet?kind=refund");
  await expect(page.locator('[data-testid="history-list"]')).toContainText("Refund");
  await expect(page.locator('[data-testid="history-list"]')).toContainText("2.50");

  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
  expect(Number(wallet.fiatBalance)).toBe(17.5);
});
