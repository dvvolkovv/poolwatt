// §15 — «Все POST-запросы с ключом идемпотентности». Сообщение из очереди
// §48 досылается по определению: связь умерла на ответе, а не на запросе, и
// без ключа чат наряда получил бы две одинаковые строки.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const session = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => session() }));

const PREFIX = "test_chatidem_";
const ENDPOINT = "POST /v1/chat/rooms/messages";

let ownerUserId: string;
let strangerUserId: string;
let operatorId: string;
let workOrderId: string;
let POST: typeof import("@/app/api/v1/chat/rooms/[key]/messages/route").POST;
let GET: typeof import("@/app/api/v1/chat/rooms/[key]/messages/route").GET;

function request(key: string, body: unknown, idemKey: string | null) {
  return new NextRequest(`http://localhost/api/v1/chat/rooms/${key}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(idemKey ? { "idempotency-key": idemKey } : {}),
    },
    body: JSON.stringify(body),
  });
}

const ctx = (key: string) => ({ params: Promise.resolve({ key }) });

async function wipe() {
  await prisma.idempotencyRecord.deleteMany({ where: { endpoint: ENDPOINT } });
  await prisma.chatRead.deleteMany({ where: { user: { username: { startsWith: PREFIX } } } });
  await prisma.chatMessage.deleteMany({
    where: { workOrder: { operator: { slug: { startsWith: PREFIX } } } },
  });
  await prisma.workOrder.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await wipe();
  const route = await import("@/app/api/v1/chat/rooms/[key]/messages/route");
  POST = route.POST;
  GET = route.GET;

  ownerUserId = (
    await prisma.user.create({ data: { username: `${PREFIX}owner`, passwordHash: "x" } })
  ).id;
  strangerUserId = (
    await prisma.user.create({ data: { username: `${PREFIX}stranger`, passwordHash: "x" } })
  ).id;
  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: `${PREFIX}net`,
        displayName: "Idem chat network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  const pointId = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "Idem chat point" },
    })
  ).id;
  workOrderId = (
    await prisma.workOrder.create({
      data: {
        operatorId,
        pointId,
        type: "REPAIR",
        title: "Idem chat order",
        description: "x",
      },
    })
  ).id;
});

beforeEach(async () => {
  session.mockResolvedValue({
    user: { id: ownerUserId, username: `${PREFIX}owner`, role: "USER" },
  });
  await prisma.idempotencyRecord.deleteMany({ where: { endpoint: ENDPOINT } });
  await prisma.chatMessage.deleteMany({ where: { workOrderId } });
});

afterAll(wipe);

const key = () => `wo-${workOrderId}`;
const body = { body: "ворота с обратной стороны" };

describe("POST /v1/chat/rooms/{key}/messages под §15", () => {
  it("без ключа не принимает", async () => {
    const res = await POST(request(key(), body, null), ctx(key()));
    expect(res.status).toBe(400);
    expect(await prisma.chatMessage.count({ where: { workOrderId } })).toBe(0);
  });

  it("один ключ дважды — одно сообщение", async () => {
    const first = await POST(request(key(), body, "c-1"), ctx(key()));
    const second = await POST(request(key(), body, "c-1"), ctx(key()));

    expect(first.status).toBe(201);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    const firstJson = await first.json();
    const secondJson = await second.json();
    expect(secondJson.message.id).toBe(firstJson.message.id);
    expect(await prisma.chatMessage.count({ where: { workOrderId } })).toBe(1);
  });

  it("тот же ключ с другим текстом — отказ", async () => {
    await POST(request(key(), body, "c-2"), ctx(key()));
    const res = await POST(request(key(), { body: "другое" }, "c-2"), ctx(key()));
    expect(res.status).toBe(409);
    expect(await prisma.chatMessage.count({ where: { workOrderId } })).toBe(1);
  });

  it("два одновременных досыла одного ключа — одно сообщение", async () => {
    const [a, b] = await Promise.all([
      POST(request(key(), body, "c-3"), ctx(key())),
      POST(request(key(), body, "c-3"), ctx(key())),
    ]);
    expect([a.status, b.status].filter((s) => s === 201).length).toBeGreaterThanOrEqual(1);
    expect(await prisma.chatMessage.count({ where: { workOrderId } })).toBe(1);
  });

  it("чужая комната — 404, и сообщения в ней не появляется", async () => {
    session.mockResolvedValue({
      user: { id: strangerUserId, username: `${PREFIX}stranger`, role: "USER" },
    });
    const res = await POST(request(key(), body, "c-4"), ctx(key()));
    expect(res.status).toBe(404);
    expect(await prisma.chatMessage.count({ where: { workOrderId } })).toBe(0);
  });

  it("чтение чужой комнаты — тоже 404", async () => {
    session.mockResolvedValue({
      user: { id: strangerUserId, username: `${PREFIX}stranger`, role: "USER" },
    });
    const res = await GET(request(key(), body, null), ctx(key()));
    expect(res.status).toBe(404);
  });
});
