// M3-а — зарядка в телефоне так, как её проходит водитель: код разъёма,
// расчёт §16.6 до согласия, живая цифра от отчёта оборудования, завершение и
// чек §46.
//
// Отчёт счётчика идёт настоящим подписанным запросом к `/v1/charge-sessions/
// {id}/meter` — тем же путём, которым отчитается железо на станции. Если
// подпись перестанет приниматься, этот тест упадёт первым.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHash, createHmac, randomBytes } from "node:crypto";

const prisma = new PrismaClient();

const USER = { username: "e2e_mobile_charge", password: "Pass1234" };
const SELLER = { username: "e2e_mobile_charge_seller", password: "Pass1234" };
const ZONE_CODE = "E2EMOBCHARGE";
const REG_NUMBER = "E2E-MOBCHARGE-0001";
const OPERATOR_SLUG = "e2e-mobcharge-net";

let zoneId: string;
let pointId: string;
let connectorId: string;
let pointToken: string;
let signingSecret: string | null;

test.describe.configure({ mode: "serial" });

// Через nginx: цифра на экране двигается каналом §15, а апгрейд до WebSocket
// отдаёт только публичный хост.
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.chargeSessionTick.deleteMany({
    where: { session: { zone: { code: ZONE_CODE } } },
  });
  await prisma.chargeSession.deleteMany({ where: { zone: { code: ZONE_CODE } } });
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
  await prisma.pointApiKey.deleteMany({
    where: { point: { operator: { slug: OPERATOR_SLUG } } },
  });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: OPERATOR_SLUG } },
  });
  await prisma.operatorAccounting.deleteMany({
    where: { operator: { slug: OPERATOR_SLUG } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: OPERATOR_SLUG } });
  await prisma.asset.deleteMany({ where: { gridZone: { code: ZONE_CODE } } });
  await prisma.company.deleteMany({ where: { regNumber: REG_NUMBER } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE_CODE } });
}

/** Подпись §15 так, как её ставит оборудование. */
async function reportMeter(sessionId: string, kwhTotal: number, powerKw: number) {
  const path = `/v1/charge-sessions/${sessionId}/meter`;
  const body = JSON.stringify({ kwhTotal, powerKw });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${pointToken}`,
  };
  if (signingSecret) {
    const digest = createHash("sha256").update(body, "utf8").digest("hex");
    const canonical = `v1.${timestamp}.POST.${path}.${digest}`;
    headers["x-poolwatt-timestamp"] = timestamp;
    headers["x-poolwatt-signature"] = `v1=${createHmac("sha256", signingSecret)
      .update(canonical, "utf8")
      .digest("hex")}`;
  }
  const base = process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com";
  const response = await fetch(`${base}/api${path}`, {
    method: "POST",
    headers,
    body,
  });
  if (!response.ok) {
    throw new Error(`meter report ${response.status}: ${await response.text()}`);
  }
}

test.beforeAll(async () => {
  await wipe();

  const hash = await bcrypt.hash(USER.password, 10);
  const me = await prisma.user.upsert({
    where: { username: USER.username },
    update: { passwordHash: hash },
    create: { username: USER.username, passwordHash: hash },
  });
  const seller = await prisma.user.upsert({
    where: { username: SELLER.username },
    update: { passwordHash: hash },
    create: { username: SELLER.username, passwordHash: hash },
  });

  const zone = await prisma.gridZone.create({
    data: {
      code: ZONE_CODE,
      country: "SK",
      name: "E2E mobile charge zone",
      currency: "EUR",
      intervalMinutes: 60,
      corridorPct: new Prisma.Decimal(40),
      spotPrice: new Prisma.Decimal(0.2),
      spotPriceAt: new Date(),
    },
  });
  zoneId = zone.id;

  const company = await prisma.company.create({
    data: {
      legalName: "E2E Mobile Charge Energy s.r.o.",
      country: "SK",
      regNumber: REG_NUMBER,
      type: "PRODUCER",
      kybStatus: "APPROVED",
      ownerUserId: seller.id,
    },
  });
  const asset = await prisma.asset.create({
    data: {
      companyId: company.id,
      gridZoneId: zoneId,
      kind: "SOLAR",
      name: "E2E Mobile Charge Array",
      capacityKw: new Prisma.Decimal(50),
      status: "ACTIVE",
    },
  });

  // У водителя 20 кВт·ч своими партиями — водопад §16.6 начинается с них.
  const myWallet = await prisma.wallet.create({
    data: {
      ownerUserId: me.id,
      zoneId,
      currency: "EUR",
      kwhBalance: new Prisma.Decimal(20),
      fiatBalance: new Prisma.Decimal(50),
    },
  });
  await prisma.energyToken.create({
    data: {
      assetId: asset.id,
      zoneId,
      intervalStart: new Date(),
      amountKwh: new Prisma.Decimal(20),
      ownerWalletId: myWallet.id,
      status: "AVAILABLE",
    },
  });

  const operator = await prisma.chargerOperator.create({
    data: {
      slug: OPERATOR_SLUG,
      displayName: "E2E Mobile Charge Network",
      claimedById: seller.id,
      claimedAt: new Date(),
    },
  });
  await prisma.operatorAccounting.create({
    data: { operatorId: operator.id, legalName: "E2E Mobile Charge Network s.r.o." },
  });

  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId: operator.id,
      type: "CHARGING_STATION",
      name: "E2E Charge Depot",
      status: "PUBLISHED",
      country: "SK",
      city: "Bratislava",
      addressLine: "Testovacia 1",
      latitude: 48.15,
      longitude: 17.1,
      gridZoneId: zoneId,
      open24: true,
      publishedAt: new Date(),
      connectors: {
        create: [
          { type: "CCS2", powerKw: new Prisma.Decimal(150), quantity: 1, status: "FREE" },
        ],
      },
      tariffs: {
        create: [
          {
            priceFiat: new Prisma.Decimal(0.3),
            priceTokens: new Prisma.Decimal(1),
            currency: "EUR",
          },
        ],
      },
    },
    include: { connectors: true },
  });
  pointId = point.id;
  connectorId = point.connectors[0]!.id;

  // Ключ оборудования — строкой в базе, без секрета подписи: сервисный код
  // кабинета сюда не импортируется (Playwright запускается не как модуль
  // приложения). Ветка с подписью HMAC закрыта юнит-тестами
  // `charge-session.test.ts`, здесь проверяется сам путь по HTTP.
  pointToken = `pwp_e2e_${randomBytes(16).toString("base64url")}`;
  signingSecret = null;
  await prisma.pointApiKey.create({
    data: {
      pointId,
      label: "e2e",
      tokenHash: createHash("sha256").update(pointToken).digest("hex"),
      prefix: pointToken.slice(0, 10),
    },
  });
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({
    where: { username: { in: [USER.username, SELLER.username] } },
  });
  await prisma.$disconnect();
});

test("a stranger's QR is refused instead of opening an empty quote", async ({ page }) => {
  await signInWithPassword(page, USER, "ru");
  await page.goto("/ru/app/charge");

  await page.getByTestId("qr-manual").fill("OCPI:FR*ABC*E1234");
  await page.getByTestId("qr-manual-submit").click();
  await expect(page.getByTestId("qr-error")).toContainText("не код Poolwatt");
});

test("a meter report with somebody else's token is refused", async () => {
  const base = process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com";
  const response = await fetch(`${base}/api/v1/charge-sessions/whatever/meter`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer pwp_nonsense" },
    body: JSON.stringify({ kwhTotal: 1 }),
  });
  expect(response.status).toBe(401);
});

test("the code leads to the §16.6 breakdown before anything is agreed", async ({ page }) => {
  await signInWithPassword(page, USER, "ru");
  await page.goto("/ru/app/charge");

  await page.getByTestId("qr-manual").fill(`PW1:${pointId}:${connectorId}`);
  await page.getByTestId("qr-manual-submit").click();

  await page.waitForURL(/\/app\/charge\/start/);
  await expect(page.getByTestId("charge-point-name")).toHaveText("E2E Charge Depot");
  // 10 кВт·ч при балансе 20 целиком со своего баланса: платить нечего.
  await expect(page.getByTestId("charge-breakdown")).toContainText("Свой баланс");
  await expect(page.getByTestId("charge-breakdown")).toContainText("10.000 kWh");
  await expect(page.getByTestId("charge-total")).toContainText("0.00 EUR");
  await expect(page.getByTestId("charge-start")).toBeVisible();
});

test("from the code to the receipt: the meter moves the figure on the screen", async ({
  page,
}) => {
  await signInWithPassword(page, USER, "ru");
  await page.goto(`/ru/app/charge/start?p=${pointId}&c=${connectorId}&kwh=10`);

  await page.getByTestId("charge-start").click();

  // Экран зарядки: цифра есть сразу, нулём — это настоящий ноль.
  await expect(page.getByTestId("charge-live")).toBeVisible();
  await expect(page.getByTestId("charge-delivered")).toHaveText("0.000");
  await expect(page.getByTestId("charge-waiting")).toBeVisible();

  const session = await prisma.chargeSession.findFirstOrThrow({
    where: { pointId, status: { in: ["AUTHORIZED", "ACTIVE"] } },
    orderBy: { createdAt: "desc" },
  });

  // Оборудование отчитывается — и цифра двигается без перезагрузки (§15).
  await reportMeter(session.id, 4.5, 48);
  await expect(page.getByTestId("charge-delivered")).toHaveText("4.500", {
    timeout: 20_000,
  });

  await page.getByTestId("charge-stop").click();

  // Чек §46 на то, что выдано, а не на то, что планировалось.
  await expect(page.getByTestId("charge-finished")).toContainText("4.500 kWh");
  const link = page.getByTestId("charge-receipt-link");
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByTestId("receipt")).toBeVisible();

  const payment = await prisma.payment.findFirstOrThrow({
    where: { pointId },
    orderBy: { createdAt: "desc" },
  });
  expect(Number(payment.requestedKwh)).toBe(4.5);
  expect(payment.connectorId).toBe(connectorId);
  expect(payment.status).toBe("CAPTURED");

  // Разъём снова свободен, иначе следующий водитель его не получит.
  const connector = await prisma.pointConnector.findUniqueOrThrow({
    where: { id: connectorId },
  });
  expect(connector.status).toBe("FREE");
});
