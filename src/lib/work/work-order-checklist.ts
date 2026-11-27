// §48 «чек-лист работ».
//
// Три решения, которые стоит прочитать прежде кода.
//
// 1. Список типовой и живёт в коде. ТЗ не просит у партнёра конструктора
//    чек-листов, а выдуманный конструктор — лишняя сущность и лишний экран.
//    Четыре вида наряда §48 получают по списку.
//
// 2. Строки создаются **лениво, при первом открытии наряда**, а не при его
//    создании. Причина практическая: в базе уже лежат наряды, и чек-лист,
//    появляющийся только у будущих, означал бы, что §48 выполнен для
//    половины. Создание опирается на уникальность `(workOrderId, position)`,
//    поэтому два одновременных открытия дают один чек-лист.
//
// 3. Пропуск — это ответ, но ответ со словами. Пункт либо сделан, либо
//    объяснено, почему нет. Чек-лист, который закрытие не спрашивает, —
//    украшение: то же решение, по которому «Решено» в §51 требует слов.

import { type WorkOrderTask, WorkOrderType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export class ChecklistError extends Error {}

export interface ChecklistItem {
  title: string;
  required: boolean;
}

/** §48 — четыре вида наряда и типовые работы каждого. */
export const CHECKLIST_TEMPLATES: Record<WorkOrderType, ChecklistItem[]> = {
  INSTALL: [
    { title: "Site and mounting checked against the project", required: true },
    { title: "Equipment mounted and earthed", required: true },
    { title: "Power connected and insulation measured", required: true },
    { title: "Connectors and cables tested under load", required: true },
    { title: "Meter reading recorded and the point registered", required: true },
    { title: "Signage and markings in place", required: false },
  ],
  MAINTENANCE: [
    { title: "Enclosure, cables and connectors inspected", required: true },
    { title: "Contacts cleaned, fixings tightened", required: true },
    { title: "Earthing and insulation measured", required: true },
    { title: "Test charge completed", required: true },
    { title: "Firmware version checked", required: false },
  ],
  REPAIR: [
    { title: "Fault reproduced or its cause found", required: true },
    { title: "Power isolated before work", required: true },
    { title: "Faulty part replaced or repaired", required: true },
    { title: "Test charge after the repair", required: true },
    { title: "Faulty part labelled for return", required: false },
  ],
  COMPLAINT_CHECK: [
    { title: "What the customer reported reproduced or ruled out", required: true },
    { title: "Connector and cable inspected", required: true },
    { title: "Price and meter reading compared with the receipt", required: true },
    { title: "Test charge completed", required: false },
  ],
};

export interface ChecklistRow {
  id: string;
  position: number;
  title: string;
  required: boolean;
  doneAt: string | null;
  skipReason: string | null;
}

function toRow(task: WorkOrderTask): ChecklistRow {
  return {
    id: task.id,
    position: task.position,
    title: task.title,
    required: task.required,
    doneAt: task.doneAt?.toISOString() ?? null,
    skipReason: task.skipReason,
  };
}

/**
 * Чек-лист этого наряда, создавая его из типового списка, если его ещё нет.
 * Безопасно звать сколько угодно раз и одновременно.
 */
export async function ensureChecklist(workOrderId: string): Promise<ChecklistRow[]> {
  const order = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true, type: true },
  });
  if (!order) throw new ChecklistError("Work order not found");

  const existing = await prisma.workOrderTask.findMany({
    where: { workOrderId },
    orderBy: { position: "asc" },
  });
  if (existing.length > 0) return existing.map(toRow);

  const template = CHECKLIST_TEMPLATES[order.type];
  // `skipDuplicates` вместе с уникальностью `(workOrderId, position)` — это и
  // есть защита от гонки: проигравший просто ничего не вставит.
  await prisma.workOrderTask.createMany({
    data: template.map((item, position) => ({
      workOrderId,
      position,
      title: item.title,
      required: item.required,
    })),
    skipDuplicates: true,
  });

  return readChecklist(workOrderId);
}

export async function readChecklist(workOrderId: string): Promise<ChecklistRow[]> {
  const tasks = await prisma.workOrderTask.findMany({
    where: { workOrderId },
    orderBy: { position: "asc" },
  });
  return tasks.map(toRow);
}

/** Отметить пункт сделанным, или снять отметку (`done = false`). */
export async function tickTask(
  taskId: string,
  actorUserId: string,
  done = true,
): Promise<ChecklistRow> {
  const task = await prisma.workOrderTask.findUnique({ where: { id: taskId } });
  if (!task) throw new ChecklistError("No such checklist item");

  const updated = await prisma.workOrderTask.update({
    where: { id: taskId },
    data: done
      ? { doneAt: new Date(), doneById: actorUserId, skipReason: null }
      : { doneAt: null, doneById: null, skipReason: null },
  });
  return toRow(updated);
}

/** Пропустить пункт с объяснением. Объяснение обязательно. */
export async function skipTask(
  taskId: string,
  actorUserId: string,
  reason: string,
): Promise<ChecklistRow> {
  const words = reason.trim();
  if (words.length === 0) {
    throw new ChecklistError("A skipped item needs a reason: that is the whole point of it");
  }
  const task = await prisma.workOrderTask.findUnique({ where: { id: taskId } });
  if (!task) throw new ChecklistError("No such checklist item");

  const updated = await prisma.workOrderTask.update({
    where: { id: taskId },
    data: { skipReason: words, doneAt: null, doneById: actorUserId },
  });
  return toRow(updated);
}

/**
 * Обязательные пункты, по которым ответа нет. Пустой список значит «закрывать
 * можно», в том числе у наряда, у которого чек-листа ещё нет: спрашивать за
 * список, который человеку не показали, нельзя.
 */
export async function checklistBlocking(workOrderId: string): Promise<ChecklistRow[]> {
  const tasks = await prisma.workOrderTask.findMany({
    where: { workOrderId, required: true, doneAt: null, skipReason: null },
    orderBy: { position: "asc" },
  });
  return tasks.map(toRow);
}
