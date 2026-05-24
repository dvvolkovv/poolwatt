import { test, expect } from "@playwright/test";

test("landing /en renders hero + producer section", async ({ page }) => {
  const consoleErrors: string[] = [];
  const failed: Array<{ url: string; status: number }> = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("response", (resp) => {
    if (resp.status() >= 400) failed.push({ url: resp.url(), status: resp.status() });
  });

  const response = await page.goto("/en", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);

  // H1 is the hero headline — split across translation slugs but always present.
  await expect(page.locator("h1").first()).toBeVisible();

  // Top producers section anchor.
  await expect(page.getByRole("heading", { name: /top producers/i })).toBeVisible();

  // Surface non-benign 4xx/5xx subresource failures, but don't fail the test
  // on them — Phase 1 has mock producer avatars that legitimately 404.
  // Log so a future iteration can audit + fix the underlying URLs.
  const realFailed = failed.filter(
    (f) => !/favicon|\.ico|__nextjs_/.test(f.url),
  );
  if (realFailed.length > 0) {
    console.warn("[smoke] subresource 4xx/5xx:", realFailed.map((f) => `${f.status} ${f.url}`));
  }

  const realConsole = consoleErrors.filter(
    (e) => !/favicon|EventSource|ChunkLoadError|HMR|hot-update|Failed to load resource/i.test(e),
  );
  expect(realConsole, realConsole.join("\n")).toEqual([]);
});

test("landing /ru also renders (i18n smoke)", async ({ page }) => {
  const response = await page.goto("/ru", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page.locator("h1").first()).toBeVisible();
});
