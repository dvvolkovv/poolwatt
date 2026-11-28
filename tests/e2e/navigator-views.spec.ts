// §27 на мониторе: три раздела страницы зарядок — станции, операторы, карта.
//
// Владелец прошёл её 2026-11-28 и попросил: открываться должен список, строка
// списка открывает карточку, в карточке — маршрут и то, чем там можно
// заплатить, а операторы и карта стоят рядом отдельными разделами.

import { test, expect } from "@playwright/test";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const SLUG = "e2e-nav-views";
const OPERATOR = "E2E Views Network";
// В области, которую страница показывает по умолчанию (центр карты —
// Братислава), иначе первый же запрос её не захватит.
const LAT = 48.1612;
const LNG = 17.0944;

let pointId: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

test.beforeAll(async () => {
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  const operator = await prisma.chargerOperator.create({
    data: { slug: SLUG, displayName: OPERATOR },
  });
  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId: operator.id,
      type: "CHARGING_STATION",
      name: "E2E Views Station",
      status: "PUBLISHED",
      publishedAt: new Date(),
      country: "SK",
      city: "Bratislava",
      addressLine: "Views 1",
      latitude: LAT,
      longitude: LNG,
      howToFind: "by the fountain",
      energySource: "SOLAR",
      open24: true,
      // §28 «Способы оплаты» — ради них половина этой работы.
      paymentMethods: ["TOKEN", "BANK_CARD"],
      connectors: {
        create: [
          {
            type: "CCS2",
            powerKw: new Prisma.Decimal(150),
            currentAc: false,
            quantity: 2,
            status: "FREE",
            statusAt: new Date(),
          },
        ],
      },
      tariffs: {
        create: [
          {
            fromMinute: 0,
            toMinute: 1440,
            priceFiat: new Prisma.Decimal(0.39),
            currency: "EUR",
            priceTokens: new Prisma.Decimal(1),
          },
        ],
      },
    },
  });
  pointId = point.id;
});

test.afterAll(async () => {
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.$disconnect();
});

test("страница открывается списком станций, а не картой", async ({ page }) => {
  await page.goto("/ru/navigator");

  await expect(page.getByTestId("view-list")).toHaveAttribute("aria-current", "true");
  await expect(page.getByTestId("view-operators")).toBeVisible();
  await expect(page.getByTestId("view-map")).toBeVisible();

  // Наши пункты приходят быстрым ответом, не дожидаясь OpenStreetMap.
  await expect(page.getByText("E2E Views Station")).toBeVisible({ timeout: 15_000 });
});

test("строка списка открывает карточку с оплатой и маршрутом", async ({ page }) => {
  await page.goto("/ru/navigator");
  await page.getByText("E2E Views Station").click();

  const card = page.getByTestId("station-card").first();
  await expect(card).toBeVisible();

  // Чем здесь можно заплатить — до поездки, а не на месте.
  const payments = page.getByTestId("station-payments").first();
  await expect(payments).toContainText("Токены кВт·ч");
  await expect(payments).toContainText("Банковская карта");

  // Маршрут в один тап и полная карточка §28.
  await expect(page.getByTestId("route-button").first()).toBeVisible();
  await expect(page.getByTestId("full-card-link").first()).toHaveAttribute(
    "href",
    `/ru/c/${pointId}`,
  );
});

test("раздел операторов сужает список до одного оператора", async ({ page }) => {
  await page.goto("/ru/navigator");
  await expect(page.getByText("E2E Views Station")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("view-operators").click();
  const row = page.getByTestId("operator-row").filter({ hasText: OPERATOR });
  await expect(row).toBeVisible();
  await row.click();

  // Вернулись к станциям, и в адресе остался выбранный оператор.
  await expect(page.getByTestId("view-list")).toHaveAttribute("aria-current", "true");
  await expect(page).toHaveURL(/operator=/);
  await expect(page.getByText("E2E Views Station")).toBeVisible();
  await expect(page.getByTestId("station-row")).toHaveCount(1);
});

test("раздел живёт в адресе: карту можно послать ссылкой", async ({ page }) => {
  await page.goto("/ru/navigator?view=map");
  await expect(page.getByTestId("view-map")).toHaveAttribute("aria-current", "true");
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("view-list").click();
  await expect(page).not.toHaveURL(/view=map/);
});

test("фильтр по стране остаётся в адресе и сужает выдачу", async ({ page }) => {
  await page.goto("/ru/navigator?country=SK");
  await expect(page.getByText("E2E Views Station")).toBeVisible({ timeout: 20_000 });

  await page.getByTestId("navigator-filters").click();
  await expect(page.getByTestId("filter-country")).toHaveValue("SK");
});
