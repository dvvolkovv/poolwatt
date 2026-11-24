"use server";

// Work orders from the cabinet — ТЗ §48, US-48.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { advanceWorkOrder, assignWorkOrder } from "@/lib/work/work-order-service";
import { can, readEmployee } from "@/lib/staff/staff-service";

export type WorkResult = { ok: true } | { ok: false; formError: string };

/** Owner of the network or company, the platform operator, or staff with the right. */
async function mayTouch(workOrderId: string, userId: string, isAdmin: boolean) {
  const order = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      operator: { select: { claimedById: true } },
      company: { select: { ownerUserId: true } },
      assignee: { select: { userId: true } },
    },
  });
  if (!order) return null;
  if (isAdmin) return order;
  if (order.operator?.claimedById === userId) return order;
  if (order.company?.ownerUserId === userId) return order;
  if (order.assignee?.userId === userId) return order;
  if (order.operatorId) {
    const employee = await readEmployee(order.operatorId, userId);
    if (employee && can(employee, "workorders.write", order.pointId ?? undefined)) {
      return order;
    }
  }
  return null;
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

  const order = await mayTouch(parsed.data.workOrderId, session.user.id, session.user.role === "ADMIN");
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

const assignSchema = z.object({
  workOrderId: z.string().min(1),
  employeeId: z.string().min(1),
});

export async function assignOrder(input: unknown): Promise<WorkResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };

  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const order = await mayTouch(parsed.data.workOrderId, session.user.id, session.user.role === "ADMIN");
  if (!order) return { ok: false, formError: "Not your work order." };

  try {
    await assignWorkOrder(parsed.data.workOrderId, parsed.data.employeeId, session.user.id);
    revalidatePath("/[locale]/me/work-orders/[id]", "page");
    return { ok: true };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not assign." };
  }
}
