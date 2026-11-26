// M3-б-1 — карта §27 так, как её открывает водитель: кластеры, девять
// фильтров, мини-карточка по тапу, маршрут в четыре навигатора и переход на
// расчёт зарядки.
//
// Карта рисуется в canvas, и тапнуть «вот тот пин» из теста нечем: экран
// поэтому принимает `?open=<id>` и открывает мини-карточку сразу. Это и
// проверяемо, и полезно само — так на пункт можно дать ссылку с карты.

import { test, expect } from "@playwright/test";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const OPERATOR_SLUG = "e2e-mobnav-net";
// Своё место на карте, подальше от прочих тестов.
const LAT = 48.63;
const LNG = 19.14;

let pointId: string;
let powerbankId: string;

test.describe.configure({ mode: "serial" });

// Через настоящий домен: карта тянет стиль Carto и `/api/chargers` за
// nginx, и именно так её видит оболочка приложения.
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: OPERATOR_SLUG } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: OPERATOR_SLUG } });
}

test.beforeAll(async () => {
  await wipe();

  const operator = await prisma.chargerOperator.create({
    data: { slug: OPERATOR_SLUG, displayName: "E2E Navigator Network" },
  });

  const station = await prisma.acceptancePoint.create({
    data: {
      operatorId: operator.id,
      type: "CHARGING_STATION",
      name: "E2E Nav Depot",
      status: "PUBLISHED",
      visibility: "PUBLIC",
      country: "SK",
      city: "Banská Bystrica",
      addressLine: "Navigačná 1",
      latitude: LAT,
      longitude: LNG,
      energySource: "SOLAR",
      open24: true,
      paymentMethods: ["TOKEN", "WHITE_LABEL_CARD"],
      publishedAt: new Date(),
      connectors: {
        create: [
          { type: "CCS2", powerKw: new Prisma.Decimal(150), quantity: 2, status: "FREE" },
        ],
      },
      tariffs: {
        create: [
          {
            fromMinute: 0,
            toMinute: 1440,
            priceFiat: new Prisma.Decimal("0.2800"),
            priceTokens: new Prisma.Decimal("1.0500"),
            currency: "EUR",
          },
        ],
      },
    },
  });
  pointId = station.id;

  // Второй пункт другого типа и из сети — чтобы фильтры было чем сузить.
  const powerbank = await prisma.acceptancePoint.create({
    data: {
      operatorId: operator.id,
      type: "POWERBANK",
      name: "E2E Nav Powerbank",
      status: "PUBLISHED",
      visibility: "PUBLIC",
      country: "SK",
      city: "Banská Bystrica",
      addressLine: "Navigačná 2",
      latitude: LAT + 0.004,
      longitude: LNG + 0.004,
      energySource: "GRID",
      open24: false,
      paymentMethods: ["TOKEN"],
      publishedAt: new Date(),
      connectors: {
        create: [
          { type: "SCHUKO", powerKw: new Prisma.Decimal(3.7), quantity: 1, status: "BUSY" },
        ],
      },
      tariffs: {
        create: [
          {
            fromMinute: 0,
            toMinute: 1440,
            priceFiat: new Prisma.Decimal("0.4000"),
            currency: "EUR",
          },
        ],
      },
    },
  });
  powerbankId = powerbank.id;
});

test.afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const view = `lat=${LAT}&lng=${LNG}&z=14`;

test("the map opens and draws", async ({ page }) => {
  await page.goto(`/ru/app/map?${view}`);

  await expect(page.getByTestId("point-map")).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible();
  // Выдача пришла: строка со счётчиком перестала писать «Загружаем…».
  await expect(page.getByTestId("map-count")).not.toHaveText(/Загружаем/, {
    timeout: 20_000,
  });
});

test("a filter narrows the result, stays in the address and says it hid foreign pins", async ({
  page,
}) => {
  await page.goto(`/ru/app/map?${view}`);
  await expect(page.getByTestId("point-map")).toBeVisible();

  await page.getByTestId("map-filters").click();
  await page.getByTestId("filter-type").selectOption("POWERBANK");
  await page.getByTestId("filters-apply").click();

  await expect(page).toHaveURL(/type=POWERBANK/);
  await expect(page.getByTestId("ours-only")).toBeVisible();
  await expect(page.getByTestId("map-count")).toHaveText(/^1 /, { timeout: 20_000 });
});

test("filters arrive from the address and the badge counts them", async ({ page }) => {
  await page.goto(`/ru/app/map?${view}&free=1&type=CHARGING_STATION`);

  await expect(page.getByTestId("map-filters")).toContainText("2");
  await page.getByTestId("map-filters").click();
  await expect(page.getByTestId("filter-type")).toHaveValue("CHARGING_STATION");
  await expect(page.getByTestId("filter-free")).toBeChecked();
});

test("the mini-card of our point offers a route and charging", async ({ page }) => {
  await page.goto(`/ru/app/map?${view}&open=${pointId}`);

  const card = page.getByTestId("mini-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("E2E Nav Depot");
  // §27 — цена в деньгах и в токенах, и сколько разъёмов свободно.
  await expect(card).toContainText("0.280");
  await expect(card).toContainText("1.050");
  await expect(card).toContainText("Свободен");

  await card.getByTestId("mini-charge").click();
  await expect(page).toHaveURL(new RegExp(`/ru/app/charge/start\\?p=${pointId}`));
});

test("the route button asks which navigator to open", async ({ page }) => {
  await page.goto(`/ru/app/map?${view}&open=${pointId}`);

  await page.getByTestId("mini-card").getByTestId("route-button").click();
  const sheet = page.getByTestId("route-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("route-system")).toBeVisible();
  await expect(sheet.getByTestId("route-google")).toBeVisible();
  await expect(sheet.getByTestId("route-apple")).toBeVisible();
  await expect(sheet.getByTestId("route-waze")).toBeVisible();
});

test("a busy point says so, and the charge tab leads to the map", async ({ page }) => {
  await page.goto(`/ru/app/map?${view}&open=${powerbankId}`);
  await expect(page.getByTestId("mini-card")).toContainText("Занят");

  await page.goto("/ru/app/charge");
  await page.getByTestId("open-map").click();
  await expect(page).toHaveURL(/\/ru\/app\/map$/);
  await expect(page.getByTestId("point-map")).toBeVisible();
});
