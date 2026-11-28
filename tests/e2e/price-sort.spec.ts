// Сортировка по цене на странице зарядок.
//
// До 2026-11-28 выпадающий список жил в боковой колонке и проверялся по
// `#sort`. Колонки больше нет: три раздела, а сортировка — в панели фильтров
// рядом со страной и разъёмом. Смысл проверки тот же: водителю предложена
// сортировка по цене, она остаётся в адресе, и станции с ценой встают первыми.

import { test, expect } from "@playwright/test";

test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

test("водителю предложена сортировка по цене, и она держится в адресе", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/ru/navigator");
  await expect(page.getByTestId("station-row").first()).toBeVisible({
    timeout: 30_000,
  });

  await page.getByTestId("navigator-filters").click();
  const sort = page.getByTestId("filter-sort");
  await expect(sort).toBeVisible();
  await sort.selectOption("priceAsc");

  await expect(page).toHaveURL(/sort=priceAsc/);
  await expect(page.getByTestId("station-row").first()).toBeVisible();

  // Если цена известна хоть у одной станции, она стоит первой.
  const rows = page.getByTestId("station-row");
  const withPrice = rows.filter({ hasText: "/kWh" });
  if ((await withPrice.count()) > 0) {
    await expect(rows.first()).toContainText("/kWh");
  }
});
