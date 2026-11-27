// §48 на мониторе, на живой сборке: владелец сети видит чек-лист, снимки
// «до/после» и подпись, отмечает пункт со стола, и наряд не закрывается, пока
// обязательный пункт без ответа или подписи нет.

import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { signInWithPassword } from "./login";

const prisma = new PrismaClient();

const OWNER = { username: "e2e_wsite_owner", password: "Pass1234" };
const STRANGER = { username: "e2e_wsite_stranger", password: "Pass1234" };
const SLUG = "e2e-wsite-network";

let operatorId: string;
let orderId: string;

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 9),
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
  await user(STRANGER.username);

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "E2E Site Cabinet Network",
        claimedById: ownerId,
        claimedAt: new Date(),
      },
    })
  ).id;
  const point = await prisma.acceptancePoint.create({
    data: { operatorId, type: "CHARGING_STATION", name: "E2E Cabinet Point", city: "Košice" },
  });
  orderId = (
    await prisma.workOrder.create({
      data: {
        operatorId,
        pointId: point.id,
        type: "MAINTENANCE",
        title: "E2E: planned maintenance",
        description: "Quarterly check",
        status: "IN_PROGRESS",
      },
    })
  ).id;
});

test.afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({
    where: { username: { in: [OWNER.username, STRANGER.username] } },
  });
  await prisma.$disconnect();
});

test("the cabinet shows the checklist of this kind of order and ticks from the desk", async ({
  page,
}) => {
  await signInWithPassword(page, OWNER);
  await page.goto(`/en/me/work-orders/${orderId}`);

  await expect(page.locator('[data-testid="order-checklist"]')).toBeVisible();
  const tasks = await prisma.workOrderTask.findMany({
    where: { workOrderId: orderId },
    orderBy: { position: "asc" },
  });
  expect(tasks.length).toBeGreaterThan(0);
  // Наряд планового обслуживания получил список обслуживания, а не ремонта.
  expect(tasks[0].title).toContain("inspected");

  await page.locator('[data-testid="order-task-0"]').check();
  await expect
    .poll(() =>
      prisma.workOrderTask.count({ where: { id: tasks[0].id, doneAt: { not: null } } }),
    )
    .toBe(1);

  await expect(page.locator('[data-testid="order-photos-BEFORE"]')).toBeVisible();
  await expect(page.locator('[data-testid="order-signature"]')).toContainText("signed");
});

test("closing is refused until the checklist is answered and the work is signed", async ({
  page,
}) => {
  await signInWithPassword(page, OWNER);

  const refused = await page.request.post(`/api/v1/work-orders/${orderId}/status`, {
    headers: { "Idempotency-Key": `e2e-wsite-a-${Date.now()}` },
    data: { status: "DONE", report: "all good" },
  });
  expect(refused.status()).toBe(400);
  expect(await refused.text()).toContain("checklist");

  const tasks = await prisma.workOrderTask.findMany({ where: { workOrderId: orderId } });
  await prisma.workOrderTask.updateMany({
    where: { workOrderId: orderId, required: true },
    data: { doneAt: new Date() },
  });
  expect(tasks.length).toBeGreaterThan(0);

  const stillRefused = await page.request.post(`/api/v1/work-orders/${orderId}/status`, {
    headers: { "Idempotency-Key": `e2e-wsite-b-${Date.now()}` },
    data: { status: "DONE", report: "all good" },
  });
  expect(stillRefused.status()).toBe(400);
  expect(await stillRefused.text()).toContain("signature");

  const signed = await page.request.post(`/api/v1/work-orders/${orderId}/signature`, {
    headers: { "Idempotency-Key": `e2e-wsite-sig-${Date.now()}` },
    data: {
      signerKind: "ENGINEER",
      signerName: "E2E engineer",
      base64: PNG.toString("base64"),
    },
  });
  expect(signed.status()).toBe(201);

  const closed = await page.request.post(`/api/v1/work-orders/${orderId}/status`, {
    headers: { "Idempotency-Key": `e2e-wsite-c-${Date.now()}` },
    data: { status: "DONE", report: "all good" },
  });
  expect(closed.status()).toBe(200);
  expect(
    (await prisma.workOrder.findUniqueOrThrow({ where: { id: orderId } })).status,
  ).toBe("DONE");
});

test("the signature and the photos are served to this network and nobody else", async ({
  page,
}) => {
  const signature = await prisma.workOrderSignature.findUniqueOrThrow({
    where: { workOrderId: orderId },
  });

  await signInWithPassword(page, OWNER);
  const mine = await page.request.get(`/api/v1/work-order-media/${signature.key}`);
  expect(mine.status()).toBe(200);
  expect(mine.headers()["content-type"]).toContain("image/png");

  await page.context().clearCookies();
  await signInWithPassword(page, STRANGER);
  const theirs = await page.request.get(`/api/v1/work-order-media/${signature.key}`);
  expect(theirs.status()).toBe(404);

  const theirPage = await page.goto(`/en/me/work-orders/${orderId}`);
  expect(theirPage?.status()).toBe(404);
});
