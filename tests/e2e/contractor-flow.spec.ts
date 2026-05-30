import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const OWNER = { username: "e2e_ctr_owner", password: "Pass1234" };
const ADMIN = { username: "e2e_ctr_admin", password: "Pass1234" };

test.beforeAll(async () => {
  const ownerHash = await bcrypt.hash(OWNER.password, 10);
  const adminHash = await bcrypt.hash(ADMIN.password, 10);
  await prisma.user.upsert({
    where: { username: OWNER.username },
    update: { passwordHash: ownerHash, name: "E2E Contractor Owner" },
    create: { username: OWNER.username, passwordHash: ownerHash, name: "E2E Contractor Owner" },
  });
  await prisma.user.upsert({
    where: { username: ADMIN.username },
    update: { passwordHash: adminHash, role: "ADMIN" },
    create: { username: ADMIN.username, passwordHash: adminHash, role: "ADMIN" },
  });
  await prisma.contractor.deleteMany({
    where: { members: { some: { user: { username: { in: [OWNER.username, ADMIN.username] } } } } },
  });
});

test.afterAll(async () => {
  await prisma.contractor.deleteMany({
    where: { members: { some: { user: { username: { in: [OWNER.username, ADMIN.username] } } } } },
  });
  await prisma.$disconnect();
});

test("owner registers a contractor, admin approves it", async ({ page }) => {
  // Owner logs in
  await page.goto("/en/login");
  await page.fill('input[name="username"]', OWNER.username);
  await page.fill('input[name="password"]', OWNER.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/en\/me(\/|$)/);

  // Registration form
  await page.goto("/en/me/contractor/new");
  await page.fill('input[name="displayName"]', "E2E Solar s.r.o.");
  await page.fill('input[name="legalName"]', "E2E Solar Renewable Energy s.r.o.");
  await page.fill('input[name="registrationNumber"]', "11223344");
  await page.fill('input[name="country"]', "sk");
  await page.fill('input[name="city"]', "Bratislava");

  // multi-select checkboxes
  await page.locator('label:has-text("Design / engineering") input[type="checkbox"]').check();
  await page.locator('label:has-text("Installation / construction") input[type="checkbox"]').check();
  await page.locator('label:has-text("Solar") input[type="checkbox"]').first().check();

  await page.fill('input[name="countriesServed"]', "SK, CZ");
  await page.fill('textarea[name="bio"]', "We design and install solar power stations across Slovakia and Czech Republic. ".repeat(3));
  await page.fill('input[name="contactEmail"]', "info@e2e-solar.sk");
  await page.fill('input[name="contactPhone"]', "+421900111222");

  await page.click('button[type="submit"]');
  await page.waitForURL(/\/en\/me\/contractor\/[a-z0-9]+/);
  await expect(page.locator("text=Pending review")).toBeVisible();

  const detailUrl = page.url();
  const contractorId = detailUrl.split("/").pop()!;

  // Switch to admin via clearCookies (Auth.js signout is brittle in tests)
  await page.context().clearCookies();
  await page.goto("/en/login");
  await page.fill('input[name="username"]', ADMIN.username);
  await page.fill('input[name="password"]', ADMIN.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/en\/me(\/|$)/);

  // Admin approves
  await page.goto(`/en/admin/contractors/${contractorId}`);
  await page.fill('textarea', "Looks legit, approving for V2b listing");
  await page.click('button:has-text("Apply")');
  await expect(page.locator("text=Current: APPROVED")).toBeVisible();
});
