// Drive register → favorite → cabinet flow on the live site, capture
// observations. Self-contained, deleted at the end of the session.

import { chromium } from "playwright";

const BASE = "https://poolwatt.com";
const NICK = `tst_${Math.random().toString(36).slice(2, 8)}`;
const PASS = "Test1234abc";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ locale: "en-US" });
const page = await ctx.newPage();

const consoleErrs = [];
const notFound = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrs.push(m.text() + " @ " + (m.location()?.url ?? "")); });
page.on("pageerror", (e) => consoleErrs.push("PAGEERROR: " + e.message));
page.on("response", (r) => { if (r.status() === 404) notFound.push(`${r.request().method()} ${r.url()}`); });

const out = {};

try {
  // 1) Open /en/register
  await page.goto(`${BASE}/en/register`, { waitUntil: "domcontentloaded" });
  out.registerLoaded = await page.locator("text=Create account").count() > 0;

  // 2) Fill in nickname + password, submit
  await page.fill('input[name="username"]', NICK);
  await page.fill('input[name="password"]', PASS);
  await Promise.all([
    page.waitForURL(/\/me/, { timeout: 15000 }),
    page.click('button[type="submit"]'),
  ]);
  out.afterRegisterUrl = page.url();

  // 3) Profile pill should now be in navbar
  out.profilePillVisible = await page.locator(`text=@${NICK}`).first().count() > 0;

  // 4) Navigate to landing → star a producer
  await page.goto(`${BASE}/en`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('button[aria-pressed]', { timeout: 10000 });
  const firstStar = page.locator('button[aria-pressed="false"]').first();
  out.starButtonsCount = await page.locator('button[aria-pressed="false"], button[aria-pressed="true"]').count();
  await firstStar.click();
  await page.waitForTimeout(800); // wait for server action

  // After click → button should now be pressed
  out.starsPressedAfterClick = await page.locator('button[aria-pressed="true"]').count();

  // 5) Open cabinet → favorites
  await page.goto(`${BASE}/en/me/favorites`, { waitUntil: "domcontentloaded" });
  out.cabinetUrl = page.url();
  out.cabinetHasSidebar = await page.locator("text=Favorites").count() > 0;
  // The favorited producer should appear
  const tabProducerCount = await page.locator('th:has-text("PRODUCER")').count();
  out.producersTableInCabinet = tabProducerCount > 0;
  // Empty state should NOT be visible if we have a favorite
  out.emptyStateVisible = await page.locator("text=No favorite producers yet").count() > 0;

  // 6) Sign out via profile pill
  await page.click(`text=@${NICK}`);
  await page.waitForTimeout(200);
  await page.click('text=Sign out');
  await page.waitForURL(`${BASE}/en**`, { timeout: 5000 });
  out.afterSignOutUrl = page.url();

  await page.screenshot({ path: "/tmp/poolwatt-cabinet.png", fullPage: false });
} catch (e) {
  out.error = e.message;
}

out.consoleErrors = consoleErrs;
out.notFoundUrls = notFound;
out.testUser = NICK;

console.log(JSON.stringify(out, null, 2));
await browser.close();
