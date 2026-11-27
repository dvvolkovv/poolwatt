// US-49 — списание запчасти в наряде без связи, на живой сборке.
//
// `context.setOffline(true)` обрывает сеть у страницы так же, как подвал
// обрывает её у инженера: `fetch` бросает, запись остаётся в телефоне.
// Главное, что здесь проверяется, — не кнопка, а то, что после возврата
// связи на складе стало на одну плату меньше, и ровно на одну.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const ENGINEER = { username: "e2e_mobwo_eng", password: "Pass1234" };
const OWNER = { username: "e2e_mobwo_owner", password: "Pass1234" };
const STRANGER = { username: "e2e_mobwo_stranger", password: "Pass1234" };
const SLUG = "e2e-mobwo-network";

let operatorId: string;
let vanId: string;
let partId: string;
let orderId: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.stockMovement.deleteMany({ where: { part: { operator: { slug: SLUG } } } });
  await prisma.restockRequest.deleteMany({
    where: { warehouse: { operator: { slug: SLUG } } },
  });
  await prisma.stockItem.deleteMany({ where: { part: { operator: { slug: SLUG } } } });
  await prisma.workOrder.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.warehouse.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.sparePart.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.employee.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.staffRole.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
}

/** Остаток платы в машине инженера — то, ради чего всё остальное. */
async function onShelf(): Promise<number> {
  const item = await prisma.stockItem.findUnique({
    where: { warehouseId_partId: { warehouseId: vanId, partId } },
  });
  return item?.qty ?? 0;
}

async function resetShelf(qty: number) {
  await prisma.stockMovement.deleteMany({ where: { partId } });
  await prisma.idempotencyRecord.deleteMany({
    where: { endpoint: "POST /v1/stock-movements" },
  });
  await prisma.stockItem.update({
    where: { warehouseId_partId: { warehouseId: vanId, partId } },
    data: { qty },
  });
}

test.beforeAll(async () => {
  await wipe();

  const hash = await bcrypt.hash(ENGINEER.password, 10);
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
      data: {
        slug: SLUG,
        displayName: "E2E Work Order Network",
        claimedById: ownerId,
        claimedAt: new Date(),
      },
    })
  ).id;

  // §47 — роль ENGINEER несёт `warehouse.write`, и теперь это право что-то
  // значит: до US-49 его не проверяла ни одна строка кода.
  const role = await prisma.staffRole.create({
    data: {
      operatorId,
      name: "ENGINEER",
      permissions: ["points.read", "workorders.read", "workorders.write", "warehouse.write"],
      builtIn: true,
    },
  });
  const employee = await prisma.employee.create({
    data: { operatorId, userId: engineerId, roleId: role.id, pointIds: [] },
  });

  vanId = (
    await prisma.warehouse.create({
      data: {
        operatorId,
        name: "E2E Van",
        kind: "VAN",
        keeperEmployeeId: employee.id,
      },
    })
  ).id;
  partId = (
    await prisma.sparePart.create({
      data: { operatorId, sku: "E2E-PLATE", name: "E2E control board" },
    })
  ).id;
  await prisma.stockItem.create({ data: { warehouseId: vanId, partId, qty: 2 } });

  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId,
      type: "CHARGING_STATION",
      name: "E2E WO Point",
      city: "Košice",
      addressLine: "Hlavná 1",
    },
  });
  orderId = (
    await prisma.workOrder.create({
      data: {
        operatorId,
        pointId: point.id,
        type: "REPAIR",
        title: "E2E: replace the control board",
        description: "The screen is dead",
        partsNeeded: ["control board"],
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

test("the hub offers an engineer their work orders", async ({ page }) => {
  await signInWithPassword(page, ENGINEER);
  await page.goto("/en/app/more");
  await expect(page.locator('[data-section="work"]')).toBeVisible();
  await page.locator('[data-section="work"]').click();
  await expect(page.getByText("E2E: replace the control board")).toBeVisible();
});

test("a part written off with no signal reaches the shelf when the signal is back", async ({
  page,
  context,
}) => {
  await resetShelf(2);
  await signInWithPassword(page, ENGINEER);
  await page.goto(`/en/app/work-orders/${orderId}`);
  await expect(page.getByText("The screen is dead")).toBeVisible();

  await context.setOffline(true);
  await page.selectOption('[data-testid="issue-part"]', partId);
  await page.fill('[data-testid="issue-qty"]', "1");
  await page.locator('[data-testid="issue-send"]').click();

  // Запись осталась в телефоне, и человек это видит.
  const queue = page.locator('[data-testid="offline-queue"]');
  await expect(queue).toBeVisible();
  await expect(queue.locator('[data-queue-state="pending"]')).toHaveCount(1);
  expect(await onShelf()).toBe(2);

  // Кнопка «отправить сейчас» на месте, но нажимать её не нужно: возврат
  // связи — это событие `online`, и запись уходит сама. Это и есть
  // «синхронизируется» из критерия US-49.
  await expect(page.locator('[data-testid="queue-send-now"]')).toBeVisible();
  await context.setOffline(false);

  await expect(queue).toHaveCount(0);
  await expect
    .poll(onShelf, { timeout: 15_000, message: "the shelf should drop by one" })
    .toBe(1);

  const issues = await prisma.stockMovement.count({
    where: { workOrderId: orderId, kind: "ISSUE" },
  });
  expect(issues).toBe(1);
});

test("a refusal stays on the screen in the server's own words", async ({ page, context }) => {
  await resetShelf(2);
  await signInWithPassword(page, ENGINEER);
  await page.goto(`/en/app/work-orders/${orderId}`);

  await context.setOffline(true);
  await page.selectOption('[data-testid="issue-part"]', partId);
  await page.fill('[data-testid="issue-qty"]', "9");
  await page.locator('[data-testid="issue-send"]').click();
  await expect(page.locator('[data-testid="offline-queue"]')).toBeVisible();

  await context.setOffline(false);

  const rejected = page.locator('[data-queue-state="rejected"]');
  await expect(rejected).toHaveCount(1);
  await expect(rejected).toContainText("only 2");
  expect(await onShelf()).toBe(2);

  // Повторный досыл отказ не трогает: он не изменится от повтора, и полка
  // остаётся прежней.
  await page.locator('[data-testid="queue-send-now"]').click();
  await expect(rejected).toHaveCount(1);
  expect(await onShelf()).toBe(2);

  // Отказ убирает человек, а не экран.
  await rejected.locator('[data-testid="queue-dismiss"]').click();
  await expect(page.locator('[data-testid="offline-queue"]')).toHaveCount(0);
});

test("somebody else's work order is not there at all", async ({ page }) => {
  await signInWithPassword(page, STRANGER);
  const response = await page.goto(`/en/app/work-orders/${orderId}`);
  expect(response?.status()).toBe(404);
});
