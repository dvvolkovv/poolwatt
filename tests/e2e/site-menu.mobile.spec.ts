// Навигация сайта на телефоне. До этой работы её не было вовсе: ряд ссылок в
// шапке и кнопка «Войти» стояли под `hidden md:flex`, то есть с экрана
// телефона нельзя было ни дойти до зарядок, ни зайти в аккаунт.
//
// Тест идёт тем путём, которым идёт человек: открывает главную на Pixel 7,
// находит гамбургер, открывает панель, переходит по ссылке и смотрит, что
// страница ответила, а не упала в 404.

import { test, expect } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("на телефоне у сайта есть навигация и вход", async ({ page }) => {
  await page.goto("/ru");

  const button = page.getByTestId("site-menu-button");
  await expect(button).toBeVisible();

  // Площадь нажатия — не меньше 44×44: это палец, а не курсор.
  const box = await button.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);

  await expect(button).toHaveAttribute("aria-expanded", "false");
  await button.click();

  const panel = page.getByTestId("site-menu-panel");
  await expect(panel).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toHaveAttribute("aria-modal", "true");

  // Разделы и вход — внутри панели.
  await expect(
    panel.getByRole("link", { name: "Зарядные станции" }),
  ).toBeVisible();
  await expect(page.getByTestId("site-menu-signin")).toBeVisible();
});

test("Escape закрывает панель и возвращает фокус на кнопку", async ({
  page,
}) => {
  await page.goto("/ru");
  const button = page.getByTestId("site-menu-button");
  await button.click();
  await expect(page.getByTestId("site-menu-panel")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("site-menu-panel")).toHaveCount(0);
  await expect(button).toBeFocused();
});

test("ссылка из панели ведёт на живую страницу", async ({ page }) => {
  await page.goto("/ru");
  await page.getByTestId("site-menu-button").click();

  const link = page
    .getByTestId("site-menu-panel")
    .getByRole("link", { name: "Зарядные станции" });
  const href = await link.getAttribute("href");
  expect(href).toBe("/ru/navigator");

  await link.click();
  await page.waitForURL("**/ru/navigator");
  // Панель закрылась сама: адрес сменился.
  await expect(page.getByTestId("site-menu-panel")).toHaveCount(0);
  // У страницы есть имя. На карте заголовок скрытый — `fixed inset-0` не
  // оставляет ему места, — поэтому проверяется роль, а не видимость.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Зарядные станции",
  );
});

test("страница установки открывается на телефоне и ведёт на настоящий APK", async ({
  page,
  request,
}) => {
  await page.goto("/ru/install");
  await expect(page.locator("h1")).toContainText("Poolwatt");

  const apk = page.getByRole("link", { name: "Скачать APK" });
  await expect(apk).toBeVisible();
  const href = await apk.getAttribute("href");
  expect(href).toBe("/downloads/poolwatt.apk");

  // Файл действительно отдаётся, а не обещан. Каталог `/downloads/` держит
  // nginx, а не Next.js, поэтому спрашивать надо публичный хост: на
  // localhost:3000 этого адреса нет и быть не должно.
  const publicBase = process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com";
  const head = await request.head(`${publicBase}${href}`);
  expect(head.status()).toBe(200);

  // Шаги для iPhone на месте, и про TestFlight сказано словами.
  await expect(page.getByText("На экран „Домой“")).toBeVisible();
  await expect(page.getByText(/публичной ссылки нет/)).toBeVisible();
});
