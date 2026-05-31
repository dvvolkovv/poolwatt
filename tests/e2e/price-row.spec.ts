import { test, expect } from "@playwright/test";

// Step 1 verification: the "Price / kWh" row is now always rendered on the
// charger detail page and inside the navigator side-card. RU + SK strings
// come from messages/{ru,sk}.json.

test("detail page (RU) shows price row with OCM value when present", async ({ page }) => {
  // m1 = ZSE Drive Bratislava, costInfo = "0.39 €/kWh"
  await page.goto("https://poolwatt.com/ru/c/m1", { waitUntil: "networkidle" });
  await expect(page.getByText("Цена / кВт·ч")).toBeVisible();
  await expect(page.getByText("0.39 €/kWh")).toBeVisible();
});

test("detail page (RU) shows fallback when no price info", async ({ page }) => {
  // m12 has costInfo: null in chargers-mock.
  await page.goto("https://poolwatt.com/ru/c/m12", { waitUntil: "networkidle" });
  await expect(page.getByText("Цена / кВт·ч")).toBeVisible();
  await expect(page.getByText("Тариф уточняйте у оператора")).toBeVisible();
});

test("detail page (SK) renders SK labels", async ({ page }) => {
  await page.goto("https://poolwatt.com/sk/c/m1", { waitUntil: "networkidle" });
  await expect(page.getByText("Cena / kWh")).toBeVisible();
});

test("detail page (EN) renders EN labels", async ({ page }) => {
  await page.goto("https://poolwatt.com/en/c/m12", { waitUntil: "networkidle" });
  await expect(page.getByText("Price / kWh")).toBeVisible();
  await expect(page.getByText("Tariff varies — contact operator")).toBeVisible();
});
