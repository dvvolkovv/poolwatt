// §48 в телефоне: чат наряда, системная строка о назначении и слово,
// сказанное без связи.
//
// Главное здесь — последнее: сообщение, написанное в подвале, не исчезает и
// доходит ровно один раз, когда связь вернулась. Это тот же путь, что у
// списания запчасти US-49, поэтому проверяется так же — по базе, а не по
// надписи на экране.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const OWNER = { username: "e2e_mchat_owner", password: "Pass1234" };
const ENGINEER = { username: "e2e_mchat_eng", password: "Pass1234" };
const SLUG = "e2e-mchat-network";

let operatorId: string;
let orderId: string;
let employeeId: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.chatRead.deleteMany({
    where: { user: { username: { in: [OWNER.username, ENGINEER.username] } } },
  });
  await prisma.chatMessage.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chatMessage.deleteMany({ where: { workOrder: { operator: { slug: SLUG } } } });
  await prisma.idempotencyRecord.deleteMany({
    where: { endpoint: "POST /v1/chat/rooms/messages" },
  });
  await prisma.workOrder.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.employee.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.staffRole.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
}

const said = (body: string) =>
  prisma.chatMessage.count({ where: { workOrderId: orderId, body } });

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

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "E2E Mobile Chat Network",
        claimedById: ownerId,
        claimedAt: new Date(),
      },
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
  employeeId = (
    await prisma.employee.create({
      data: { operatorId, userId: engineerId, roleId: role.id, pointIds: [] },
    })
  ).id;
  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId,
      type: "CHARGING_STATION",
      name: "E2E Mobile Chat Point",
      city: "Košice",
      addressLine: "Hlavná 3",
    },
  });
  orderId = (
    await prisma.workOrder.create({
      data: {
        operatorId,
        pointId: point.id,
        type: "REPAIR",
        title: "E2E: mobile chat order",
        description: "The connector is loose",
        assigneeId: employeeId,
        status: "IN_PROGRESS",
      },
    })
  ).id;
  // Системная строка §48: наряд рассказывает о себе сам.
  await prisma.chatMessage.create({
    data: {
      kind: "WORK_ORDER",
      workOrderId: orderId,
      authorKind: "SYSTEM",
      body: "Назначен: @" + ENGINEER.username,
    },
  });
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({
    where: { username: { in: [OWNER.username, ENGINEER.username] } },
  });
  await prisma.$disconnect();
});

test("the hub offers the team chat and lists the rooms", async ({ page }) => {
  await signInWithPassword(page, ENGINEER);
  await page.goto("/en/app/more");
  await expect(page.locator('[data-section="chat"]')).toBeVisible();
  await page.locator('[data-section="chat"]').click();

  await expect(page.locator('[data-testid="chat-rooms"]')).toBeVisible();
  await expect(page.locator(`[data-room="wo-${orderId}"]`)).toBeVisible();
  await expect(page.locator(`[data-room="net-${operatorId}"]`)).toBeVisible();
});

test("the engineer reads the order's own story in the order chat", async ({ page }) => {
  await signInWithPassword(page, ENGINEER);
  await page.goto(`/en/app/work-orders/${orderId}`);
  await expect(page.locator('[data-author="SYSTEM"]')).toContainText("Назначен");
});

test("a word said with no signal goes out once when the signal is back", async ({
  page,
  context,
}) => {
  await signInWithPassword(page, ENGINEER);
  await page.goto(`/en/app/work-orders/${orderId}`);
  await expect(page.locator('[data-testid="chat-room"]')).toBeVisible();

  await context.setOffline(true);
  await page.fill('[data-testid="chat-input"]', "Already on site, the gate is locked");
  await page.locator('[data-testid="chat-send"]').click();

  // Слово осталось в телефоне, и человек это видит.
  await expect(page.locator('[data-testid="offline-queue"]')).toBeVisible();
  expect(await said("Already on site, the gate is locked")).toBe(0);

  await context.setOffline(false);
  await expect
    .poll(() => said("Already on site, the gate is locked"), {
      timeout: 20_000,
      message: "the message should reach the room exactly once",
    })
    .toBe(1);
});
