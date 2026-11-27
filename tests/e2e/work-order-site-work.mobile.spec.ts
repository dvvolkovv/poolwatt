// §48 на месте работ, на живой сборке и на Pixel 7: инженер отмечает пункты
// чек-листа, один пропускает с объяснением, кладёт снимок «после»,
// подписывает и закрывает наряд. И то же без связи: отметка и закрытие ждут
// в телефоне и уходят, когда сеть вернулась.

import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { signInWithPassword } from "./login";

const prisma = new PrismaClient();

const ENGINEER = { username: "e2e_site_eng", password: "Pass1234" };
const OWNER = { username: "e2e_site_owner", password: "Pass1234" };
const STRANGER = { username: "e2e_site_stranger", password: "Pass1234" };
const SLUG = "e2e-site-work";

let operatorId: string;
let orderId: string;
let secondOrderId: string;

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(128, 6),
]);

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  await prisma.workOrderSignature.deleteMany({
    where: { workOrder: { operator: { slug: SLUG } } },
  });
  await prisma.workOrderPhoto.deleteMany({
    where: { workOrder: { operator: { slug: SLUG } } },
  });
  await prisma.workOrderTask.deleteMany({
    where: { workOrder: { operator: { slug: SLUG } } },
  });
  await prisma.workOrder.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.employee.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.staffRole.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
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
        displayName: "E2E Site Work Network",
        claimedById: ownerId,
        claimedAt: new Date(),
      },
    })
  ).id;
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
  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId,
      type: "CHARGING_STATION",
      name: "E2E Site Point",
      city: "Košice",
      addressLine: "Hlavná 21",
    },
  });

  const order = async (title: string) =>
    (
      await prisma.workOrder.create({
        data: {
          operatorId,
          pointId: point.id,
          type: "REPAIR",
          title,
          description: "The screen is dead",
          assigneeId: employee.id,
          status: "IN_PROGRESS",
        },
      })
    ).id;
  orderId = await order("E2E: site work on the phone");
  secondOrderId = await order("E2E: site work without a network");
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({
    where: { username: { in: [OWNER.username, ENGINEER.username, STRANGER.username] } },
  });
  await prisma.$disconnect();
});

test("the engineer works the checklist, photographs, signs and closes", async ({ page }) => {
  await signInWithPassword(page, ENGINEER);
  await page.goto(`/en/app/work-orders/${orderId}`);

  // §48 — чек-лист появился сам, при первом открытии наряда.
  const checklist = page.locator('[data-testid="site-checklist"]');
  await expect(checklist).toBeVisible();
  const created = await prisma.workOrderTask.findMany({
    where: { workOrderId: orderId },
    orderBy: { position: "asc" },
  });
  expect(created.length).toBeGreaterThan(0);

  const required = created.filter((t) => t.required);
  // Все обязательные, кроме последнего, отмечаются.
  for (const task of required.slice(0, -1)) {
    await page.locator(`[data-testid="task-tick-${task.position}"]`).check();
  }
  // Последний пропускается с объяснением.
  const last = required[required.length - 1];
  await page.locator(`[data-testid="task-skip-${last.position}"]`).click();
  await page.fill('[data-testid="task-skip-reason"]', "the switchboard was locked");
  await page.locator('[data-testid="task-skip-save"]').click();
  await expect(page.locator('[data-testid="task-skipped"]').first()).toContainText("locked");

  await expect
    .poll(async () =>
      prisma.workOrderTask.count({
        where: { workOrderId: orderId, OR: [{ doneAt: { not: null } }, { skipReason: { not: null } }] },
      }),
    )
    .toBe(required.length);

  // §48 «фото после». Снимок уходит сразу: в очередь он не ложится.
  await page.setInputFiles('[data-testid="photo-input-AFTER"]', {
    name: "after.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect
    .poll(() => prisma.workOrderPhoto.count({ where: { workOrderId: orderId, stage: "AFTER" } }))
    .toBe(1);

  // §48 «подпись»: имя, вид подписавшего и росчерк на холсте.
  await page.fill('[data-testid="signer-name"]', "Jana Horvathova");
  await page.locator('[data-testid="signer-SITE_CONTACT"]').click();
  const canvas = page.locator('[data-testid="signature-canvas"]');
  // `page.mouse` не прокручивает страницу сам, а холст подписи лежит далеко
  // внизу экрана телефона: без этого координаты уходят за видимую часть и до
  // холста не доходит ни одно событие.
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 30);
  await page.mouse.move(box.x + 220, box.y + 80);
  await page.mouse.up();
  await page.locator('[data-testid="signature-save"]').click();

  await expect
    .poll(() => prisma.workOrderSignature.count({ where: { workOrderId: orderId } }))
    .toBe(1);
  const signature = await prisma.workOrderSignature.findUniqueOrThrow({
    where: { workOrderId: orderId },
  });
  expect(signature.signerKind).toBe("SITE_CONTACT");
  expect(signature.signerName).toBe("Jana Horvathova");

  // И только теперь закрытие возможно.
  await page.locator('[data-testid="order-close"]').click();
  await expect
    .poll(async () =>
      (await prisma.workOrder.findUniqueOrThrow({ where: { id: orderId } })).status,
    )
    .toBe("DONE");
});

test("without a network the tick and the close wait in the phone", async ({ page, context }) => {
  await signInWithPassword(page, ENGINEER);
  await page.goto(`/en/app/work-orders/${secondOrderId}`);
  await expect(page.locator('[data-testid="site-checklist"]')).toBeVisible();

  const tasks = await prisma.workOrderTask.findMany({
    where: { workOrderId: secondOrderId },
    orderBy: { position: "asc" },
  });
  const required = tasks.filter((t) => t.required);

  await context.setOffline(true);
  for (const task of required) {
    await page.locator(`[data-testid="task-tick-${task.position}"]`).check();
  }
  // §48 «офлайн-режим» — записи видны человеку, а не потеряны.
  await expect(page.locator('[data-testid="offline-queue"]')).toBeVisible();
  expect(
    await prisma.workOrderTask.count({
      where: { workOrderId: secondOrderId, doneAt: { not: null } },
    }),
  ).toBe(0);

  // Снимок без связи честно отказывается, а не делает вид.
  await page.setInputFiles('[data-testid="photo-input-AFTER"]', {
    name: "offline.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(page.locator('[data-testid="site-work-error"]')).toBeVisible();

  // Экран сам досылает очередь по событию `online` — нажимать «отправить
  // сейчас» не нужно, и кнопка к этому моменту уже исчезает.
  await context.setOffline(false);
  await expect
    .poll(
      () =>
        prisma.workOrderTask.count({
          where: { workOrderId: secondOrderId, doneAt: { not: null } },
        }),
      { timeout: 20_000 },
    )
    .toBe(required.length);
});

test("the order of another network is not there at all", async ({ page }) => {
  await signInWithPassword(page, STRANGER);
  const response = await page.goto(`/en/app/work-orders/${orderId}`);
  expect(response?.status()).toBe(404);

  const media = await page.request.post(`/api/v1/work-orders/${orderId}/tasks`, {
    headers: { "Idempotency-Key": `e2e-site-${Date.now()}` },
    data: { taskId: "whatever", done: true },
  });
  expect(media.status()).toBe(404);
});
