// POST /v1/work-orders/{id}/status — §48 «наряд закрывается без связи и
// синхронизируется позже».
//
// До этой работы метода не было вовсе: очередь офлайна объявляла вид записи
// `workorder.status`, никто её не ставил и отправлять было некуда. То есть
// US-49 построила механизм «закрывается без связи» наполовину — запчасть
// списывалась офлайн, а сам наряд офлайн не закрывался.

import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  fail,
  idempotencyKey,
  idempotent,
  notFound,
  parseBody,
  sessionUser,
  unauthorized,
} from "@/lib/exchange/api";
import { readWorkOrderForUser } from "@/lib/work/work-order-access";
import { WorkOrderError, advanceWorkOrder } from "@/lib/work/work-order-service";

const bodySchema = z.object({
  status: z.enum([
    "ASSIGNED",
    "EN_ROUTE",
    "IN_PROGRESS",
    "WAITING_PART",
    "DONE",
    "VERIFIED",
    "CANCELLED",
  ]),
  report: z.string().trim().max(4000).optional().nullable(),
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
  const body = parsed.data;

  const seen = await readWorkOrderForUser(id, user.id, user.role);
  if (!seen?.canWork) return notFound();

  try {
    return await idempotent({
      endpoint: "POST /v1/work-orders/{id}/status",
      key: idempotencyKey(request),
      userKey: user.id,
      body: { id, ...body },
      run: async () => {
        const order = await advanceWorkOrder(id, body.status, user.id, body.report ?? null);
        return { status: 200, data: { order: { id: order.id, status: order.status } } };
      },
    });
  } catch (err) {
    if (err instanceof WorkOrderError) return fail(err.message, 400);
    throw err;
  }
}
