// POST /v1/work-orders/{id}/assign — ТЗ §50, §48 «Назначение инженеру или
// бригаде». Ровно одно из двух полей: наряд с двумя исполнителями — ничей.

import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, notFound, ok, parseBody, sessionUser, unauthorized } from "@/lib/exchange/api";
import { readWorkOrderForUser } from "@/lib/work/work-order-access";
import { WorkOrderError, assignWorkOrder } from "@/lib/work/work-order-service";

const bodySchema = z
  .object({
    employeeId: z.string().min(1).optional(),
    crewId: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.employeeId) !== Boolean(v.crewId), {
    message: "Pass either employeeId or crewId, not both",
  });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await sessionUser();
  if (!user) return unauthorized();

  const parsed = await parseBody(request, bodySchema);
  if ("response" in parsed) return parsed.response;

  // Чужой наряд не существует, а не «существует, но нельзя».
  const seen = await readWorkOrderForUser(id, user.id, user.role);
  if (!seen?.canWork) return notFound();

  try {
    const order = await assignWorkOrder(
      id,
      parsed.data.employeeId
        ? { employeeId: parsed.data.employeeId }
        : { crewId: parsed.data.crewId! },
      user.id,
    );
    return ok({
      order: {
        id: order.id,
        status: order.status,
        assigneeId: order.assigneeId,
        crewId: order.crewId,
      },
    });
  } catch (err) {
    if (err instanceof WorkOrderError) return fail(err.message, 400);
    throw err;
  }
}
