import { test, expect } from "@playwright/test";

// Stops at the Taler ID login screen: no account is created or used.
// Skipped when the target has no TALERID_* credentials.

test.beforeEach(async ({ request }) => {
  const providers = await (await request.get("/api/auth/providers")).json();
  test.skip(!providers.talerid, "Taler ID is not configured on this target");
});

for (const [path, label] of [
  ["/en/login", "Sign in with Taler ID"],
  ["/ru/register", "Продолжить с Taler ID"],
] as const) {
  test(`${path} leads to Taler ID with PKCE, state and nonce`, async ({ page, baseURL }) => {
    await page.goto(path);
    await expect(page.locator("#password")).toBeVisible();

    const [request] = await Promise.all([
      page.waitForRequest((r) => new URL(r.url()).pathname.endsWith("/oauth/auth")),
      page.getByRole("button", { name: label }).click(),
    ]);

    const url = new URL(request.url());
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid profile email");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    for (const param of ["client_id", "code_challenge", "state", "nonce"]) {
      expect(url.searchParams.get(param), param).toBeTruthy();
    }
    // Behind nginx the site's public URL wins over the local address under test.
    const redirectUri = new URL(url.searchParams.get("redirect_uri")!);
    expect(redirectUri.pathname).toBe("/api/auth/callback/talerid");
    expect([new URL(baseURL!).origin, "https://poolwatt.com"]).toContain(redirectUri.origin);

    const response = await request.response();
    expect(response!.status(), "Taler ID accepted the request").toBeLessThan(400);
  });
}

test("a cancelled sign-in is explained", async ({ page }) => {
  await page.goto("/en/login?error=OAuthCallbackError");
  await expect(page.getByText("Sign-in with Taler ID was cancelled.")).toBeVisible();
});
