// Сервис-воркер §25 кэширует сборку «сначала из кэша» и живёт на всём сайте:
// зарегистрирован он на `/<язык>/app` (его же открывает приложение Android),
// но область у него — корень, поэтому он отвечает и за главную страницу.
//
// Отсюда беда, из-за которой владелец 2026-11-28 не смог открыть главную.
// Старый воркер клал в кэш **любой** ответ, включая 404 или 503, которые
// браузер получает в те секунды, пока идёт пересборка сайта. Запись
// оставалась там навсегда — файлы сборки читаются только из кэша и никогда не
// перепроверяются, — и телефон на каждой странице получал вместо кода пустой
// 404. Страница после этого не оживала, сколько её ни перезагружай.
//
// Тест воспроизводит ровно это: портит запись в кэше и требует, чтобы сайт
// всё равно работал — чтобы по нажатию открывалась панель меню, то есть
// чтобы код страницы на самом деле выполнился.

import { test, expect } from "@playwright/test";

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

test("испорченная запись в кэше не ломает сайт", async ({ page }) => {
  // Воркер ставится на экранах приложения — там же, где его ставит оболочка
  // Android.
  await page.goto("/ru/app");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    // Дождаться, пока воркер начнёт отвечать за эту страницу.
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", () =>
          resolve(),
        ),
      );
    }
  });

  // Любой настоящий файл сборки, который нужен странице.
  const chunk = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .find((n) => n.includes("/_next/static/chunks/") && n.endsWith(".js")),
  );
  expect(chunk, "страница должна грузить хотя бы один файл сборки").toBeTruthy();

  // Портим его так, как это делала пересборка: 404 вместо кода.
  const poisoned = await page.evaluate(async (url) => {
    const keys = await caches.keys();
    for (const key of keys) {
      const cache = await caches.open(key);
      await cache.put(url!, new Response("", { status: 404 }));
    }
    return keys.length;
  }, chunk);
  expect(poisoned).toBeGreaterThan(0);

  // Теперь главная. Она обязана ожить: панель меню открывается только если
  // код страницы выполнился.
  await page.goto("/ru");
  const button = page.getByTestId("site-menu-button");
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.getByTestId("site-menu-panel")).toBeVisible();
});

test("воркер не кладёт в кэш неудачный ответ", async ({ page }) => {
  await page.goto("/ru/app");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  // Файла с таким именем нет — сервер ответит 404. В кэше он остаться не
  // должен, иначе та же беда вернётся при следующей пересборке.
  const stored = await page.evaluate(async () => {
    const url = "/_next/static/chunks/this-one-does-not-exist.js";
    await fetch(url).catch(() => undefined);
    const hit = await caches.match(url);
    return hit ? hit.status : null;
  });
  expect(stored).toBeNull();
});
