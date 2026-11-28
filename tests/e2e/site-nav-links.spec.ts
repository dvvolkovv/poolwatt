// Ни одна ссылка меню и подвала не ведёт в 404.
//
// Этот тест существует потому, что до него вели: `/hubs`, `/offers` и
// `/watchlist` в шапке и `/hubs`, `/offers`, `/settings` в подвале — шесть
// ссылок на четыре несуществующих адреса, годами. Юнит-тест `site-nav.test.ts`
// сверяет адреса с файлами на диске; этот проверяет то же на живой сборке, где
// ответ может быть другим из-за middleware и прав.

import { test, expect } from "@playwright/test";

const GUEST_HREFS = [
  "/ru",
  "/ru/navigator",
  "/ru/exchange",
  "/ru/me/build-requests/new",
  "/ru/contractors",
  "/ru/install",
];

test("каждая ссылка меню гостя отвечает, а не отдаёт 404", async ({
  request,
}) => {
  for (const href of GUEST_HREFS) {
    const response = await request.get(href, { maxRedirects: 0 });
    // 200 — страница; 307 — уход на вход, что для раздела за входом верно.
    expect([200, 307, 308]).toContain(response.status());
  }
});

test("шапка и подвал главной не содержат мёртвых адресов", async ({
  page,
  request,
}) => {
  await page.goto("/ru");

  // Собираем все внутренние ссылки шапки и подвала так, как их видит человек.
  const hrefs = await page
    .locator("header a[href^='/'], footer a[href^='/']")
    .evaluateAll((nodes) =>
      Array.from(
        new Set(
          nodes
            .map((n) => (n as HTMLAnchorElement).getAttribute("href") ?? "")
            .filter((h) => h.startsWith("/") && !h.startsWith("//")),
        ),
      ),
    );

  expect(hrefs.length).toBeGreaterThan(5);

  const dead: string[] = [];
  for (const href of hrefs) {
    const response = await request.get(href, { maxRedirects: 0 });
    if (response.status() === 404) dead.push(href);
  }
  expect(dead).toEqual([]);
});

test("панель на мониторе открывает те же разделы", async ({ page }) => {
  await page.goto("/ru");
  await page.getByTestId("site-menu-button").click();
  const panel = page.getByTestId("site-menu-panel");
  await expect(panel).toBeVisible();
  await expect(
    panel.getByRole("link", { name: "Зарядные станции" }),
  ).toBeVisible();
  await expect(
    panel.getByRole("link", { name: "Поставить на телефон" }),
  ).toBeVisible();
});
