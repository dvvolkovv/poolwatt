// Служба чата §48: отправка, системная запись, чтение, список комнат и то,
// что считается непрочитанным.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { inviteEmployee } from "@/lib/staff/staff-service";
import {
  ChatError,
  MAX_CHAT_MESSAGE_LENGTH,
  listMyRooms,
  markRoomSeen,
  postChatMessage,
  readRoomMessages,
  systemChatMessage,
  unreadTotal,
} from "./chat-service";

const PREFIX = "test_chatsvc_";
const SLUG = `${PREFIX}net`;

let operatorId: string;
let ownerUserId: string;
let engineerUserId: string;
let crewEngineerUserId: string;
let strangerUserId: string;
let crewId: string;
let orderId: string;

async function wipe() {
  await prisma.chatRead.deleteMany({ where: { user: { username: { startsWith: PREFIX } } } });
  await prisma.chatMessage.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.workOrder.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.crew.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.employee.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.staffRole.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await wipe();

  const user = async (name: string) =>
    (await prisma.user.create({ data: { username: `${PREFIX}${name}`, passwordHash: "x" } })).id;
  ownerUserId = await user("owner");
  engineerUserId = await user("engineer");
  crewEngineerUserId = await user("crewengineer");
  strangerUserId = await user("stranger");

  operatorId = (
    await prisma.chargerOperator.create({
      data: { slug: SLUG, displayName: "Chat svc net", claimedById: ownerUserId, claimedAt: new Date() },
    })
  ).id;
  const pointId = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "Svc point" },
    })
  ).id;

  const engineer = await inviteEmployee({
    operatorId,
    actorUserId: ownerUserId,
    username: `${PREFIX}engineer`,
    roleName: "ENGINEER",
    pointIds: [],
  });
  const crewEngineer = await inviteEmployee({
    operatorId,
    actorUserId: ownerUserId,
    username: `${PREFIX}crewengineer`,
    roleName: "ENGINEER",
    pointIds: [],
  });
  crewId = (
    await prisma.crew.create({
      data: {
        operatorId,
        name: "Svc crew",
        regions: [],
        members: { create: [{ employeeId: crewEngineer.id, lead: true }] },
      },
    })
  ).id;
  orderId = (
    await prisma.workOrder.create({
      data: {
        operatorId,
        pointId,
        type: "REPAIR",
        title: "Svc order",
        description: "x",
        assigneeId: engineer.id,
        status: "ASSIGNED",
      },
    })
  ).id;
});

afterAll(wipe);

describe("сообщение", () => {
  it("записано и видно в комнате", async () => {
    await postChatMessage({
      key: `wo-${orderId}`,
      userId: engineerUserId,
      role: "USER",
      body: "  Ворота с обратной стороны  ",
    });
    const rows = await readRoomMessages(`wo-${orderId}`, ownerUserId, "USER");
    expect(rows.map((r) => r.body)).toContain("Ворота с обратной стороны");
    expect(rows.at(-1)).toMatchObject({ authorKind: "STAFF", mine: false });
  });

  it("своё сообщение помечено своим", async () => {
    const rows = await readRoomMessages(`wo-${orderId}`, engineerUserId, "USER");
    expect(rows.at(-1)?.mine).toBe(true);
    expect(rows.at(-1)?.authorName).toBe(`${PREFIX}engineer`);
  });

  it("пустое отвергается", async () => {
    await expect(
      postChatMessage({ key: `wo-${orderId}`, userId: engineerUserId, role: "USER", body: "   " }),
    ).rejects.toThrow(ChatError);
  });

  it("слишком длинное отвергается", async () => {
    await expect(
      postChatMessage({
        key: `wo-${orderId}`,
        userId: engineerUserId,
        role: "USER",
        body: "x".repeat(MAX_CHAT_MESSAGE_LENGTH + 1),
      }),
    ).rejects.toThrow(ChatError);
  });

  it("чужая комната — отказ, а не пустой список", async () => {
    await expect(
      postChatMessage({ key: `wo-${orderId}`, userId: strangerUserId, role: "USER", body: "привет" }),
    ).rejects.toThrow(ChatError);
    await expect(readRoomMessages(`wo-${orderId}`, strangerUserId, "USER")).rejects.toThrow(
      ChatError,
    );
  });

  it("системная запись не требует человека", async () => {
    await systemChatMessage(prisma, { kind: "WORK_ORDER", id: orderId }, "Статус: в работе");
    const rows = await readRoomMessages(`wo-${orderId}`, engineerUserId, "USER");
    expect(rows.at(-1)).toMatchObject({ authorKind: "SYSTEM", body: "Статус: в работе" });
  });
});

describe("непрочитанное", () => {
  it("считается до отметки и обнуляется после", async () => {
    await postChatMessage({
      key: `net-${operatorId}`,
      userId: ownerUserId,
      role: "USER",
      body: "смена в семь",
    });
    const before = await listMyRooms(engineerUserId);
    expect(before.find((r) => r.key === `net-${operatorId}`)?.unread).toBe(1);

    await markRoomSeen(`net-${operatorId}`, engineerUserId, "USER");
    const after = await listMyRooms(engineerUserId);
    expect(after.find((r) => r.key === `net-${operatorId}`)?.unread).toBe(0);
  });

  it("своё сообщение непрочитанным не бывает", async () => {
    await postChatMessage({
      key: `net-${operatorId}`,
      userId: engineerUserId,
      role: "USER",
      body: "понял",
    });
    const rooms = await listMyRooms(engineerUserId);
    expect(rooms.find((r) => r.key === `net-${operatorId}`)?.unread).toBe(0);
  });

  it("одно число для хаба складывает комнаты", async () => {
    await postChatMessage({
      key: `net-${operatorId}`,
      userId: ownerUserId,
      role: "USER",
      body: "и ещё одно",
    });
    expect(await unreadTotal(engineerUserId)).toBe(1);
  });

  it("отметка в чужой комнате невозможна", async () => {
    await expect(markRoomSeen(`wo-${orderId}`, strangerUserId, "USER")).rejects.toThrow(ChatError);
  });
});

describe("список комнат", () => {
  it("у инженера — сеть и его открытый наряд", async () => {
    const rooms = await listMyRooms(engineerUserId);
    expect(rooms.map((r) => r.key)).toEqual(
      expect.arrayContaining([`net-${operatorId}`, `wo-${orderId}`]),
    );
    expect(rooms.map((r) => r.key)).not.toContain(`crew-${crewId}`);
  });

  it("у участника бригады — ещё и бригада", async () => {
    const rooms = await listMyRooms(crewEngineerUserId);
    expect(rooms.map((r) => r.key)).toEqual(
      expect.arrayContaining([`net-${operatorId}`, `crew-${crewId}`]),
    );
  });

  it("у постороннего комнат нет", async () => {
    expect(await listMyRooms(strangerUserId)).toEqual([]);
  });

  it("закрытый наряд в списке не висит", async () => {
    await prisma.workOrder.update({
      where: { id: orderId },
      data: { status: "VERIFIED", closedAt: new Date() },
    });
    const rooms = await listMyRooms(engineerUserId);
    expect(rooms.map((r) => r.key)).not.toContain(`wo-${orderId}`);
  });

  it("а переписка закрытого наряда остаётся читаемой", async () => {
    const rows = await readRoomMessages(`wo-${orderId}`, engineerUserId, "USER");
    expect(rows.length).toBeGreaterThan(0);
  });
});
