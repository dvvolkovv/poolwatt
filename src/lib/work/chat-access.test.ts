// Кто в комнате §48. Один вопрос — один ответ: комната наряда спрашивает
// существующее право на наряд, комната сети — состав сети §47, комната
// бригады — её список и диспетчера.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { inviteEmployee } from "@/lib/staff/staff-service";
import { readRoomForUser } from "./chat-access";

const PREFIX = "test_chatacc_";
const SLUG = `${PREFIX}net`;
const OTHER_SLUG = `${PREFIX}other`;

let operatorId: string;
let otherOperatorId: string;
let ownerUserId: string;
let adminUserId: string;
let engineerUserId: string;
let crewEngineerUserId: string;
let dispatcherUserId: string;
let accountantUserId: string;
let otherEngineerUserId: string;
let strangerUserId: string;
let companyOwnerUserId: string;
let crewId: string;
let orderId: string;
let companyOrderId: string;

async function wipe() {
  await prisma.chatMessage.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.workOrder.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.workOrder.deleteMany({
    where: { company: { legalName: { startsWith: PREFIX } } },
  });
  await prisma.crew.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.employee.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.staffRole.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await wipe();

  const user = async (name: string) =>
    (await prisma.user.create({ data: { username: `${PREFIX}${name}`, passwordHash: "x" } })).id;
  ownerUserId = await user("owner");
  adminUserId = await user("platform");
  engineerUserId = await user("engineer");
  crewEngineerUserId = await user("crewengineer");
  dispatcherUserId = await user("dispatcher");
  accountantUserId = await user("accountant");
  otherEngineerUserId = await user("otherengineer");
  strangerUserId = await user("stranger");
  companyOwnerUserId = await user("coowner");

  operatorId = (
    await prisma.chargerOperator.create({
      data: { slug: SLUG, displayName: "Chat network", claimedById: ownerUserId, claimedAt: new Date() },
    })
  ).id;
  otherOperatorId = (
    await prisma.chargerOperator.create({
      data: { slug: OTHER_SLUG, displayName: "Other network" },
    })
  ).id;
  const pointId = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "Chat point" },
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
  await inviteEmployee({
    operatorId,
    actorUserId: ownerUserId,
    username: `${PREFIX}dispatcher`,
    roleName: "DISPATCHER",
    pointIds: [],
  });
  await inviteEmployee({
    operatorId,
    actorUserId: ownerUserId,
    username: `${PREFIX}accountant`,
    roleName: "ACCOUNTANT",
    pointIds: [],
  });

  const other = await prisma.chargerOperator.update({
    where: { id: otherOperatorId },
    data: { claimedById: strangerUserId, claimedAt: new Date() },
  });
  await inviteEmployee({
    operatorId: other.id,
    actorUserId: strangerUserId,
    username: `${PREFIX}otherengineer`,
    roleName: "ENGINEER",
    pointIds: [],
  });

  crewId = (
    await prisma.crew.create({
      data: {
        operatorId,
        name: "Chat crew",
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
        title: "Chat order",
        description: "x",
        assigneeId: engineer.id,
      },
    })
  ).id;

  const company = await prisma.company.create({
    data: {
      legalName: `${PREFIX}co`,
      country: "SK",
      regNumber: `${PREFIX}reg`,
      type: "PRODUCER",
      kybStatus: "APPROVED",
      ownerUserId: companyOwnerUserId,
    },
  });
  companyOrderId = (
    await prisma.workOrder.create({
      data: {
        companyId: company.id,
        type: "MAINTENANCE",
        title: "Company chat order",
        description: "x",
      },
    })
  ).id;
});

afterAll(wipe);

describe("комната наряда", () => {
  it("исполнитель в ней и говорит", async () => {
    const seen = await readRoomForUser(`wo-${orderId}`, engineerUserId, "USER");
    expect(seen).toMatchObject({ canWrite: true, title: "Chat order" });
  });

  it("диспетчер с одним workorders.read тоже говорит: разговор — не работа в наряде", async () => {
    const seen = await readRoomForUser(`wo-${orderId}`, dispatcherUserId, "USER");
    expect(seen?.canWrite).toBe(true);
  });

  it("бухгалтер своей сети наряда не видит: §47 не даёт ему workorders.read", async () => {
    expect(await readRoomForUser(`wo-${orderId}`, accountantUserId, "USER")).toBeNull();
  });

  it("инженер чужой сети не видит ничего", async () => {
    expect(await readRoomForUser(`wo-${orderId}`, otherEngineerUserId, "USER")).toBeNull();
  });

  it("владелец компании — в комнате наряда по своему объекту", async () => {
    const seen = await readRoomForUser(`wo-${companyOrderId}`, companyOwnerUserId, "USER");
    expect(seen?.canWrite).toBe(true);
  });

  it("ADMIN — в любой комнате", async () => {
    expect(await readRoomForUser(`wo-${companyOrderId}`, adminUserId, "ADMIN")).not.toBeNull();
    expect(await readRoomForUser(`net-${operatorId}`, adminUserId, "ADMIN")).not.toBeNull();
    expect(await readRoomForUser(`crew-${crewId}`, adminUserId, "ADMIN")).not.toBeNull();
  });
});

describe("комната сети", () => {
  it("бухгалтер в ней: чат команды — общий", async () => {
    const seen = await readRoomForUser(`net-${operatorId}`, accountantUserId, "USER");
    expect(seen).toMatchObject({ canWrite: true, title: "Chat network" });
  });

  it("владелец сети в ней", async () => {
    expect(await readRoomForUser(`net-${operatorId}`, ownerUserId, "USER")).not.toBeNull();
  });

  it("сотрудник чужой сети — нет", async () => {
    expect(await readRoomForUser(`net-${operatorId}`, otherEngineerUserId, "USER")).toBeNull();
  });

  it("посторонний — нет", async () => {
    expect(await readRoomForUser(`net-${operatorId}`, companyOwnerUserId, "USER")).toBeNull();
  });
});

describe("комната бригады", () => {
  it("участник в ней", async () => {
    const seen = await readRoomForUser(`crew-${crewId}`, crewEngineerUserId, "USER");
    expect(seen).toMatchObject({ canWrite: true, title: "Chat crew" });
  });

  it("диспетчер в чужую бригаду не входит: о работе говорят в чате наряда", async () => {
    expect(await readRoomForUser(`crew-${crewId}`, dispatcherUserId, "USER")).toBeNull();
  });

  it("владелец сети в ней: он отвечает за сеть", async () => {
    expect(await readRoomForUser(`crew-${crewId}`, ownerUserId, "USER")).not.toBeNull();
  });

  it("инженер не из этой бригады — нет", async () => {
    expect(await readRoomForUser(`crew-${crewId}`, engineerUserId, "USER")).toBeNull();
  });

  it("бухгалтер — нет: у него нет workorders.read", async () => {
    expect(await readRoomForUser(`crew-${crewId}`, accountantUserId, "USER")).toBeNull();
  });
});

describe("не комната", () => {
  it("мусорный ключ", async () => {
    expect(await readRoomForUser("nope-1", engineerUserId, "USER")).toBeNull();
  });

  it("несуществующая сеть", async () => {
    expect(await readRoomForUser("net-nosuchoperator", engineerUserId, "USER")).toBeNull();
  });
});
