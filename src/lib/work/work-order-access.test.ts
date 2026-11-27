// Одно право на наряд — §48 и §47.
//
// До этой работы вопрос «что этот человек может с этим нарядом» решался в
// трёх местах по-разному: `mayTouch` в действиях кабинета, `readEngineerStock`
// в снимке склада и `mayReadThroughWorkOrder` в маршруте фотографии.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { inviteEmployee } from "@/lib/staff/staff-service";
import { readWorkOrderForUser } from "./work-order-access";

const PREFIX = "test_woacc_";
const SLUG = `${PREFIX}net`;
const ZONE = "TWOACC";

let operatorId: string;
let ownerUserId: string;
let adminUserId: string;
let engineerUserId: string;
let viewerUserId: string;
let strangerUserId: string;
let engineerBUserId: string;
let pointA: string;
let pointB: string;
let orderId: string;
let crewOrderId: string;
let crewEngineerUserId: string;
let companyOrderId: string;
let companyOwnerId: string;

async function wipe() {
  await prisma.workOrder.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.workOrder.deleteMany({
    where: { company: { legalName: { startsWith: PREFIX } } },
  });
  await prisma.crew.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.employee.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.staffRole.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
}

beforeAll(async () => {
  await wipe();

  const user = async (name: string) =>
    (await prisma.user.create({ data: { username: `${PREFIX}${name}`, passwordHash: "x" } })).id;
  ownerUserId = await user("owner");
  adminUserId = await user("platform");
  engineerUserId = await user("engineer");
  viewerUserId = await user("viewer");
  strangerUserId = await user("stranger");
  companyOwnerId = await user("coowner");
  engineerBUserId = await user("engineerb");
  crewEngineerUserId = await user("crewengineer");

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "Access network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  pointA = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "Point A" },
    })
  ).id;
  pointB = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "Point B" },
    })
  ).id;

  const engineer = await inviteEmployee({
    operatorId,
    actorUserId: ownerUserId,
    username: `${PREFIX}engineer`,
    roleName: "ENGINEER",
    pointIds: [],
  });
  await inviteEmployee({
    operatorId,
    actorUserId: ownerUserId,
    username: `${PREFIX}viewer`,
    roleName: "VIEWER",
    pointIds: [],
  });
  // §47 — инженер, которому дали только пункт B.
  await inviteEmployee({
    operatorId,
    actorUserId: ownerUserId,
    username: `${PREFIX}engineerb`,
    roleName: "ENGINEER",
    pointIds: [pointB],
  });

  // §48 — участник бригады. Пункты ему урезаны до B, а наряд на A: право
  // работать он получает от назначения бригаде, ровно как личный
  // исполнитель получает его от своего назначения.
  const crewEngineer = await inviteEmployee({
    operatorId,
    actorUserId: ownerUserId,
    username: `${PREFIX}crewengineer`,
    roleName: "ENGINEER",
    pointIds: [pointB],
  });
  const crew = await prisma.crew.create({
    data: {
      operatorId,
      name: "Access crew",
      regions: [],
      members: { create: [{ employeeId: crewEngineer.id, lead: true }] },
    },
  });

  orderId = (
    await prisma.workOrder.create({
      data: {
        operatorId,
        pointId: pointA,
        type: "REPAIR",
        title: "Access test order",
        description: "x",
        assigneeId: engineer.id,
      },
    })
  ).id;
  crewOrderId = (
    await prisma.workOrder.create({
      data: {
        operatorId,
        pointId: pointA,
        type: "REPAIR",
        title: "Crew order",
        description: "x",
        crewId: crew.id,
        status: "ASSIGNED",
      },
    })
  ).id;

  const zone = await prisma.gridZone.create({
    data: { code: ZONE, country: "SK", name: "Access zone", currency: "EUR" },
  });
  const company = await prisma.company.create({
    data: {
      legalName: `${PREFIX}co`,
      country: "SK",
      regNumber: `${PREFIX}reg`,
      type: "PRODUCER",
      kybStatus: "APPROVED",
      ownerUserId: companyOwnerId,
    },
  });
  const asset = await prisma.asset.create({
    data: {
      companyId: company.id,
      gridZoneId: zone.id,
      kind: "SOLAR",
      name: "Access array",
      capacityKw: new Prisma.Decimal(10),
      status: "ACTIVE",
    },
  });
  companyOrderId = (
    await prisma.workOrder.create({
      data: {
        companyId: company.id,
        assetId: asset.id,
        type: "MAINTENANCE",
        title: "Company order",
        description: "x",
      },
    })
  ).id;
});

afterAll(async () => {
  await wipe();
});

describe("readWorkOrderForUser", () => {
  it("lets the assignee work the order", async () => {
    const seen = await readWorkOrderForUser(orderId, engineerUserId, "USER");
    expect(seen?.canWork).toBe(true);
    expect(seen?.employeeId).toBeTruthy();
  });

  it("lets the network's owner work it", async () => {
    const seen = await readWorkOrderForUser(orderId, ownerUserId, "USER");
    expect(seen?.canWork).toBe(true);
  });

  it("lets the platform operator work it", async () => {
    const seen = await readWorkOrderForUser(orderId, adminUserId, "ADMIN");
    expect(seen?.canWork).toBe(true);
  });

  it("gives a viewer reading and not working", async () => {
    const seen = await readWorkOrderForUser(orderId, viewerUserId, "USER");
    expect(seen?.canRead).toBe(true);
    expect(seen?.canWork).toBe(false);
  });

  it("§47 — an engineer given another point does not see this order at all", async () => {
    const seen = await readWorkOrderForUser(orderId, engineerBUserId, "USER");
    expect(seen).toBeNull();
  });

  it("a stranger gets nothing", async () => {
    expect(await readWorkOrderForUser(orderId, strangerUserId, "USER")).toBeNull();
  });

  it("answers the owner of the company an asset order belongs to", async () => {
    const seen = await readWorkOrderForUser(companyOrderId, companyOwnerId, "USER");
    expect(seen?.canWork).toBe(true);
    const outsider = await readWorkOrderForUser(companyOrderId, ownerUserId, "USER");
    expect(outsider).toBeNull();
  });

  it("§48 — a member of the assigned crew works the order", async () => {
    const seen = await readWorkOrderForUser(crewOrderId, crewEngineerUserId, "USER");
    expect(seen?.canWork).toBe(true);
    expect(seen?.employeeId).toBeTruthy();
  });

  it("§48 — the same person without the crew order does not see the point at all", async () => {
    // Тот же человек, тот же пункт A, но наряд не его бригады: остаётся
    // правило §47 про урезанные пункты.
    expect(await readWorkOrderForUser(orderId, crewEngineerUserId, "USER")).toBeNull();
  });

  it("§48 — a stranger is not in the crew either", async () => {
    expect(await readWorkOrderForUser(crewOrderId, strangerUserId, "USER")).toBeNull();
  });

  it("an order that does not exist is null, not a throw", async () => {
    expect(await readWorkOrderForUser("nope", engineerUserId, "USER")).toBeNull();
  });
});
