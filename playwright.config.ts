import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: 1,
  fullyParallel: true,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    // PM2-managed `poolwatt-web` listens on :3000 in prod; override with
    // BASE_URL when targeting a remote env.
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      // System Google Chrome (channel: "chrome"). Bundled chromium would be
      // cleaner, but Playwright 1.60.0 has no chromium binary for Ubuntu 26.04
      // ("resolute") yet — see CLAUDE.md gotcha.
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
});
