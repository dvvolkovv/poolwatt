// M1 — the shell as a person meets it on a phone: the right number of tabs,
// no desktop chrome, an offline screen that admits its figure may be stale.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const USER = { username: "e2e_mobile_shell", password: "Pass1234" };

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await prisma.user.deleteMany({ where: { username: USER.username } });
  await prisma.user.create({
    data: {
      username: USER.username,
      passwordHash: await bcrypt.hash(USER.password, 10),
    },
  });
});

test.afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: USER.username } });
  await prisma.$disconnect();
});

test("a guest sees three tabs and no site header", async ({ page }) => {
  await page.goto("/ru/app");
  await expect(page.locator("[data-tab]")).toHaveCount(3);
  await expect(page.locator("[data-tab=wallet]")).toHaveCount(0);
  await expect(page.getByRole("banner")).toHaveCount(0);
});

test("a signed-in person gets five tabs, a badge and four quick buttons", async ({ page }) => {
  await signInWithPassword(page, USER, "ru");
  await page.goto("/ru/app");
  await expect(page.locator("[data-tab]")).toHaveCount(5);
  await expect(page.getByTestId("status-badge")).toBeVisible();
  await expect(page.getByTestId("kwh-balance")).toBeVisible();
  for (const action of ["buy", "transfer", "charge", "topUp"]) {
    await expect(page.locator(`[data-action=${action}]`)).toBeVisible();
  }
});

test("the wallet tab leads to the wallet screen", async ({ page }) => {
  await signInWithPassword(page, USER, "ru");
  await page.goto("/ru/app");
  await page.locator("[data-tab=wallet]").click();
  await expect(page).toHaveURL(/\/ru\/app\/wallet$/);
});

test("the hub lists the sections a consumer may open", async ({ page }) => {
  await signInWithPassword(page, USER, "ru");
  await page.goto("/ru/app/more");
  await expect(page.locator("[data-section=account]")).toBeVisible();
  await expect(page.locator("[data-section=station]")).toHaveCount(0);
});

test("the offline screen says its figure may be stale", async ({ page }) => {
  await page.goto("/ru/app/offline");
  await expect(page.getByTestId("offline-screen")).toBeVisible();
  await expect(page.getByText("Цифра может быть устаревшей.")).toBeVisible();
});
