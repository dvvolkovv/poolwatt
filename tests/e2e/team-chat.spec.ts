// §48 «Внутренний чат команды и чат по каждому наряду» — на живой сборке.
//
// Проверяется не кнопка, а то, ради чего чат нужен: диспетчер сказал слово в
// наряде, инженер его читает, и чужой человек комнаты не находит.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const OWNER = { username: "e2e_chat_owner", password: "Pass1234" };
const ENGINEER = { username: "e2e_chat_eng", password: "Pass1234" };
const STRANGER = { username: "e2e_chat_stranger", password: "Pass1234" };
const SLUG = "e2e-chat-network";

let operatorId: string;
let orderId: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.chatRead.deleteMany({
    where: { user: { username: { in: [OWNER.username, ENGINEER.username, STRANGER.username] } } },
  });
  await prisma.chatMessage.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chatMessage.deleteMany({ where: { workOrder: { operator: { slug: SLUG } } } });
  await prisma.workOrder.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.crew.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.employee.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.staffRole.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
}

test.beforeAll(async () => {
  await wipe();

  const hash = await bcrypt.hash(OWNER.password, 10);
  const user = async (name: string) =>
    (
      await prisma.user.upsert({
        where: { username: name },
        update: { passwordHash: hash },
        create: { username: name, passwordHash: hash },
      })
    ).id;
  const ownerId = await user(OWNER.username);
  const engineerId = await user(ENGINEER.username);
  await user(STRANGER.username);

  operatorId = (
    await prisma.chargerOperator.create({
      data: { slug: SLUG, displayName: "E2E Chat Network", claimedById: ownerId, claimedAt: new Date() },
    })
  ).id;
  const role = await prisma.staffRole.create({
    data: {
      operatorId,
      name: "ENGINEER",
      permissions: ["points.read", "workorders.read", "workorders.write"],
      builtIn: true,
    },
  });
  const employee = await prisma.employee.create({
    data: { operatorId, userId: engineerId, roleId: role.id, pointIds: [] },
  });
  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId,
      type: "CHARGING_STATION",
      name: "E2E Chat Point",
      city: "Košice",
      addressLine: "Hlavná 2",
    },
  });
  orderId = (
    await prisma.workOrder.create({
      data: {
        operatorId,
        pointId: point.id,
        type: "REPAIR",
        title: "E2E: chat about the gate",
        description: "The gate is locked",
        assigneeId: employee.id,
        status: "IN_PROGRESS",
      },
    })
  ).id;
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({
    where: { username: { in: [OWNER.username, ENGINEER.username, STRANGER.username] } },
  });
  await prisma.$disconnect();
});

test("the owner says a word in the network room and it is there after a reload", async ({ page }) => {
  await signInWithPassword(page, OWNER);
  await page.goto(`/en/me/charger-operator/${operatorId}/chat`);

  await expect(page.locator('[data-testid="chat-rooms"]')).toBeVisible();
  await page.fill('[data-testid="chat-input"]', "Shift starts at seven");
  await page.locator('[data-testid="chat-send"]').click();
  await expect(page.getByText("Shift starts at seven")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Shift starts at seven")).toBeVisible();
});

test("a word in the work-order chat reaches the engineer, and the order tells its own story", async ({
  page,
}) => {
  await signInWithPassword(page, OWNER);
  await page.goto(`/en/me/work-orders/${orderId}`);
  await page.fill('[data-testid="chat-input"]', "The gate is on the other side");
  await page.locator('[data-testid="chat-send"]').click();
  await expect(page.getByText("The gate is on the other side")).toBeVisible();

  // Пересесть за другого человека: выход через Auth.js в тестах хрупок.
  await page.context().clearCookies();
  await signInWithPassword(page, ENGINEER);
  await page.goto(`/en/me/work-orders/${orderId}`);
  await expect(page.getByText("The gate is on the other side")).toBeVisible();
});

test("a stranger finds no room of a network that is not theirs", async ({ page }) => {
  await page.context().clearCookies();
  await signInWithPassword(page, STRANGER);
  const response = await page.goto(`/en/me/charger-operator/${operatorId}/chat`);
  expect(response?.status()).toBe(404);
});

test("a stranger finds no chat of a work order that is not theirs", async ({ page }) => {
  await page.context().clearCookies();
  await signInWithPassword(page, STRANGER);
  const response = await page.goto(`/en/me/work-orders/${orderId}`);
  expect(response?.status()).toBe(404);
});
