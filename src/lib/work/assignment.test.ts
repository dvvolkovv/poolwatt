// §48 «Назначение инженеру или бригаде с учётом региона и загрузки».
//
// Здесь проверяется ровно то, чего в коде не было до N-3-б: что загрузка —
// это настоящее число открытых нарядов (включая бригадные, иначе она врёт), и
// что порядок кандидатов — регион, потом загрузка, а не алфавит.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { inviteEmployee } from "@/lib/staff/staff-service";
import { createWorkOrder } from "./work-order-service";
import { openLoad, suggestAssignees } from "./assignment";

const PREFIX = "test_asg_";
const SLUG = `${PREFIX}net`;
const ZONE = "TESTASG";

let operatorId: string;
let ownerUserId: string;
/** Инженер города Košice. */
let kosice: string;
/** Инженер без списка городов — вся сеть. */
let anywhere: string;
/** Инженер другого города. */
let bratislava: string;
/** Поддержка: право `tickets.write`, но не `workorders.write`. */
let support: string;
/** Инженер, которому оставили один чужой пункт. */
let scoped: string;
let crewId: string;
let pointId: string;
let otherPointId: string;
let assetId: string;

async function wipe() {
  await prisma.workOrder.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.crew.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.employee.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.staffRole.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.workOrder.deleteMany({ where: { asset: { gridZone: { code: ZONE } } } });
  await prisma.asset.deleteMany({ where: { gridZone: { code: ZONE } } });
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
}

async function makeUser(name: string) {
  return prisma.user.upsert({
    where: { username: `${PREFIX}${name}` },
    update: { email: `${PREFIX}${name}@example.test`, emailVerified: new Date() },
    create: {
      username: `${PREFIX}${name}`,
      passwordHash: "x",
      email: `${PREFIX}${name}@example.test`,
      emailVerified: new Date(),
    },
  });
}

/** Открытый наряд на наш пункт — чтобы считать загрузку. */
async function order(on: { assigneeId?: string; crewId?: string } = {}) {
  const created = await createWorkOrder({
    operatorId,
    pointId,
    type: "REPAIR",
    priority: "NORMAL",
    title: "Load filler",
    description: "Something to carry as load",
  });
  if (on.assigneeId || on.crewId) {
    await prisma.workOrder.update({
      where: { id: created.id },
      data: {
        assigneeId: on.assigneeId ?? null,
        crewId: on.crewId ?? null,
        status: "ASSIGNED",
      },
    });
  }
  return created;
}

beforeAll(async () => {
  await wipe();

  ownerUserId = (await makeUser("owner")).id;
  const u = {
    kosice: await makeUser("kosice"),
    anywhere: await makeUser("anywhere"),
    bratislava: await makeUser("bratislava"),
    support: await makeUser("support"),
    scoped: await makeUser("scoped"),
  };

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "Assignment test network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;

  pointId = (
    await prisma.acceptancePoint.create({
      data: {
        operatorId,
        type: "CHARGING_STATION",
        name: "Assignment point",
        status: "PUBLISHED",
        country: "SK",
        city: "Košice",
        addressLine: "Hlavná 1",
      },
    })
  ).id;
  otherPointId = (
    await prisma.acceptancePoint.create({
      data: {
        operatorId,
        type: "CHARGING_STATION",
        name: "Another point",
        status: "PUBLISHED",
        country: "SK",
        city: "Bratislava",
      },
    })
  ).id;

  const invite = async (username: string, roleName: string, pointIds: string[] = []) =>
    (
      await inviteEmployee({ operatorId, actorUserId: ownerUserId, username, roleName, pointIds })
    ).id;

  kosice = await invite(u.kosice.username, "ENGINEER");
  anywhere = await invite(u.anywhere.username, "ENGINEER");
  bratislava = await invite(u.bratislava.username, "ENGINEER");
  support = await invite(u.support.username, "SUPPORT");
  scoped = await invite(u.scoped.username, "ENGINEER", [otherPointId]);

  await prisma.employee.update({ where: { id: kosice }, data: { regions: ["Košice"] } });
  await prisma.employee.update({ where: { id: bratislava }, data: { regions: ["Bratislava"] } });
  await prisma.employee.update({ where: { id: scoped }, data: { regions: ["Košice"] } });

  crewId = (
    await prisma.crew.create({
      data: {
        operatorId,
        name: "East crew",
        regions: ["Košice"],
        members: {
          create: [
            { employeeId: kosice, lead: true },
            { employeeId: anywhere },
          ],
        },
      },
    })
  ).id;

  // Наряд объекта генерации: у компании-производителя сотрудников §47 нет.
  const zone = await prisma.gridZone.create({
    data: { code: ZONE, country: "SK", name: "Assignment zone", currency: "EUR" },
  });
  const company = await prisma.company.create({
    data: {
      legalName: `${PREFIX}co`,
      country: "SK",
      regNumber: `${PREFIX}reg`,
      type: "PRODUCER",
      kybStatus: "APPROVED",
      ownerUserId,
    },
  });
  assetId = (
    await prisma.asset.create({
      data: {
        companyId: company.id,
        gridZoneId: zone.id,
        kind: "SOLAR",
        name: "Assignment array",
        capacityKw: 10,
        status: "ACTIVE",
      },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.workOrder.deleteMany({ where: { OR: [{ operatorId }, { assetId }] } });
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("openLoad — §48 «с учётом … загрузки»", () => {
  it("counts the orders assigned to the person", async () => {
    await order({ assigneeId: kosice });
    await order({ assigneeId: kosice });
    await expect(openLoad(kosice)).resolves.toBe(2);
    await expect(openLoad(bratislava)).resolves.toBe(0);
  });

  it("counts a crew order as load for every member", async () => {
    await order({ crewId });
    await expect(openLoad(kosice)).resolves.toBe(1);
    await expect(openLoad(anywhere)).resolves.toBe(1);
    await expect(openLoad(bratislava)).resolves.toBe(0);
  });

  it("does not count a closed order", async () => {
    const done = await order({ assigneeId: kosice });
    await prisma.workOrder.update({ where: { id: done.id }, data: { status: "VERIFIED" } });
    await expect(openLoad(kosice)).resolves.toBe(0);
  });
});

describe("suggestAssignees — §48 «с учётом региона и загрузки»", () => {
  it("ranks an exact city first, the whole network next, another region last", async () => {
    const target = await order();
    const list = await suggestAssignees(target.id);

    const people = list.filter((c) => c.kind === "employee");
    expect(people.map((c) => c.id)).toEqual([kosice, anywhere, bratislava]);
    expect(people.map((c) => c.reason)).toEqual(["city", "network", "region"]);
  });

  it("puts the least busy first inside the same reason", async () => {
    await order({ assigneeId: kosice });
    const target = await order();

    const list = await suggestAssignees(target.id);
    // Кошицкий инженер по региону первый, но занят; второй кошицкий —
    // `scoped` — этот пункт ему не разрешён, поэтому не кандидат вовсе.
    const first = list.find((c) => c.kind === "employee" && c.reason === "city");
    expect(first?.id).toBe(kosice);
    expect(first?.openOrders).toBe(1);
  });

  it("offers the crew next to the people and says how busy it is", async () => {
    await order({ assigneeId: kosice });
    await order({ assigneeId: kosice });
    const target = await order();

    const list = await suggestAssignees(target.id);
    const crew = list.find((c) => c.kind === "crew");
    expect(crew?.id).toBe(crewId);
    expect(crew?.reason).toBe("city");
    // Бригада занята настолько, насколько занят самый занятый в ней: два, а
    // не четыре (сумма) и не один (среднее).
    expect(crew?.openOrders).toBe(2);
  });

  it("is not a candidate without workorders.write", async () => {
    const target = await order();
    const list = await suggestAssignees(target.id);
    expect(list.some((c) => c.id === support)).toBe(false);
  });

  it("is not a candidate outside its point scope", async () => {
    const target = await order();
    const list = await suggestAssignees(target.id);
    expect(list.some((c) => c.id === scoped)).toBe(false);
  });

  it("has no candidates for a generation asset order", async () => {
    const company = await prisma.asset.findUniqueOrThrow({
      where: { id: assetId },
      select: { companyId: true },
    });
    const target = await createWorkOrder({
      companyId: company.companyId,
      assetId,
      type: "REPAIR",
      priority: "HIGH",
      title: "Inverter silent",
      description: "No readings for an hour",
    });
    await expect(suggestAssignees(target.id)).resolves.toEqual([]);
  });

  it("knows nothing about an order that does not exist", async () => {
    await expect(suggestAssignees("nope")).resolves.toEqual([]);
  });
});
