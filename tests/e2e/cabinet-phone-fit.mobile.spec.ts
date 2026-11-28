// Кабинет глазами телефона. Владелец прошёл его 2026-11-28 и назвал ровно то,
// что здесь проверяется: в шапке лишнее (жёлтый значок `.energy`, выбор
// языка), из-за чего ряд шапки не влезал в экран и страница ездила
// вправо-влево; большая плитка с человеком занимала первый экран; плитки
// разделов стали мелкими.
//
// Главная проверка — не «класс на месте», а «страница не шире экрана»:
// `scrollWidth <= clientWidth`. Именно это владелец и увидел пальцем.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const USER = { username: "e2e_phone_fit", password: "Pass1234" };

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

test.beforeAll(async () => {
  const hash = await bcrypt.hash(USER.password, 10);
  await prisma.user.upsert({
    where: { username: USER.username },
    update: { passwordHash: hash, preferredLocale: "en" },
    create: { username: USER.username, passwordHash: hash },
  });
});

test.afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: USER.username } });
  await prisma.$disconnect();
});

/**
 * На сколько точек что-нибудь на странице вылезает за край экрана.
 *
 * Считается по самим узлам, а не по `scrollWidth` документа: `overflow-x:
 * clip` в `globals.css` прячет горизонтальную прокрутку, и `scrollWidth`
 * после него молчал бы даже о настоящем переполнении. Возвращается ещё и имя
 * виновника — иначе падение теста ничего не говорит о том, что править.
 */
async function overflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    let worst = 0;
    let who = "";
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const out = Math.max(r.right - vw, -r.left);
      if (out > worst) {
        worst = out;
        who = `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 120);
      }
    }
    return { out: Math.round(Math.max(0, worst)), who };
  });
}

test("в шапке нет ни значка .energy, ни выбора языка", async ({ page }) => {
  await page.goto("/ru");

  const header = page.locator("header").first();
  await expect(header).toBeVisible();
  await expect(header).toContainText("poolwatt");
  await expect(header).not.toContainText(".energy");
  // Выбор языка был `select` прямо в ряду шапки.
  await expect(header.locator("select")).toHaveCount(0);
});

test("гость всё же может сменить язык — из панели гамбургера", async ({
  page,
}) => {
  await page.goto("/ru");
  await page.getByTestId("site-menu-button").click();

  const picker = page.getByTestId("site-menu-language");
  await expect(picker).toBeVisible();
  await picker.selectOption("en");
  await page.waitForURL("**/en");
  await expect(page.locator("header").first()).toContainText("poolwatt");
});

test("никнейм в шапке ведёт в аккаунт, и там настройки", async ({ page }) => {
  await signInWithPassword(page, USER, "ru");
  await page.goto("/ru/me");

  const pill = page.getByTestId("account-pill");
  await expect(pill).toBeVisible();
  await expect(pill).toContainText(`@${USER.username}`);
  await expect(pill).toHaveAttribute("href", "/ru/me/g/account");

  await pill.click();
  await page.waitForURL("**/ru/me/g/account");
  await expect(page.getByTestId("tile-settings")).toBeVisible();
  await expect(page.getByTestId("tile-signOut")).toBeVisible();
});

test("большого квадрата с человеком на доме кабинета нет, а статус есть", async ({
  page,
}) => {
  await signInWithPassword(page, USER, "ru");
  await page.goto("/ru/me");

  await expect(page.getByTestId("tile-user")).toHaveCount(0);
  await expect(page.getByTestId("status-badge")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

// Два экрана: Pixel 7 (412) и узкий телефон (360). Беду, на которую
// пожаловался владелец, видно именно на узком: подвал из двенадцати колонок с
// промежутком 32 точки требовал 352 точки на одни промежутки и растягивал
// каждую страницу сайта, включая кабинет.
for (const width of [360, 412]) {
  for (const path of ["/ru", "/ru/me", "/ru/me/wallet", "/ru/me/settings"]) {
    test(`страница ${path} не шире экрана ${width}`, async ({ page }) => {
      await signInWithPassword(page, USER, "ru");
      await page.setViewportSize({ width, height: 740 });
      await page.goto(path);
      const { out, who } = await overflow(page);
      expect(out, `за край экрана вылезает ${who}`).toBeLessThanOrEqual(1);
    });
  }
}

test("плитки идут по две в ряд и крупные", async ({ page }) => {
  await signInWithPassword(page, USER, "ru");
  await page.goto("/ru/me");

  const tiles = page.getByTestId("tile-board").locator("[data-tile]");
  const first = await tiles.nth(0).boundingBox();
  const second = await tiles.nth(1).boundingBox();
  const third = await tiles.nth(2).boundingBox();

  // Две в ряд: вторая стоит рядом с первой, третья — ниже.
  expect(second!.y).toBeCloseTo(first!.y, 0);
  expect(third!.y).toBeGreaterThan(first!.y + first!.height - 1);

  // Квадрат и палец: не мельче 140 точек на экране Pixel 7 (412 шириной).
  expect(Math.abs(first!.width - first!.height)).toBeLessThan(4);
  expect(first!.width).toBeGreaterThanOrEqual(140);
});

test("язык выбирается в настройках и запоминается", async ({ page }) => {
  await signInWithPassword(page, USER, "ru");
  await page.goto("/ru/me/settings");

  const select = page.getByTestId("settings-language");
  await expect(select).toBeVisible();
  await select.selectOption("sk");
  await page.getByTestId("settings-language-save").click();

  await page.waitForURL("**/sk/me/settings");

  await expect
    .poll(
      async () =>
        (
          await prisma.user.findUnique({
            where: { username: USER.username },
            select: { preferredLocale: true },
          })
        )?.preferredLocale,
      { timeout: 15_000 },
    )
    .toBe("sk");
});
