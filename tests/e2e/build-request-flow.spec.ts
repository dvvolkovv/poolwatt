import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const OWNER = { username: "e2e_br_owner", password: "Pass1234" };
const ADMIN = { username: "e2e_br_admin", password: "Pass1234" };

test.beforeAll(async () => {
  const ownerHash = await bcrypt.hash(OWNER.password, 10);
  const adminHash = await bcrypt.hash(ADMIN.password, 10);
  await prisma.user.upsert({
    where: { username: OWNER.username },
    update: { passwordHash: ownerHash, phone: "+421900000001", name: "E2E Owner" },
    create: { username: OWNER.username, passwordHash: ownerHash, phone: "+421900000001", name: "E2E Owner" },
  });
  await prisma.user.upsert({
    where: { username: ADMIN.username },
    update: { passwordHash: adminHash, role: "ADMIN" },
    create: { username: ADMIN.username, passwordHash: adminHash, role: "ADMIN" },
  });
});

test.afterAll(async () => {
  await prisma.buildRequest.deleteMany({ where: { user: { username: { in: [OWNER.username, ADMIN.username] } } } });
  await prisma.$disconnect();
});

test("homeowner files request, admin marks it MATCHED", async ({ page }) => {
  // Owner logs in
  await page.goto("/en/login");
  await page.fill('input[name="username"]', OWNER.username);
  await page.fill('input[name="password"]', OWNER.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/en\/me(\/|$)/);

  // New request
  await page.goto("/en/me/build-requests/new");
  await page.fill('input[name="peakKw"]', "8");
  await page.fill('input[name="country"]', "sk");
  await page.fill('input[name="city"]', "Bratislava");
  await page.fill('input[name="addressLine"]', "Hlavná 1");
  await page.click('button[type="submit"]');

  await page.waitForURL(/\/en\/me\/build-requests\/[a-z0-9]+/);
  await expect(page.locator("text=Open")).toBeVisible();
  const detailUrl = page.url();
  const requestId = detailUrl.split("/").pop()!;

  // Log out (clear cookies — Auth.js signout endpoint requires CSRF flow that's brittle in tests)
  await page.context().clearCookies();
  await page.goto("/en/login");
  await page.fill('input[name="username"]', ADMIN.username);
  await page.fill('input[name="password"]', ADMIN.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/en\/me(\/|$)/);

  // Admin detail + status change
  await page.goto(`/en/admin/build-requests/${requestId}`);
  await page.fill('textarea', "Contacted SolarCo");
  await page.click('button:has-text("Apply")');
  await expect(page.locator("text=Current: MATCHED")).toBeVisible();
});
