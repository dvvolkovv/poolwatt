// Плиточный кабинет на телефоне — так, как его проходит человек.
//
// До этой работы навигация кабинета на телефоне была полосой из десяти
// текстовых ссылок с горизонтальной прокруткой, одинаковой для всех: «Моя
// компания», «Подрядчик» и «Наряды» стояли и у свежего аккаунта, у которого
// ничего из этого нет, и вели на пустые страницы. Поэтому здесь два главных
// случая: плитки есть и они квадратные, и плиток, за которыми пусто, нет.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const USER = { username: "e2e_tile_cabinet", password: "Pass1234" };

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

test.beforeAll(async () => {
  const hash = await bcrypt.hash(USER.password, 10);
  await prisma.user.upsert({
    where: { username: USER.username },
    update: { passwordHash: hash, tileAccent: "accent", tileOrder: undefined },
    create: { username: USER.username, passwordHash: hash },
  });
});

test.afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: USER.username } });
  await prisma.$disconnect();
});

test("у кабинета есть заголовок, и плитки квадратные", async ({ page }) => {
  await signInWithPassword(page, USER, "ru");
  await page.goto("/ru/me");

  // Квадрат с именем человека стоял во главе доски до 2026-11-28. Владелец
  // попросил его убрать: учётная запись живёт в шапке, а у страницы остался
  // заголовок и бейдж статуса.
  await expect(page.getByTestId("tile-user")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("status-badge")).toBeVisible();

  const wallet = page.getByTestId("tile-wallet");
  await expect(wallet).toBeVisible();
  const box = await wallet.boundingBox();
  // Квадрат с допуском на округление строки.
  expect(Math.abs(box!.width - box!.height)).toBeLessThan(4);
  expect(box!.width).toBeGreaterThanOrEqual(44);
});

test("плитки, за которыми пусто, нет вовсе", async ({ page }) => {
  await signInWithPassword(page, USER, "ru");
  await page.goto("/ru/me");

  // Свежий аккаунт: ни компании, ни сети, ни бригады, ни кооператива.
  await expect(page.getByTestId("tile-company")).toHaveCount(0);
  await expect(page.getByTestId("tile-network")).toHaveCount(0);
  await expect(page.getByTestId("tile-workOrders")).toHaveCount(0);
  await expect(page.getByTestId("tile-coop")).toHaveCount(0);
  await expect(page.getByTestId("tile-operator")).toHaveCount(0);

  // А то, что есть у каждого, на месте.
  await expect(page.getByTestId("tile-support")).toBeVisible();
  await expect(page.getByTestId("tile-bookings")).toBeVisible();
});

test("плитка «Пополнить» не молчит о том, чего ждёт", async ({ page }) => {
  await signInWithPassword(page, USER, "ru");
  await page.goto("/ru/me");

  const topUp = page.getByTestId("tile-topUp");
  await expect(topUp).toBeVisible();
  await expect(topUp).toContainText("ждёт банка");
  await expect(topUp).toHaveAttribute("aria-disabled", "true");
});

test("никнейм в шапке открывает аккаунт, и кнопка возвращает", async ({
  page,
}) => {
  await signInWithPassword(page, USER, "ru");
  await page.goto("/ru/me");

  // На доме кабинета возвращаться некуда — кнопки нет.
  await expect(page.getByTestId("cabinet-back")).toHaveCount(0);

  await page.getByTestId("account-pill").click();
  await page.waitForURL("**/ru/me/g/account");
  await expect(page.getByTestId("tile-settings")).toBeVisible();
  await expect(page.getByTestId("tile-interface")).toBeVisible();
  await expect(page.getByTestId("tile-signOut")).toBeVisible();

  // Одна кнопка в шапке — и она ведёт домой.
  const back = page.getByTestId("cabinet-back");
  await expect(back).toBeVisible();
  await back.click();
  await page.waitForURL(/\/ru\/me$/);
  await expect(page.getByTestId("tile-wallet")).toBeVisible();
});

test("со страницы раздела кнопка ведёт на её доску", async ({ page }) => {
  await signInWithPassword(page, USER, "ru");

  await page.goto("/ru/me/settings/interface");
  const back = page.getByTestId("cabinet-back");
  // Настройки принадлежат доске аккаунта, а не дому.
  await expect(back).toHaveAttribute("href", "/ru/me/g/account");

  await page.goto("/ru/me/wallet");
  await expect(page.getByTestId("cabinet-back")).toHaveAttribute(
    "href",
    "/ru/me",
  );
});

test("доска оператора недоступна тому, кто не оператор", async ({ page }) => {
  await signInWithPassword(page, USER, "ru");
  const response = await page.goto("/ru/me/g/operator");
  expect(response?.status()).toBe(404);
});

test("выбранный цвет контура переживает перезагрузку", async ({ page }) => {
  await signInWithPassword(page, USER, "ru");
  await page.goto("/ru/me/settings/interface");

  await page.getByTestId("accent-green").click();
  await expect(page.getByTestId("accent-green")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByTestId("interface-save").click();

  // Ждём не «тишины в сети», а самого следствия: серверное действие под
  // нагрузкой всей сборки может быть ещё в пути, и `networkidle` этого не
  // знает.
  await expect
    .poll(
      async () =>
        (
          await prisma.user.findUnique({
            where: { username: USER.username },
            select: { tileAccent: true },
          })
        )?.tileAccent,
      { timeout: 15_000 },
    )
    .toBe("green");

  await page.reload();
  await expect(page.getByTestId("accent-green")).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("порядок, изменённый стрелкой, переживает перезагрузку", async ({
  page,
}) => {
  await signInWithPassword(page, USER, "ru");
  await page.goto("/ru/me/settings/interface");

  const rows = page.getByTestId("tile-order").locator("li");
  const firstKey = await rows.first().getAttribute("data-testid");
  const secondKey = await rows.nth(1).getAttribute("data-testid");
  expect(firstKey).not.toBe(secondKey);

  // Поднять вторую плитку наверх.
  await page
    .getByTestId(`order-up-${secondKey!.replace("order-row-", "")}`)
    .click();
  await page.getByTestId("interface-save").click();

  const expectedFirst = secondKey!.replace("order-row-", "");
  await expect
    .poll(
      async () => {
        const row = await prisma.user.findUnique({
          where: { username: USER.username },
          select: { tileOrder: true },
        });
        return Array.isArray(row?.tileOrder) ? row!.tileOrder[0] : null;
      },
      { timeout: 15_000 },
    )
    .toBe(expectedFirst);

  await page.reload();
  await expect(
    page.getByTestId("tile-order").locator("li").first(),
  ).toHaveAttribute("data-testid", secondKey!);

  // И на доме кабинета плитки стоят в том же порядке.
  await page.goto("/ru/me");
  const boardFirst = page
    .getByTestId("tile-board")
    .locator("[data-tile]")
    .first();
  await expect(boardFirst).toHaveAttribute(
    "data-testid",
    secondKey!.replace("order-row-", "tile-"),
  );
});

test("сброс порядка возвращает каталожный", async ({ page }) => {
  await signInWithPassword(page, USER, "ru");
  await page.goto("/ru/me/settings/interface");
  await page.getByTestId("interface-reset").click();

  await expect
    .poll(
      async () =>
        (
          await prisma.user.findUnique({
            where: { username: USER.username },
            select: { tileOrder: true },
          })
        )?.tileOrder,
      { timeout: 15_000 },
    )
    .toBeNull();

  await page.goto("/ru/me");
  await expect(
    page.getByTestId("tile-board").locator("[data-tile]").first(),
  ).toHaveAttribute("data-testid", "tile-wallet");
});
