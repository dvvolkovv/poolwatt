"use server";

// Рабочее место диспетчера — ТЗ §48. Действия тонкие: правило живёт в
// `assignment.ts` и `work-order-service.ts`, здесь только вход с формы.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, readEmployee } from "@/lib/staff/staff-service";
import { suggestAssignees, type Candidate } from "@/lib/work/assignment";
import { WorkOrderError, assignWorkOrder, createWorkOrder } from "@/lib/work/work-order-service";

export type DispatchResult =
  | { ok: true }
  | { ok: true; candidates: Candidate[] }
  | { ok: false; formError: string };

/**
 * Кто может распоряжаться нарядами сети: владелец или сотрудник с правом
 * `workorders.write`. Для пункта право спрашивается с пунктом — §47.
 */
async function mayDispatch(
  operatorId: string,
  userId: string,
  pointId?: string,
): Promise<boolean> {
  const operator = await prisma.chargerOperator.findUnique({
    where: { id: operatorId },
    select: { claimedById: true },
  });
  if (!operator) return false;
  if (operator.claimedById === userId) return true;

  const employee = await readEmployee(operatorId, userId);
  return Boolean(employee && can(employee, "workorders.write", pointId));
}

const createSchema = z.object({
  operatorId: z.string().min(1),
  pointId: z.string().min(1),
  type: z.enum(["INSTALL", "MAINTENANCE", "REPAIR", "COMPLAINT_CHECK"]),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().min(1).max(4000),
  /** «Что привезти» — строка через запятую, как её пишет человек. */
  partsNeeded: z.string().trim().max(500).optional(),
});

export async function createOrder(input: unknown): Promise<DispatchResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const point = await prisma.acceptancePoint.findUnique({
    where: { id: data.pointId },
    select: { operatorId: true },
  });
  if (!point || point.operatorId !== data.operatorId) {
    return { ok: false, formError: "Not your point." };
  }
  if (!(await mayDispatch(data.operatorId, session.user.id, data.pointId))) {
    return { ok: false, formError: "Not your network." };
  }

  try {
    // Ручное создание не назначает само: тот, кто заводит наряд, стоит рядом
    // и выбирает исполнителя сам.
    const order = await createWorkOrder({
      operatorId: data.operatorId,
      pointId: data.pointId,
      type: data.type,
      priority: data.priority,
      title: data.title,
      description: data.description,
      partsNeeded: (data.partsNeeded ?? "")
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)
        .slice(0, 20),
    });
    revalidatePath("/[locale]/me/charger-operator/[id]/dispatch", "page");
    return { ok: true, candidates: await suggestAssignees(order.id) };
  } catch (err) {
    return {
      ok: false,
      formError: err instanceof WorkOrderError ? err.message : "Could not create the order.",
    };
  }
}

const assignSchema = z
  .object({
    operatorId: z.string().min(1),
    workOrderId: z.string().min(1),
    employeeId: z.string().min(1).optional(),
    crewId: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.employeeId) !== Boolean(v.crewId), {
    message: "Pick either an engineer or a crew",
  });

export async function assignFromQueue(input: unknown): Promise<DispatchResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };

  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const order = await prisma.workOrder.findUnique({
    where: { id: data.workOrderId },
    select: { operatorId: true, pointId: true },
  });
  if (!order || order.operatorId !== data.operatorId) {
    return { ok: false, formError: "Not your work order." };
  }
  if (!(await mayDispatch(data.operatorId, session.user.id, order.pointId ?? undefined))) {
    return { ok: false, formError: "Not your network." };
  }

  try {
    await assignWorkOrder(
      data.workOrderId,
      data.employeeId ? { employeeId: data.employeeId } : { crewId: data.crewId! },
      session.user.id,
    );
    revalidatePath("/[locale]/me/charger-operator/[id]/dispatch", "page");
    revalidatePath("/[locale]/me/work-orders", "page");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      formError: err instanceof WorkOrderError ? err.message : "Could not assign.",
    };
  }
}

/** Подбор для одной строки очереди — тот же, что у метода §50. */
export async function candidatesFor(
  operatorId: string,
  workOrderId: string,
): Promise<DispatchResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };

  const order = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: { operatorId: true, pointId: true },
  });
  if (!order || order.operatorId !== operatorId) {
    return { ok: false, formError: "Not your work order." };
  }
  if (!(await mayDispatch(operatorId, session.user.id, order.pointId ?? undefined))) {
    return { ok: false, formError: "Not your network." };
  }
  return { ok: true, candidates: await suggestAssignees(workOrderId) };
}
