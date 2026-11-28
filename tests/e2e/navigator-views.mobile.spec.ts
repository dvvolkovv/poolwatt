// §27 на телефоне. Беда, ради которой переписана страница: до 2026-11-28 она
// была `fixed inset-0 flex` с колонкой списка в жёстких 380 точек и картой
// справа. На экране 360 точек колонка занимала весь экран, а карта целиком
// уезжала за правый край — водитель с телефона её не видел.
//
// Поэтому проверяется не «класс на месте», а то, что видит палец: список во
// всю ширину, карточка во весь экран и обратно, и ничто не вылезает за край.

import { test, expect } from "@playwright/test";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const SLUG = "e2e-nav-views-mobile";
const LAT = 48.1612;
const LNG = 17.0944;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

test.beforeAll(async () => {
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  const operator = await prisma.chargerOperator.create({
    data: { slug: SLUG, displayName: "E2E Mobile Network" },
  });
  await prisma.acceptancePoint.create({
    data: {
      operatorId: operator.id,
      type: "CHARGING_STATION",
      name: "E2E Mobile Station",
      status: "PUBLISHED",
      publishedAt: new Date(),
      country: "SK",
      city: "Bratislava",
      addressLine: "Mobile 1",
      latitude: LAT,
      longitude: LNG,
      howToFind: "by the bus stop",
      energySource: "SOLAR",
      open24: true,
      paymentMethods: ["TOKEN", "QR"],
      connectors: {
        create: [
          {
            type: "CCS2",
            powerKw: new Prisma.Decimal(120),
            currentAc: false,
            quantity: 1,
            status: "FREE",
            statusAt: new Date(),
          },
        ],
      },
    },
  });
});

test.afterAll(async () => {
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.$disconnect();
});

/**
 * На сколько точек что-нибудь **видимое** вылезает за край экрана.
 *
 * Прямоугольник узла обрезается всеми предками, которые прячут выступающее:
 * метка на карте у правого края формально выходит за экран, но карта её
 * обрезает, и ни потянуть страницу, ни увидеть эту метку нельзя. Считать её
 * переполнением — гонять себя за призраком.
 */
async function overflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    let worst = 0;
    let who = "";
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;

      let left = r.left;
      let right = r.right;
      for (
        let parent = el.parentElement;
        parent && left < right;
        parent = parent.parentElement
      ) {
        if (getComputedStyle(parent).overflowX === "visible") continue;
        const pr = parent.getBoundingClientRect();
        left = Math.max(left, pr.left);
        right = Math.min(right, pr.right);
      }
      if (left >= right) continue;

      const out = Math.max(right - vw, -left);
      if (out > worst) {
        worst = out;
        who = `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 120);
      }
    }
    return { out: Math.round(Math.max(0, worst)), who };
  });
}

test("список станций занимает весь экран телефона", async ({ page }) => {
  await page.goto("/ru/navigator");
  const row = page.getByTestId("station-row").first();
  await expect(row).toBeVisible({ timeout: 20_000 });

  const box = await row.boundingBox();
  const width = page.viewportSize()!.width;
  // Во всю ширину, а не в половину поля, как было с боковой колонкой.
  expect(box!.width).toBeGreaterThan(width * 0.9);
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

test("карточка станции открывается во весь экран и закрывается", async ({ page }) => {
  await page.goto("/ru/navigator");
  await expect(page.getByText("E2E Mobile Station")).toBeVisible({ timeout: 20_000 });
  await page.getByText("E2E Mobile Station").click();

  const sheet = page.getByTestId("station-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("station-payments")).toContainText("Токены кВт·ч");
  await expect(sheet.getByTestId("route-button")).toBeVisible();

  await sheet.getByTestId("station-card-close").click();
  await expect(page.getByTestId("station-sheet")).toHaveCount(0);
  await expect(page.getByTestId("station-list")).toBeVisible();
});

test("карта — отдельный раздел и занимает экран целиком", async ({ page }) => {
  await page.goto("/ru/navigator");
  await page.getByTestId("view-map").click();

  const canvas = page.locator("canvas.maplibregl-canvas");
  await expect(canvas).toBeVisible({ timeout: 20_000 });

  const box = await canvas.boundingBox();
  const width = page.viewportSize()!.width;
  // Карта на экране, а не за его правым краем — ровно то, что было сломано.
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.width).toBeGreaterThan(width * 0.9);
});

for (const width of [360, 412]) {
  test(`на экране ${width} ничто не вылезает за край`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    for (const path of ["/ru/navigator", "/ru/navigator?view=operators", "/ru/navigator?view=map"]) {
      await page.goto(path);
      await page.waitForTimeout(2500);
      const { out, who } = await overflow(page);
      expect(out, `${path}: за край вылезает ${who}`).toBeLessThanOrEqual(1);
    }
  });
}
