import { type Page } from "@playwright/test";

/**
 * Sign in with nickname + password.
 *
 * The login page also carries the Taler ID button — itself the submit button of
 * a separate form, rendered above the credentials form — so a bare
 * `button[type="submit"]` click lands on Taler ID. Scope to the form that holds
 * the password field.
 */
export async function signInWithPassword(
  page: Page,
  user: { username: string; password: string },
  locale = "en",
) {
  await page.goto(`/${locale}/login`);
  await page.fill('input[name="username"]', user.username);
  await page.fill('input[name="password"]', user.password);
  await page.locator('form:has(input[name="password"]) button[type="submit"]').click();
  await page.waitForURL(new RegExp(`/${locale}/me(/|$)`));
}
