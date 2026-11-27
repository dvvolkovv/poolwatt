// US-48 and US-54 — the work order, ТЗ §48.
//
// Two criteria drive this: the order reaches the engineer within a minute
// with the address, the fault and the parts to bring (US-48), and a technical
// ticket produces one by itself (US-54). What belongs here is where an order
// comes from, that the same fault never makes two, and that its status moves
// the way §48 says.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  WorkOrderError,
  advanceWorkOrder,
  assignWorkOrder,
  createWorkOrder,
  notifyPendingWorkOrders,
  openWorkOrdersForAlerts,
} from "./work-order-service";
import { inviteEmployee } from "@/lib/staff/staff-service";
import { ensureChecklist, skipTask, tickTask } from "./work-order-checklist";
import { saveSignature } from "./work-order-media";

const PREFIX = "test_wo_";
const SLUG = `${PREFIX}net`;
const ZONE = "TESTWO";

let operatorId: string;
let ownerUserId: string;
let engineerEmployeeId: string;
let strangerEmployeeId: string;
let pointId: string;
let assetId: string;
let bareOperatorId: string;
let barePointId: string;
let crewIdOfThisNetwork: string;
let emptyCrewId: string;
let strangerCrewId: string;

const sent: { to: string; subject: string }[] = [];
const mailer = async (to: string, subject: string) => {
  sent.push({ to, subject });
};

/** The sweep is platform-wide by design; a test must look only at its own. */
const notifyMine = () => notifyPendingWorkOrders({ sendTo: mailer, scope: { operatorId } });

async function wipe() {
  await prisma.workOrder.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.crew.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.employee.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.staffRole.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.assetAlert.deleteMany({ where: { asset: { gridZone: { code: ZONE } } } });
  await prisma.asset.deleteMany({ where: { gridZone: { code: ZONE } } });
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
}

beforeAll(async () => {
  await wipe();

  ownerUserId = (
    await prisma.user.upsert({
      where: { username: `${PREFIX}owner` },
      update: { email: `${PREFIX}owner@example.test`, emailVerified: new Date() },
      create: {
        username: `${PREFIX}owner`,
        passwordHash: "x",
        email: `${PREFIX}owner@example.test`,
        emailVerified: new Date(),
      },
    })
  ).id;
  const engineerUser = await prisma.user.upsert({
    where: { username: `${PREFIX}engineer` },
    update: { email: `${PREFIX}engineer@example.test`, emailVerified: new Date() },
    create: {
      username: `${PREFIX}engineer`,
      passwordHash: "x",
      email: `${PREFIX}engineer@example.test`,
      emailVerified: new Date(),
    },
  });
  await prisma.user.upsert({
    where: { username: `${PREFIX}other` },
    update: {},
    create: { username: `${PREFIX}other`, passwordHash: "x" },
  });

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "Work order test network",
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
        name: "WO test point",
        status: "PUBLISHED",
        country: "SK",
        city: "Bratislava",
        addressLine: "Hlavná 7",
        howToFind: "level -2, by the lift",
      },
    })
  ).id;

  engineerEmployeeId = (
    await inviteEmployee({
      operatorId,
      actorUserId: ownerUserId,
      username: engineerUser.username,
      roleName: "ENGINEER",
      pointIds: [],
    })
  ).id;

  // Somebody on another network entirely, to check assignment refuses them.
  const otherOperator = await prisma.chargerOperator.create({
    data: {
      slug: `${SLUG}-other`,
      displayName: "Another network",
      claimedById: ownerUserId,
      claimedAt: new Date(),
    },
  });
  strangerEmployeeId = (
    await inviteEmployee({
      operatorId: otherOperator.id,
      actorUserId: ownerUserId,
      username: `${PREFIX}other`,
      roleName: "ENGINEER",
      pointIds: [],
    })
  ).id;

  // Сеть без единого сотрудника: кому-то же надо проверить, что наряд
  // остаётся `NEW`, а письмо уходит владельцу.
  const bare = await prisma.chargerOperator.create({
    data: {
      slug: `${SLUG}-bare`,
      displayName: "Network with no staff",
      claimedById: ownerUserId,
      claimedAt: new Date(),
    },
  });
  bareOperatorId = bare.id;
  barePointId = (
    await prisma.acceptancePoint.create({
      data: {
        operatorId: bare.id,
        type: "CHARGING_STATION",
        name: "Bare point",
        status: "PUBLISHED",
        country: "SK",
        city: "Nitra",
      },
    })
  ).id;

  // §48 — бригады: своя с инженером, своя пустая и чужая.
  crewIdOfThisNetwork = (
    await prisma.crew.create({
      data: {
        operatorId,
        name: "WO test crew",
        regions: [],
        members: { create: [{ employeeId: engineerEmployeeId, lead: true }] },
      },
    })
  ).id;
  emptyCrewId = (
    await prisma.crew.create({ data: { operatorId, name: "WO empty crew", regions: [] } })
  ).id;
  strangerCrewId = (
    await prisma.crew.create({
      data: { operatorId: otherOperator.id, name: "Their crew", regions: [] },
    })
  ).id;

  // An asset with an alarm, the §30 source of an order.
  const zone = await prisma.gridZone.create({
    data: { code: ZONE, country: "SK", name: "WO zone", currency: "EUR" },
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
        name: "WO test array",
        capacityKw: new Prisma.Decimal(10),
        status: "ACTIVE",
      },
    })
  ).id;
});

beforeEach(async () => {
  sent.length = 0;
  await prisma.workOrder.deleteMany({
    where: { OR: [{ operatorId }, { operatorId: bareOperatorId }, { assetId }] },
  });
  await prisma.assetAlert.deleteMany({ where: { assetId } });
});

afterAll(async () => {
  await prisma.crew.deleteMany({ where: { operator: { slug: `${SLUG}-other` } } });
  await prisma.workOrder.deleteMany({ where: { operator: { slug: `${SLUG}-bare` } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: `${SLUG}-bare` } } });
  await prisma.chargerOperator.deleteMany({
    where: { slug: { in: [`${SLUG}-other`, `${SLUG}-bare`] } },
  });
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("createWorkOrder — §48", () => {
  it("carries the address, the fault and the parts to bring (US-48)", async () => {
    const order = await createWorkOrder({
      operatorId,
      pointId,
      type: "REPAIR",
      priority: "URGENT",
      title: "Cable damaged",
      description: "The CCS cable is cut near the plug",
      partsNeeded: ["CCS2 cable 5 m"],
    });

    expect(order.status).toBe("NEW");
    expect(order.partsNeeded).toEqual(["CCS2 cable 5 m"]);
    expect(order.notifiedAt).toBeNull();
    const withPoint = await prisma.workOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { point: true },
    });
    expect(withPoint.point?.addressLine).toBe("Hlavná 7");
    expect(withPoint.point?.howToFind).toContain("lift");
  });

  it("refuses an empty description — an engineer cannot act on nothing", async () => {
    await expect(
      createWorkOrder({
        operatorId,
        pointId,
        type: "REPAIR",
        title: "x",
        description: "   ",
      }),
    ).rejects.toThrow(WorkOrderError);
  });
});

describe("openWorkOrdersForAlerts — an alarm makes an order (§30, §48)", () => {
  it("opens one order per open alarm, with the fault in it", async () => {
    const alert = await prisma.assetAlert.create({
      data: { assetId, kind: "TELEMETRY_ANOMALY", note: "reading above capacity" },
    });

    const opened = await openWorkOrdersForAlerts({ assetId });

    expect(opened).toBe(1);
    const order = await prisma.workOrder.findFirstOrThrow({
      where: { sourceAlertId: alert.id },
    });
    expect(order.type).toBe("REPAIR");
    expect(order.description).toContain("reading above capacity");
    expect(order.partsNeeded.length).toBeGreaterThan(0);
  });

  it("never opens a second order for the same alarm", async () => {
    await prisma.assetAlert.create({
      data: { assetId, kind: "LINK_LOST", note: "silent since noon" },
    });

    await openWorkOrdersForAlerts({ assetId });
    const second = await openWorkOrdersForAlerts({ assetId });

    expect(second).toBe(0);
    expect(await prisma.workOrder.count({ where: { assetId } })).toBe(1);
  });

  it("leaves a resolved alarm alone", async () => {
    await prisma.assetAlert.create({
      data: {
        assetId,
        kind: "LINK_LOST",
        note: "fixed already",
        resolvedAt: new Date(),
        resolvedBy: ownerUserId,
      },
    });

    expect(await openWorkOrdersForAlerts({ assetId })).toBe(0);
  });
});

describe("assignWorkOrder — §48", () => {
  async function fresh() {
    return createWorkOrder({
      operatorId,
      pointId,
      type: "REPAIR",
      title: "Check the cable",
      description: "Customer says it does not latch",
    });
  }

  it("assigns an engineer of this network and moves the order on", async () => {
    const order = await fresh();

    const assigned = await assignWorkOrder(order.id, { employeeId: engineerEmployeeId }, ownerUserId);

    expect(assigned.assigneeId).toBe(engineerEmployeeId);
    expect(assigned.status).toBe("ASSIGNED");
  });

  it("refuses somebody from another network", async () => {
    const order = await fresh();
    await expect(
      assignWorkOrder(order.id, { employeeId: strangerEmployeeId }, ownerUserId),
    ).rejects.toThrow(/network/i);
  });

  // §48 — «инженеру **или** бригаде». Двух исполнителей у наряда не бывает:
  // наряд с двумя исполнителями — ничей наряд.
  it("assigning a crew clears the person", async () => {
    const order = await fresh();
    await assignWorkOrder(order.id, { employeeId: engineerEmployeeId }, ownerUserId);

    const after = await assignWorkOrder(order.id, { crewId: crewIdOfThisNetwork }, ownerUserId);

    expect(after.crewId).toBe(crewIdOfThisNetwork);
    expect(after.assigneeId).toBeNull();
    expect(after.status).toBe("ASSIGNED");
  });

  it("assigning a person clears the crew", async () => {
    const order = await fresh();
    await assignWorkOrder(order.id, { crewId: crewIdOfThisNetwork }, ownerUserId);

    const after = await assignWorkOrder(order.id, { employeeId: engineerEmployeeId }, ownerUserId);

    expect(after.assigneeId).toBe(engineerEmployeeId);
    expect(after.crewId).toBeNull();
  });

  it("refuses a crew of another network", async () => {
    const order = await fresh();
    await expect(
      assignWorkOrder(order.id, { crewId: strangerCrewId }, ownerUserId),
    ).rejects.toThrow(/network/i);
  });

  it("refuses a crew without a single engineer who may work", async () => {
    const order = await fresh();
    await expect(
      assignWorkOrder(order.id, { crewId: emptyCrewId }, ownerUserId),
    ).rejects.toThrow(/nobody|empty/i);
  });
});

// §48 «наряд создаётся … автоматически по аварии оборудования» плюс критерий
// US-48 «наряд приходит в течение минуты». Минута адресована инженеру, а не
// владельцу сети, и ночью диспетчера нет — значит наряд, которого никто не
// касался руками, должен найти исполнителя сам.
describe("createWorkOrder — автоматическое назначение", () => {
  it("assigns an order nobody touched to the best candidate", async () => {
    const order = await createWorkOrder({
      operatorId,
      pointId,
      type: "REPAIR",
      title: "Cable damaged",
      description: "Reported by a customer",
      autoAssign: true,
    });

    expect(order.assigneeId).toBe(engineerEmployeeId);
    expect(order.status).toBe("ASSIGNED");
  });

  it("records the automatic assignment as the system's", async () => {
    const order = await createWorkOrder({
      operatorId,
      pointId,
      type: "REPAIR",
      title: "Audited assignment",
      description: "x",
      autoAssign: true,
    });

    const entry = await prisma.auditLog.findFirst({
      where: { entity: "WorkOrder", entityId: order.id, action: "workorder.assigned" },
    });
    expect(entry?.actor).toBe("system");
  });

  it("leaves the order NEW when the network has nobody to send", async () => {
    const order = await createWorkOrder({
      operatorId: bareOperatorId,
      pointId: barePointId,
      type: "REPAIR",
      title: "Nobody home",
      description: "x",
      autoAssign: true,
    });

    expect(order.assigneeId).toBeNull();
    expect(order.status).toBe("NEW");
  });

  it("leaves an alarm on a generation asset unassigned: a company has no network staff", async () => {
    await prisma.assetAlert.create({
      data: { assetId, kind: "LINK_LOST", note: "No readings for an hour" },
    });

    expect(await openWorkOrdersForAlerts({ assetId })).toBe(1);
    const order = await prisma.workOrder.findFirstOrThrow({ where: { assetId } });
    expect(order.assigneeId).toBeNull();
    expect(order.crewId).toBeNull();
    expect(order.status).toBe("NEW");
  });
});

describe("advanceWorkOrder — the statuses of §48", () => {
  async function assigned() {
    const order = await createWorkOrder({
      operatorId,
      pointId,
      type: "REPAIR",
      title: "Replace the cable",
      description: "Cut insulation",
    });
    return assignWorkOrder(order.id, { employeeId: engineerEmployeeId }, ownerUserId);
  }

  /**
   * §48 — закрытие спрашивает чек-лист и подпись. Фикстуры дают и то и
   * другое; что бывает без них, проверяет отдельный describe ниже.
   */
  async function workedOnSite(orderId: string) {
    const tasks = await ensureChecklist(orderId);
    for (const task of tasks.filter((t) => t.required)) await tickTask(task.id, ownerUserId);
    await saveSignature(orderId, {
      signerKind: "ENGINEER",
      signerName: "Fixture engineer",
      bytes: Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(16, 2),
      ]),
      signedById: ownerUserId,
    });
  }

  it("walks новый → назначен → в пути → в работе → выполнен → проверен", async () => {
    let order = await assigned();
    await workedOnSite(order.id);
    for (const next of ["EN_ROUTE", "IN_PROGRESS", "DONE", "VERIFIED"] as const) {
      order = await advanceWorkOrder(order.id, next, ownerUserId, null);
      expect(order.status).toBe(next);
    }
    expect(order.closedAt).not.toBeNull();
  });

  it("allows the detour through waiting for a part", async () => {
    let order = await assigned();
    order = await advanceWorkOrder(order.id, "EN_ROUTE", ownerUserId, null);
    order = await advanceWorkOrder(order.id, "IN_PROGRESS", ownerUserId, null);
    order = await advanceWorkOrder(order.id, "WAITING_PART", ownerUserId, "needs a 5 m cable");
    expect(order.status).toBe("WAITING_PART");

    order = await advanceWorkOrder(order.id, "IN_PROGRESS", ownerUserId, null);
    expect(order.status).toBe("IN_PROGRESS");
  });

  it("refuses to jump from new straight to verified", async () => {
    const order = await createWorkOrder({
      operatorId,
      pointId,
      type: "REPAIR",
      title: "x",
      description: "y",
    });
    await expect(
      advanceWorkOrder(order.id, "VERIFIED", ownerUserId, null),
    ).rejects.toThrow(/cannot go/i);
  });

  it("keeps the engineer's report on the order", async () => {
    let order = await assigned();
    await workedOnSite(order.id);
    order = await advanceWorkOrder(order.id, "EN_ROUTE", ownerUserId, null);
    order = await advanceWorkOrder(order.id, "IN_PROGRESS", ownerUserId, null);
    order = await advanceWorkOrder(order.id, "DONE", ownerUserId, "Replaced the cable, tested");

    expect(order.report).toContain("Replaced the cable");
  });
});

describe("notifyPendingWorkOrders — within a minute (US-48)", () => {
  it("tells the assignee and marks the order told", async () => {
    const order = await createWorkOrder({
      operatorId,
      pointId,
      type: "REPAIR",
      title: "Cable damaged",
      description: "cut insulation",
    });
    await assignWorkOrder(order.id, { employeeId: engineerEmployeeId }, ownerUserId);

    const count = await notifyMine();

    expect(count).toBe(1);
    expect(sent.map((s) => s.to)).toContain(`${PREFIX}engineer@example.test`);
    expect(sent[0].subject).toContain("Cable damaged");
    const stored = await prisma.workOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.notifiedAt).not.toBeNull();
  });

  it("tells the network owner when nobody is assigned yet", async () => {
    await createWorkOrder({
      operatorId,
      pointId,
      type: "REPAIR",
      title: "Unassigned fault",
      description: "nobody yet",
    });

    await notifyMine();

    expect(sent.map((s) => s.to)).toContain(`${PREFIX}owner@example.test`);
  });

  it("does not tell anybody twice", async () => {
    await createWorkOrder({
      operatorId,
      pointId,
      type: "REPAIR",
      title: "Once only",
      description: "x",
    });
    await notifyMine();
    sent.length = 0;

    expect(await notifyMine()).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("leaves the order owing when the mail fails", async () => {
    const order = await createWorkOrder({
      operatorId,
      pointId,
      type: "REPAIR",
      title: "Mail fails",
      description: "x",
    });

    await notifyPendingWorkOrders({
      scope: { operatorId },
      sendTo: async () => {
        throw new Error("smtp down");
      },
    });

    const stored = await prisma.workOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.notifiedAt).toBeNull();
  });
});

// §48 — «чек-лист работ … подпись, закрытие». Чек-лист, который закрытие не
// спрашивает, — украшение, а подпись — единственное свидетельство, что работу
// приняли.
describe("closing a work order asks for the checklist and the signature", () => {
  const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(16, 4),
  ]);

  async function inProgress() {
    const order = await createWorkOrder({
      operatorId,
      pointId,
      type: "REPAIR",
      title: "Closing rules",
      description: "x",
    });
    const assignedOrder = await assignWorkOrder(order.id, { employeeId: engineerEmployeeId }, ownerUserId);
    return advanceWorkOrder(assignedOrder.id, "IN_PROGRESS", ownerUserId, null);
  }

  async function sign(orderId: string) {
    await saveSignature(orderId, {
      signerKind: "SITE_CONTACT",
      signerName: "Jana Horváthová",
      bytes: PNG,
      signedById: ownerUserId,
    });
  }

  it("refuses while a required item has no answer", async () => {
    const order = await inProgress();
    await ensureChecklist(order.id);
    await sign(order.id);
    await expect(
      advanceWorkOrder(order.id, "DONE", ownerUserId, "done"),
    ).rejects.toThrow(/checklist/i);
  });

  it("refuses without a signature", async () => {
    const order = await inProgress();
    const tasks = await ensureChecklist(order.id);
    for (const task of tasks.filter((t) => t.required)) await tickTask(task.id, ownerUserId);
    await expect(
      advanceWorkOrder(order.id, "DONE", ownerUserId, "done"),
    ).rejects.toThrow(/signature/i);
  });

  it("closes once every item is answered and somebody signed", async () => {
    const order = await inProgress();
    const tasks = await ensureChecklist(order.id);
    const required = tasks.filter((t) => t.required);
    for (const task of required.slice(0, -1)) await tickTask(task.id, ownerUserId);
    // Пропуск с объяснением — тоже ответ.
    await skipTask(required[required.length - 1].id, ownerUserId, "the switchboard was locked");
    await sign(order.id);

    const done = await advanceWorkOrder(order.id, "DONE", ownerUserId, "cable replaced");
    expect(done.status).toBe("DONE");
  });

  it("does not hold a cancelled order to either: it was not done", async () => {
    const order = await inProgress();
    await ensureChecklist(order.id);
    const cancelled = await advanceWorkOrder(order.id, "CANCELLED", ownerUserId, "nothing wrong");
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("does not hold an order nobody ever opened on site", async () => {
    // Чек-листа нет: спрашивать за список, который человеку не показали,
    // нельзя. Подпись всё равно нужна — её спрашивают всегда.
    const order = await inProgress();
    await sign(order.id);
    const done = await advanceWorkOrder(order.id, "DONE", ownerUserId, "closed from the office");
    expect(done.status).toBe("DONE");
  });
});
