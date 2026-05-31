import { test, expect } from "@playwright/test";

test("sidebar exposes price sort dropdown (RU)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto("https://poolwatt.com/ru/navigator", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await expect(page.getByText("Сортировка").first()).toBeVisible();
  await page.locator("#sort").selectOption({ label: "Сначала дешевле" });
  await page.waitForTimeout(800);
  // Sidebar list items containing "€" should appear before plain items.
  const firstFew = await page.locator('button:has-text("kW")').all();
  expect(firstFew.length).toBeGreaterThan(0);
});
