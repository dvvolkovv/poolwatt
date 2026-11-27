// §15 — «Все POST-запросы с ключом идемпотентности». The US-49 queue re-sends
// by definition: the signal died on the answer, not on the request, and
// without a key the engineer would have written the part off twice.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const session = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => session() }));

const PREFIX = "test_stockidem_";
const ENDPOINT = "POST /v1/stock-movements";

let ownerUserId: string;
let operatorId: string;
let partId: string;
let warehouseId: string;
let workOrderId: string;
let POST: typeof import("@/app/api/v1/stock-movements/route").POST;

function request(body: unknown, key: string | null) {
  return new NextRequest("http://localhost/api/v1/stock-movements", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { "idempotency-key": key } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function wipe() {
  await prisma.idempotencyRecord.deleteMany({ where: { endpoint: ENDPOINT } });
  await prisma.stockMovement.deleteMany({
    where: { part: { operator: { slug: { startsWith: PREFIX } } } },
  });
  await prisma.stockItem.deleteMany({
    where: { part: { operator: { slug: { startsWith: PREFIX } } } },
  });
  await prisma.warehouse.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.sparePart.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.workOrder.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await wipe();
  POST = (await import("@/app/api/v1/stock-movements/route")).POST;

  ownerUserId = (
    await prisma.user.create({
      data: { username: `${PREFIX}owner`, passwordHash: "x" },
    })
  ).id;
  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: `${PREFIX}net`,
        displayName: "Idem network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  warehouseId = (
    await prisma.warehouse.create({ data: { operatorId, name: "Van", kind: "VAN" } })
  ).id;
  partId = (
    await prisma.sparePart.create({ data: { operatorId, sku: "P1", name: "Plate" } })
  ).id;
  const point = await prisma.acceptancePoint.create({
    data: { operatorId, type: "CHARGING_STATION", name: "P" },
  });
  workOrderId = (
    await prisma.workOrder.create({
      data: {
        operatorId,
        pointId: point.id,
        type: "REPAIR",
        title: "Fix",
        description: "Broken",
      },
    })
  ).id;
});

beforeEach(async () => {
  session.mockResolvedValue({
    user: { id: ownerUserId, username: `${PREFIX}owner`, role: "USER" },
  });
  await prisma.idempotencyRecord.deleteMany({ where: { endpoint: ENDPOINT } });
  await prisma.stockMovement.deleteMany({ where: { partId } });
  await prisma.stockItem.deleteMany({ where: { partId } });
  await prisma.stockItem.create({ data: { warehouseId, partId, qty: 5 } });
});

afterAll(async () => {
  await wipe();
});

const issue = () => ({
  kind: "ISSUE" as const,
  partId,
  warehouseId,
  qty: 1,
  workOrderId,
});

describe("POST /v1/stock-movements under §15", () => {
  it("refuses a POST with no key", async () => {
    const res = await POST(request(issue(), null));
    expect(res.status).toBe(400);
    expect(await prisma.stockMovement.count({ where: { partId } })).toBe(0);
  });

  it("writes one movement for two requests with the same key", async () => {
    const first = await POST(request(issue(), "k-1"));
    const second = await POST(request(issue(), "k-1"));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");

    const firstJson = await first.json();
    const secondJson = await second.json();
    expect(secondJson.movement.id).toBe(firstJson.movement.id);

    expect(await prisma.stockMovement.count({ where: { partId } })).toBe(1);
    const item = await prisma.stockItem.findUniqueOrThrow({
      where: { warehouseId_partId: { warehouseId, partId } },
    });
    expect(item.qty).toBe(4);
  });

  it("refuses the same key with a different request body", async () => {
    await POST(request(issue(), "k-2"));
    const res = await POST(request({ ...issue(), qty: 2 }, "k-2"));
    expect(res.status).toBe(409);
    expect(await prisma.stockMovement.count({ where: { partId } })).toBe(1);
  });

  it("lets a refused request be retried with the same key", async () => {
    const body = { ...issue(), qty: 99 };
    const first = await POST(request(body, "k-3"));
    expect(first.status).toBe(400);

    await prisma.stockItem.update({
      where: { warehouseId_partId: { warehouseId, partId } },
      data: { qty: 200 },
    });
    const second = await POST(request(body, "k-3"));
    expect(second.status).toBe(201);
  });

  it("fires two requests with one key at once and moves the part once", async () => {
    const [a, b] = await Promise.all([
      POST(request(issue(), "k-4")),
      POST(request(issue(), "k-4")),
    ]);

    // One of the two either replays the winner's answer or is told to wait;
    // either way the shelf moves by one.
    expect([a.status, b.status].filter((s) => s === 201).length).toBeGreaterThanOrEqual(1);
    expect(await prisma.stockMovement.count({ where: { partId } })).toBe(1);
    const item = await prisma.stockItem.findUniqueOrThrow({
      where: { warehouseId_partId: { warehouseId, partId } },
    });
    expect(item.qty).toBe(4);
  });
});
