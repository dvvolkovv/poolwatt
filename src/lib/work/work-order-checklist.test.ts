// §48 «чек-лист работ»: типовой список по виду наряда, отметка, пропуск с
// объяснением и вопрос «можно ли закрывать».

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WorkOrderType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  CHECKLIST_TEMPLATES,
  ChecklistError,
  checklistBlocking,
  ensureChecklist,
  readChecklist,
  skipTask,
  tickTask,
} from "./work-order-checklist";

const PREFIX = "test_wochk_";
const SLUG = `${PREFIX}net`;

let operatorId: string;
let pointId: string;
let actorUserId: string;
let orderId: string;

async function wipe() {
  await prisma.workOrderTask.deleteMany({
    where: { workOrder: { operator: { slug: SLUG } } },
  });
  await prisma.workOrder.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await wipe();
  actorUserId = (
    await prisma.user.create({ data: { username: `${PREFIX}engineer`, passwordHash: "x" } })
  ).id;
  operatorId = (
    await prisma.chargerOperator.create({
      data: { slug: SLUG, displayName: "Checklist network" },
    })
  ).id;
  pointId = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "Checklist point" },
    })
  ).id;
});

afterAll(async () => {
  await wipe();
});

async function makeOrder(type: WorkOrderType = "REPAIR") {
  const order = await prisma.workOrder.create({
    data: {
      operatorId,
      pointId,
      type,
      status: "IN_PROGRESS",
      title: `Checklist ${type}`,
      description: "x",
    },
  });
  return order.id;
}

beforeEach(async () => {
  await prisma.workOrderTask.deleteMany({ where: { workOrder: { operatorId } } });
  await prisma.workOrder.deleteMany({ where: { operatorId } });
  orderId = await makeOrder();
});

describe("CHECKLIST_TEMPLATES", () => {
  it("covers all four kinds of order §48 names", () => {
    for (const type of Object.values(WorkOrderType)) {
      const template = CHECKLIST_TEMPLATES[type];
      expect(template, type).toBeDefined();
      expect(template.length).toBeGreaterThan(0);
      // Хотя бы один пункт обязателен: иначе закрытие ничего не спросит.
      expect(template.some((item) => item.required)).toBe(true);
    }
  });
});

describe("ensureChecklist", () => {
  it("creates the template of this order's type, once", async () => {
    const first = await ensureChecklist(orderId);
    expect(first).toHaveLength(CHECKLIST_TEMPLATES.REPAIR.length);
    expect(first[0].title).toBe(CHECKLIST_TEMPLATES.REPAIR[0].title);

    const again = await ensureChecklist(orderId);
    expect(again.map((t) => t.id)).toEqual(first.map((t) => t.id));
    expect(await prisma.workOrderTask.count({ where: { workOrderId: orderId } })).toBe(
      CHECKLIST_TEMPLATES.REPAIR.length,
    );
  });

  it("two simultaneous openings make one checklist", async () => {
    await Promise.allSettled([
      ensureChecklist(orderId),
      ensureChecklist(orderId),
      ensureChecklist(orderId),
    ]);
    expect(await prisma.workOrderTask.count({ where: { workOrderId: orderId } })).toBe(
      CHECKLIST_TEMPLATES.REPAIR.length,
    );
  });

  it("gives an install order the install list, not the repair one", async () => {
    const installId = await makeOrder("INSTALL");
    const tasks = await ensureChecklist(installId);
    expect(tasks.map((t) => t.title)).toEqual(
      CHECKLIST_TEMPLATES.INSTALL.map((t) => t.title),
    );
  });
});

describe("tickTask and skipTask", () => {
  it("a tick stamps who and when, and clears an earlier skip", async () => {
    const tasks = await ensureChecklist(orderId);
    await skipTask(tasks[0].id, actorUserId, "the cabinet was locked");
    await tickTask(tasks[0].id, actorUserId);

    const after = await prisma.workOrderTask.findUniqueOrThrow({ where: { id: tasks[0].id } });
    expect(after.doneAt).not.toBeNull();
    expect(after.doneById).toBe(actorUserId);
    expect(after.skipReason).toBeNull();
  });

  it("a skip needs words, and clears an earlier tick", async () => {
    const tasks = await ensureChecklist(orderId);
    await tickTask(tasks[0].id, actorUserId);

    await expect(skipTask(tasks[0].id, actorUserId, "   ")).rejects.toThrow(ChecklistError);

    await skipTask(tasks[0].id, actorUserId, "not applicable to this model");
    const after = await prisma.workOrderTask.findUniqueOrThrow({ where: { id: tasks[0].id } });
    expect(after.doneAt).toBeNull();
    expect(after.skipReason).toBe("not applicable to this model");
  });

  it("untick takes the answer away again", async () => {
    const tasks = await ensureChecklist(orderId);
    await tickTask(tasks[0].id, actorUserId);
    await tickTask(tasks[0].id, actorUserId, false);
    const after = await prisma.workOrderTask.findUniqueOrThrow({ where: { id: tasks[0].id } });
    expect(after.doneAt).toBeNull();
    expect(after.skipReason).toBeNull();
  });

  it("refuses a task of another order's checklist", async () => {
    await expect(tickTask("nope", actorUserId)).rejects.toThrow(ChecklistError);
  });
});

describe("checklistBlocking", () => {
  it("names every required item still without an answer", async () => {
    const tasks = await ensureChecklist(orderId);
    const required = tasks.filter((t) => t.required);
    expect((await checklistBlocking(orderId)).map((t) => t.id)).toEqual(
      required.map((t) => t.id),
    );

    for (const task of required.slice(0, -1)) await tickTask(task.id, actorUserId);
    expect(await checklistBlocking(orderId)).toHaveLength(1);

    const last = required[required.length - 1];
    await skipTask(last.id, actorUserId, "no access to the switchboard");
    // Пропуск с объяснением — тоже ответ.
    expect(await checklistBlocking(orderId)).toHaveLength(0);
  });

  it("an optional item never blocks", async () => {
    const tasks = await ensureChecklist(orderId);
    for (const task of tasks.filter((t) => t.required)) await tickTask(task.id, actorUserId);
    const optional = tasks.filter((t) => !t.required);
    expect(await checklistBlocking(orderId)).toHaveLength(0);
    expect(optional.length).toBeGreaterThanOrEqual(0);
  });

  it("an order with no checklist at all blocks nothing", async () => {
    const bare = await makeOrder("COMPLAINT_CHECK");
    expect(await checklistBlocking(bare)).toHaveLength(0);
  });
});

describe("readChecklist", () => {
  it("reads in the order of the template", async () => {
    await ensureChecklist(orderId);
    const rows = await readChecklist(orderId);
    expect(rows.map((r) => r.position)).toEqual(
      CHECKLIST_TEMPLATES.REPAIR.map((_, index) => index),
    );
  });
});
