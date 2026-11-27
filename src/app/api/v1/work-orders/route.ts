// GET/POST /v1/work-orders — ТЗ §50, §48 «Наряд создаётся вручную или
// автоматически по аварии оборудования».
//
// Денег и энергии метод не двигает, поэтому `Idempotency-Key` не требуется —
// то же решение, что у `POST /v1/pipeline`.

import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, notFound, ok, parseBody, sessionUser, unauthorized } from "@/lib/exchange/api";
import { prisma } from "@/lib/prisma";
import { can, readEmployee } from "@/lib/staff/staff-service";
import { readDispatchBoard, suggestAssignees } from "@/lib/work/assignment";
import { WorkOrderError, createWorkOrder } from "@/lib/work/work-order-service";

const createSchema = z.object({
  operatorId: z.string().min(1),
  pointId: z.string().min(1),
  type: z.enum(["INSTALL", "MAINTENANCE", "REPAIR", "COMPLAINT_CHECK"]),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().min(1).max(4000),
  partsNeeded: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
});

export async function GET(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const operatorId = req.nextUrl.searchParams.get("operatorId");
  if (!operatorId) return fail("operatorId is required", 400);

  const board = await readDispatchBoard(operatorId, user.id);
  if (!board) return notFound();

  return ok({
    canAssign: board.canAssign,
    orders: board.rows,
  });
}

export async function POST(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const parsed = await parseBody(req, createSchema);
  if ("response" in parsed) return parsed.response;
  const input = parsed.data;

  // Пункт должен быть этой сети, иначе наряд повис бы между двумя сетями.
  const point = await prisma.acceptancePoint.findUnique({
    where: { id: input.pointId },
    select: { operatorId: true },
  });
  if (!point || point.operatorId !== input.operatorId) return notFound();

  const operator = await prisma.chargerOperator.findUnique({
    where: { id: input.operatorId },
    select: { claimedById: true },
  });
  if (!operator) return notFound();
  if (operator.claimedById !== user.id) {
    const employee = await readEmployee(input.operatorId, user.id);
    if (!employee || !can(employee, "workorders.write", input.pointId)) return notFound();
  }

  try {
    // Ручное создание не назначает само: тот, кто заводит наряд, выбирает
    // исполнителя сам. Подбор отдаётся рядом, чтобы было из чего выбирать.
    const order = await createWorkOrder({
      operatorId: input.operatorId,
      pointId: input.pointId,
      type: input.type,
      priority: input.priority ?? "NORMAL",
      title: input.title,
      description: input.description,
      partsNeeded: input.partsNeeded ?? [],
    });
    const candidates = await suggestAssignees(order.id);
    return ok(
      {
        order: { id: order.id, status: order.status, title: order.title },
        candidates,
      },
      201,
    );
  } catch (err) {
    if (err instanceof WorkOrderError) return fail(err.message, 400);
    throw err;
  }
}
