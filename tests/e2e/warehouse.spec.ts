// §49 and US-50 on the live build: the keeper sets a minimum, a part is issued
// to a job, the level crosses the minimum and a request appears with the
// number to order.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const OWNER = { username: "e2e_wh_owner", password: "Pass1234" };
const STRANGER = { username: "e2e_wh_stranger", password: "Pass1234" };
const SLUG = "e2e-wh-network";

let operatorId: string;
let pointId: string;
let workOrderId: string;
let partId: string;
let warehouseId: string;

test.describe.configure({ mode: "serial" });
test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" });

async function wipe() {
  // The keys below are fixed, so without this the next run of the suite would
  // replay the previous run's stored answers instead of moving the shelf.
  await prisma.idempotencyRecord.deleteMany({
    where: { endpoint: "POST /v1/stock-movements", key: { startsWith: "e2e-wh-" } },
  });
  await prisma.restockRequest.deleteMany({ where: { warehouse: { operator: { slug: SLUG } } } });
  await prisma.stockMovement.deleteMany({ where: { part: { operator: { slug: SLUG } } } });
  await prisma.stockItem.deleteMany({ where: { part: { operator: { slug: SLUG } } } });
  await prisma.warehouse.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.sparePart.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.workOrder.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
}

test.beforeAll(async () => {
  await wipe();

  const hash = await bcrypt.hash(OWNER.password, 10);
  const owner = await prisma.user.upsert({
    where: { username: OWNER.username },
    update: { passwordHash: hash, email: "e2e-wh-owner@example.test", emailVerified: new Date() },
    create: {
      username: OWNER.username,
      passwordHash: hash,
      email: "e2e-wh-owner@example.test",
      emailVerified: new Date(),
    },
  });
  await prisma.user.upsert({
    where: { username: STRANGER.username },
    update: { passwordHash: hash },
    create: { username: STRANGER.username, passwordHash: hash },
  });

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "E2E Warehouse Network",
        claimedById: owner.id,
        claimedAt: new Date(),
      },
    })
  ).id;

  const point = await prisma.acceptancePoint.create({
    data: { operatorId, type: "CHARGING_STATION", name: "E2E WH Point" },
  });
  pointId = point.id;
  workOrderId = (
    await prisma.workOrder.create({
      data: {
        operatorId,
        pointId,
        type: "REPAIR",
        title: "Replace the cable",
        description: "The cable is cut",
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

test("the keeper sets up a store and a part (§49)", async ({ page }) => {
  await signInWithPassword(page, OWNER);
  await page.goto(`/en/me/charger-operator/${operatorId}/warehouse`);

  await expect(page.getByTestId("stock-empty")).toBeVisible();

  const wh = page.getByTestId("warehouse-form");
  await wh.getByLabel("Name", { exact: true }).fill("Central");
  await wh.getByLabel("Kind", { exact: true }).selectOption("CENTRAL");
  await wh.getByLabel("City", { exact: true }).fill("Košice");
  await page.getByTestId("save-warehouse").click();

  await expect.poll(async () => prisma.warehouse.count({ where: { operatorId } })).toBe(1);
  warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { operatorId } })).id;

  await page.reload();
  const part = page.getByTestId("part-form");
  await part.getByLabel("Code", { exact: true }).fill("CBL-CCS2-5M");
  await part.getByLabel("Name", { exact: true }).fill("CCS2 cable, 5 m");
  await part.getByLabel("Maker", { exact: true }).fill("Phoenix");
  await part.getByLabel("Fits", { exact: true }).fill("ABB Terra 54, Alpitronic HYC");
  await part.getByLabel("Unit cost", { exact: true }).fill("180");
  await page.getByTestId("save-part").click();

  await expect.poll(async () => prisma.sparePart.count({ where: { operatorId } })).toBe(1);
  partId = (await prisma.sparePart.findFirstOrThrow({ where: { operatorId } })).id;

  await page.reload();
  await expect(page.getByTestId("part-list")).toContainText("CCS2 cable, 5 m");
  await expect(page.getByTestId("warehouse-list")).toContainText("Central");
});

test("a receipt puts stock on the shelf and a minimum is set", async ({ page }) => {
  await signInWithPassword(page, OWNER);
  await page.goto(`/en/me/charger-operator/${operatorId}/warehouse`);

  await page.getByLabel("Quantity", { exact: true }).fill("6");
  await page.getByTestId("op-receive").click();

  await expect
    .poll(async () => {
      const item = await prisma.stockItem.findFirst({ where: { partId, warehouseId } });
      return item?.qty;
    })
    .toBe(6);

  await page.reload();
  await page.getByLabel("Minimum", { exact: true }).fill("5");
  await page.getByTestId("op-set-min").click();

  await expect
    .poll(async () => {
      const item = await prisma.stockItem.findFirst({ where: { partId, warehouseId } });
      return item?.minQty;
    })
    .toBe(5);

  await page.reload();
  await expect(page.getByTestId("stock-table")).toContainText("CCS2 cable, 5 m");
  await expect(page.getByTestId("stock-table")).toContainText("180.00 EUR");
  // Six on the shelf, minimum five: nothing to ask for yet.
  await expect(page.getByTestId("restock-requests")).toHaveCount(0);
});

test("issuing a part to a job raises the request US-50 asks for", async ({ page }) => {
  await signInWithPassword(page, OWNER);

  // §49 — the engineer issues the part on the job, through the method §50
  // names. Two off a shelf of six, with a minimum of five.
  const issue = await page.request.post("/api/v1/stock-movements", {
    // §15 — every POST that moves money or energy carries a key, and a part's
    // cost lands in the point's upkeep (§49).
    headers: { "idempotency-key": "e2e-wh-issue-1" },
    data: {
      kind: "ISSUE",
      partId,
      warehouseId,
      qty: 2,
      workOrderId,
      serialNo: "SN-77",
    },
  });
  expect(issue.status()).toBe(201);

  const movement = await prisma.stockMovement.findFirstOrThrow({
    where: { partId, kind: "ISSUE" },
  });
  expect(movement.workOrderId).toBe(workOrderId);
  expect(movement.serialNo).toBe("SN-77");
  // §49 — the cost rides along, for the cost of servicing the point.
  expect(Number(movement.unitCostFiat)).toBe(180);

  const request = await prisma.restockRequest.findFirstOrThrow({
    where: { warehouseId, partId },
  });
  expect(request.status).toBe("OPEN");
  expect(request.qtyAtRequest).toBe(4);
  expect(request.suggestedQty).toBe(1);

  await page.goto(`/en/me/charger-operator/${operatorId}/warehouse`);

  const requests = page.getByTestId("restock-requests");
  await expect(requests).toContainText("CCS2 cable, 5 m");
  await expect(requests).toContainText("4");
  await expect(requests).toContainText("1");

  // The keeper marks it ordered and it leaves the list.
  await page.getByTestId(`ordered-${request.id}`).click();
  await expect
    .poll(async () =>
      (await prisma.restockRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
    )
    .toBe("ORDERED");

  await page.reload();
  await expect(page.getByTestId("restock-requests")).toHaveCount(0);
});

test("a second request is not raised while the first is still open", async ({ page }) => {
  await signInWithPassword(page, OWNER);

  // Back below the minimum again, with the earlier request already ORDERED:
  // a new one is right, and only one.
  const before = await prisma.restockRequest.count({ where: { warehouseId, status: "OPEN" } });
  expect(before).toBe(0);

  let nth = 0;
  for (const qty of [1, 1]) {
    nth += 1;
    const res = await page.request.post("/api/v1/stock-movements", {
      // Two separate intents, so two keys: one key would replay the first.
      headers: { "idempotency-key": `e2e-wh-issue-again-${nth}` },
      data: { kind: "ISSUE", partId, warehouseId, qty, workOrderId },
    });
    expect(res.status()).toBe(201);
  }

  expect(await prisma.restockRequest.count({ where: { warehouseId, status: "OPEN" } })).toBe(1);

  // And the shelf is where the movements say it is.
  const item = await prisma.stockItem.findFirstOrThrow({ where: { partId, warehouseId } });
  expect(item.qty).toBe(2);
});

test("the shelf refuses to go below what is on it", async ({ page }) => {
  await signInWithPassword(page, OWNER);

  const res = await page.request.post("/api/v1/stock-movements", {
    headers: { "idempotency-key": "e2e-wh-issue-too-many" },
    data: { kind: "ISSUE", partId, warehouseId, qty: 99, workOrderId },
  });
  expect(res.status()).toBe(400);

  const item = await prisma.stockItem.findFirstOrThrow({ where: { partId, warehouseId } });
  expect(item.qty).toBe(2);
});

test("the store belongs to its network", async ({ page }) => {
  await signInWithPassword(page, STRANGER);
  const res = await page.goto(`/en/me/charger-operator/${operatorId}/warehouse`);
  expect(res?.status()).toBe(404);
});
