// M3-б-2 — полная карточка пункта на телефоне: блоки §28, фотография,
// отзыв от того, кто здесь заряжался, история доступности и бронь с её
// продлением (US-31).

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const prisma = new PrismaClient();

const DRIVER = { username: "e2e_mobcard_driver", password: "Pass1234" };
const STRANGER = { username: "e2e_mobcard_stranger", password: "Pass1234" };
const OWNER = { username: "e2e_mobcard_owner", password: "Pass1234" };
const SLUG = "e2e-mobcard-net";
const ZONE = "E2EMOBCARD";
const COOP = "e2e-mobcard-coop";

let pointId: string;
let coopOnlyPointId: string;
let connectorId: string;
let photoId: string;
let driverUserId: string;
let driverWalletId: string;
let reservationId: string;

test.describe.configure({ mode: "serial" });

// Через настоящий домен: фотографию отдаёт маршрут за nginx, и именно так её
// видит оболочка приложения.
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.chargeSession.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.reservation.deleteMany({ where: { point: { operator: { slug: SLUG } } } });
  await prisma.pointReview.deleteMany({ where: { point: { operator: { slug: SLUG } } } });
  await prisma.connectorStatusLog.deleteMany({
    where: { connector: { point: { operator: { slug: SLUG } } } },
  });
  await prisma.pointPhoto.deleteMany({ where: { point: { operator: { slug: SLUG } } } });
  await prisma.reservationPolicy.deleteMany({
    where: { point: { operator: { slug: SLUG } } },
  });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.coopMember.deleteMany({ where: { coop: { name: COOP } } });
  await prisma.cooperative.deleteMany({ where: { name: COOP } });
  await prisma.company.deleteMany({ where: { regNumber: `${COOP}-reg` } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
}

const DAY = 86_400_000;

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

  const ownerUserId = await user(OWNER.username);
  driverUserId = await user(DRIVER.username);
  await user(STRANGER.username);

  const zone = await prisma.gridZone.create({
    data: { code: ZONE, country: "SK", name: "E2E mobile card zone", currency: "EUR" },
  });

  const operator = await prisma.chargerOperator.create({
    data: {
      slug: SLUG,
      displayName: "E2E Mobile Card Network",
      description: "A network that filled in its card",
      websiteUrl: "https://mobcard.example",
      email: "hello@mobcard.example",
      phone: "+421911000000",
      claimedById: ownerUserId,
      claimedAt: new Date(),
      accounting: {
        create: { legalName: "E2E Mobile Card Network s.r.o.", vatNumber: "SK9999999999" },
      },
    },
  });

  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId: operator.id,
      type: "CHARGING_STATION",
      name: "E2E Mobile Card Depot",
      status: "PUBLISHED",
      visibility: "PUBLIC",
      country: "SK",
      city: "Žilina",
      addressLine: "Kartová 7",
      latitude: 49.223,
      longitude: 18.74,
      gridZoneId: zone.id,
      howToFind: "level -1, by the lift",
      energySource: "WIND",
      goCertificateRef: "GO-E2E-0001",
      storageKwh: new Prisma.Decimal(60),
      open24: false,
      openHours: [
        { from: "08:00", to: "20:00" },
        { from: "08:00", to: "20:00" },
        { from: "08:00", to: "20:00" },
        { from: "08:00", to: "20:00" },
        { from: "08:00", to: "20:00" },
        { from: "10:00", to: "16:00" },
        null,
      ],
      holidayNote: "Closed on 1 January",
      paymentMethods: ["TOKEN", "WHITE_LABEL_CARD"],
      amenities: ["PARKING", "CAFE"],
      ocppVersion: "1.6",
      publishedAt: new Date(),
      lastSeenAt: new Date(),
      connectors: {
        create: [
          { type: "CCS2", powerKw: new Prisma.Decimal(150), quantity: 2, currentAc: false, status: "FREE" },
        ],
      },
      tariffs: {
        create: [
          {
            label: "flat",
            fromMinute: 0,
            toMinute: 1440,
            priceFiat: new Prisma.Decimal("0.3100"),
            priceTokens: new Prisma.Decimal("1.0400"),
            idleFeePerMin: new Prisma.Decimal("0.0500"),
            coopDiscount: 15,
            currency: "EUR",
          },
        ],
      },
      policy: {
        create: {
          enabled: true,
          waitMinutes: 15,
          extendAllowed: true,
          extendFeeFiat: new Prisma.Decimal(0),
          feeFiat: new Prisma.Decimal(0),
          guaranteeFiat: new Prisma.Decimal(0),
          noShowPenaltyFiat: new Prisma.Decimal(0),
        },
      },
    },
    include: { connectors: true },
  });
  pointId = point.id;
  connectorId = point.connectors[0]!.id;

  // §27 «история доступности» — две смены на прошлой неделе.
  await prisma.connectorStatusLog.createMany({
    data: [
      {
        connectorId,
        pointId,
        status: "BUSY",
        at: new Date(Date.now() - 5 * DAY),
        source: "equipment",
      },
      {
        connectorId,
        pointId,
        status: "FREE",
        at: new Date(Date.now() - 4 * DAY),
        source: "equipment",
      },
    ],
  });

  // Фотография: строка в базе и файл там, где его ищет маршрут отдачи.
  // Служба `savePointPhoto` здесь не вызывается — Playwright грузит этот файл
  // как CommonJS и не умеет взять модуль из src.
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(256, 9),
  ]);
  const storageKey = randomBytes(12).toString("hex");
  const photosRoot = process.env.POINT_PHOTOS_DIR || "var/point-photos";
  await mkdir(join(photosRoot, pointId), { recursive: true });
  await writeFile(join(photosRoot, pointId, storageKey), jpeg, { mode: 0o600 });
  photoId = (
    await prisma.pointPhoto.create({
      data: {
        pointId,
        storageKey,
        contentType: "image/jpeg",
        sizeBytes: jpeg.length,
        position: 0,
      },
    })
  ).id;

  driverWalletId = (
    await prisma.wallet.create({
      data: {
        ownerUserId: driverUserId,
        zoneId: zone.id,
        currency: "EUR",
        fiatBalance: new Prisma.Decimal(50),
      },
    })
  ).id;

  // Водитель здесь заряжался — отсюда его право на отзыв.
  await prisma.chargeSession.create({
    data: {
      userId: driverUserId,
      pointId,
      connectorId,
      zoneId: zone.id,
      walletId: driverWalletId,
      status: "COMPLETED",
      plannedKwh: new Prisma.Decimal(10),
      deliveredKwh: new Prisma.Decimal(10),
    },
  });

  // §34 просит водителя с KYC — у нас это членство в кооперативе.
  const company = await prisma.company.create({
    data: {
      legalName: "E2E mobile card coop",
      country: "SK",
      regNumber: `${COOP}-reg`,
      type: "COOPERATIVE",
      kybStatus: "APPROVED",
    },
  });
  const coop = await prisma.cooperative.create({
    data: { companyId: company.id, zoneId: zone.id, name: COOP },
  });
  await prisma.coopMember.create({
    data: {
      coopId: coop.id,
      userId: driverUserId,
      status: "ACTIVE",
      shares: 1,
      kycVerifiedAt: new Date(),
    },
  });

  // Живая бронь, окно которой закрывается через пять минут.
  const end = new Date(Date.now() + 5 * 60_000);
  reservationId = (
    await prisma.reservation.create({
      data: {
        userId: driverUserId,
        pointId,
        connectorId,
        walletId: driverWalletId,
        eta: new Date(end.getTime() - 15 * 60_000),
        windowStart: new Date(end.getTime() - 15 * 60_000),
        windowEnd: end,
        feeFiat: new Prisma.Decimal(0),
        guaranteeFiat: new Prisma.Decimal(0),
        noShowPenaltyFiat: new Prisma.Decimal(0),
        freeCancelMinutes: 30,
        currency: "EUR",
        status: "ACTIVE",
      },
    })
  ).id;

  // Карточка только для членов кооператива — чтобы проверить отказ.
  const coopOnly = await prisma.acceptancePoint.create({
    data: {
      operatorId: operator.id,
      type: "POWERBANK",
      name: "E2E Members Depot",
      status: "PUBLISHED",
      visibility: "COOP_MEMBERS",
      country: "SK",
      latitude: 49.224,
      longitude: 18.741,
      paymentMethods: ["TOKEN"],
      publishedAt: new Date(),
    },
  });
  coopOnlyPointId = coopOnly.id;
});

test.afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

test("the card shows every block of §28", async ({ page }) => {
  await page.goto(`/ru/app/c/${pointId}`);

  await expect(page.getByRole("heading", { name: "E2E Mobile Card Depot" })).toBeVisible();
  // Тарифы: окно, цена в деньгах и в токенах, простой, скидка кооперативу.
  const tariffs = page.getByTestId("card-tariffs");
  await expect(tariffs).toContainText("0.310");
  await expect(tariffs).toContainText("1.040");
  await expect(tariffs).toContainText("действует сейчас");
  await expect(tariffs).toContainText("15%");

  // Оборудование, режим работы, оплата, удобства, источник, владелец.
  await expect(page.getByTestId("card-equipment")).toContainText("150 kW");
  await expect(page.getByTestId("card-hours")).toContainText("Понедельник");
  await expect(page.getByTestId("card-hours")).toContainText("закрыто");
  await expect(page.getByTestId("card-payment")).toContainText("White label");
  await expect(page.getByTestId("card-amenities")).toContainText("Парковка");
  await expect(page.getByTestId("card-source")).toContainText("Ветер");
  await expect(page.getByTestId("card-source")).toContainText("GO-E2E-0001");
  await expect(page.getByTestId("card-owner")).toContainText("SK9999999999");
  await expect(page.getByTestId("card-owner")).toContainText("+421911000000");
  // «Как найти» и действия.
  await expect(page.getByText("level -1, by the lift")).toBeVisible();
  await expect(page.getByTestId("card-charge")).toBeVisible();
  await expect(page.getByTestId("card-report")).toBeVisible();
});

test("a photo is served by its own address", async ({ page }) => {
  const res = await page.request.get(`/api/v1/points/${pointId}/photos/${photoId}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/jpeg");

  await page.goto(`/ru/app/c/${pointId}`);
  await expect(page.getByTestId("card-photos")).toBeVisible();
});

test("the seven-day availability strip is drawn", async ({ page }) => {
  await page.goto(`/ru/app/c/${pointId}`);
  const history = page.getByTestId("card-history");
  await expect(history).toBeVisible();
  await expect(history).toContainText("CCS2");
  await expect(history).toContainText("Последнее изменение");
});

test("somebody who has never charged here sees no review form", async ({ page }) => {
  await page.goto(`/ru/app/c/${pointId}`);
  await expect(page.getByTestId("review-right")).toBeVisible();
  await expect(page.getByTestId("review-form")).toHaveCount(0);
});

test("the driver who charged here leaves a review and sees it", async ({ page }) => {
  await signInWithPassword(page, DRIVER, "ru");
  await page.goto(`/ru/app/c/${pointId}`);

  const form = page.getByTestId("review-form");
  await expect(form).toBeVisible();
  await form.getByTestId("review-star-4").click();
  await form.getByTestId("review-text").fill("Кабель короткий, но заряжает быстро");
  await form.getByTestId("review-send").click();
  await expect(form.getByTestId("review-saved")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("reviews-average")).toContainText("4.0");
  await expect(page.getByTestId("card-reviews")).toContainText("Кабель короткий");
});

test("a members-only card does not exist for a stranger", async ({ page }) => {
  const res = await page.goto(`/ru/app/c/${coopOnlyPointId}`);
  expect(res?.status()).toBe(404);
});

test("the booking is extended from the phone", async ({ page }) => {
  await signInWithPassword(page, DRIVER, "ru");
  await page.goto("/ru/app/bookings");

  const before = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
  await expect(page.getByTestId("booking-list")).toContainText("E2E Mobile Card Depot");
  await page.getByTestId("extend-booking").first().click();

  await expect
    .poll(async () => {
      const after = await prisma.reservation.findUniqueOrThrow({
        where: { id: reservationId },
      });
      return after.windowEnd.getTime();
    })
    .toBeGreaterThan(before.windowEnd.getTime());
});
