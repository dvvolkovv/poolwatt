// US-47 — "назначить сотруднику роль на конкретные пункты", on the live
// build. The criterion is what the employee can and cannot see.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const OWNER = { username: "e2e_staff_owner", password: "Pass1234" };
const ENGINEER = { username: "e2e_staff_engineer", password: "Pass1234" };
const SLUG = "e2e-staff-network";

let operatorId: string;
let pointA: string;
let pointB: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.employee.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.staffRole.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
}

test.beforeAll(async () => {
  await wipe();
  const hash = await bcrypt.hash(OWNER.password, 10);
  const owner = await prisma.user.upsert({
    where: { username: OWNER.username },
    update: { passwordHash: hash },
    create: { username: OWNER.username, passwordHash: hash },
  });
  await prisma.user.upsert({
    where: { username: ENGINEER.username },
    update: { passwordHash: hash },
    create: { username: ENGINEER.username, passwordHash: hash },
  });

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "E2E Staff Network",
        claimedById: owner.id,
        claimedAt: new Date(),
      },
    })
  ).id;

  pointA = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "E2E Staff Point A" },
    })
  ).id;
  pointB = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "E2E Staff Point B" },
    })
  ).id;
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({
    where: { username: { in: [OWNER.username, ENGINEER.username] } },
  });
  await prisma.$disconnect();
});

test("the owner grants an engineer one point, and only that point", async ({ page }) => {
  await signInWithPassword(page, OWNER);
  await page.goto(`/en/me/charger-operator/${operatorId}/staff`);

  await page.getByLabel("Username").fill(ENGINEER.username);
  await page.getByLabel("Role", { exact: true }).selectOption("ENGINEER");
  // Scope: point A only.
  await page.locator('fieldset label:has-text("E2E Staff Point A") input').check();
  await page.locator('button:has-text("Add")').click();

  await expect(page.getByTestId(`staff-${ENGINEER.username}`)).toBeVisible();

  const stored = await prisma.employee.findFirstOrThrow({
    where: { operatorId },
    include: { role: true },
  });
  expect(stored.role.name).toBe("ENGINEER");
  expect(stored.pointIds).toEqual([pointA]);
});

test("the engineer sees the granted point and not the other", async ({ page }) => {
  await signInWithPassword(page, ENGINEER);
  await page.goto(`/en/me/charger-operator/${operatorId}/points`);

  await expect(page.getByTestId("point-list")).toContainText("E2E Staff Point A");
  await expect(page.locator("text=E2E Staff Point B")).toHaveCount(0);

  // And the card of the point outside the scope is simply not there.
  const res = await page.goto(`/en/me/charger-operator/${operatorId}/points/${pointB}`);
  expect(res?.status()).toBe(404);
});

test("the engineer cannot hand out roles", async ({ page }) => {
  await signInWithPassword(page, ENGINEER);
  const res = await page.goto(`/en/me/charger-operator/${operatorId}/staff`);
  expect(res?.status()).toBe(404);
});
