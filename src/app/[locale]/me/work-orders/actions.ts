"use server";

// Work orders from the cabinet — ТЗ §48, US-48.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { advanceWorkOrder, assignWorkOrder } from "@/lib/work/work-order-service";
import { readWorkOrderForUser } from "@/lib/work/work-order-access";
import {
  ChecklistError,
  readChecklist,
  skipTask,
  tickTask,
} from "@/lib/work/work-order-checklist";

export type WorkResult = { ok: true } | { ok: false; formError: string };

/**
 * Право на наряд — одно, в `work-order-access.ts`. Раньше здесь жил свой
 * `mayTouch`, и таких проверок было три на один вопрос.
 */
async function mayTouch(workOrderId: string, userId: string, role: string) {
  const seen = await readWorkOrderForUser(workOrderId, userId, role);
  return seen?.canWork ? seen.order : null;
}

const advanceSchema = z.object({
  workOrderId: z.string().min(1),
  status: z.enum([
    "ASSIGNED",
    "EN_ROUTE",
    "IN_PROGRESS",
    "WAITING_PART",
    "DONE",
    "VERIFIED",
    "CANCELLED",
  ]),
  report: z.string().trim().max(4000).nullable(),
});

export async function advanceOrder(input: unknown): Promise<WorkResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };

  const parsed = advanceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const order = await mayTouch(parsed.data.workOrderId, session.user.id, session.user.role);
  if (!order) return { ok: false, formError: "Not your work order." };

  try {
    await advanceWorkOrder(
      parsed.data.workOrderId,
      parsed.data.status,
      session.user.id,
      parsed.data.report,
    );
    revalidatePath("/[locale]/me/work-orders/[id]", "page");
    revalidatePath("/[locale]/me/work-orders", "page");
    return { ok: true };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not update." };
  }
}

// §48 — исполнитель либо человек, либо бригада. Ровно одно поле.
const assignSchema = z
  .object({
    workOrderId: z.string().min(1),
    employeeId: z.string().min(1).optional(),
    crewId: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.employeeId) !== Boolean(v.crewId), {
    message: "Pick either an engineer or a crew",
  });

export async function assignOrder(input: unknown): Promise<WorkResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };

  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const order = await mayTouch(parsed.data.workOrderId, session.user.id, session.user.role);
  if (!order) return { ok: false, formError: "Not your work order." };

  try {
    await assignWorkOrder(
      parsed.data.workOrderId,
      parsed.data.employeeId
        ? { employeeId: parsed.data.employeeId }
        : { crewId: parsed.data.crewId! },
      session.user.id,
    );
    revalidatePath("/[locale]/me/work-orders/[id]", "page");
    return { ok: true };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not assign." };
  }
}

// §48 «чек-лист работ» — отметка с монитора. Тот же модуль, что у телефона:
// двух правил про один чек-лист быть не должно.
const taskSchema = z.object({
  workOrderId: z.string().min(1),
  taskId: z.string().min(1),
  done: z.boolean().optional(),
  skipReason: z.string().trim().max(2000).optional().nullable(),
});

export async function answerOrderTask(input: unknown): Promise<WorkResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };

  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const order = await mayTouch(parsed.data.workOrderId, session.user.id, session.user.role);
  if (!order) return { ok: false, formError: "Not your work order." };

  const mine = await readChecklist(parsed.data.workOrderId);
  if (!mine.some((t) => t.id === parsed.data.taskId)) {
    return { ok: false, formError: "Not found." };
  }

  try {
    if (parsed.data.skipReason) {
      await skipTask(parsed.data.taskId, session.user.id, parsed.data.skipReason);
    } else {
      await tickTask(parsed.data.taskId, session.user.id, parsed.data.done ?? true);
    }
  } catch (err) {
    return {
      ok: false,
      formError: err instanceof ChecklistError ? err.message : "Could not save.",
    };
  }
  revalidatePath("/[locale]/me/work-orders/[id]", "page");
  return { ok: true };
}
