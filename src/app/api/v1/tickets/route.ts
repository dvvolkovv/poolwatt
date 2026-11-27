// GET /v1/tickets — метод из §50. Очередь сети по праву `tickets.read` §47,
// в области пунктов сотрудника.

import type { NextRequest } from "next/server";
import { fail, notFound, ok, unauthorized, sessionUser } from "@/lib/exchange/api";
import { prisma } from "@/lib/prisma";
import { readOperatorQueueAccess } from "@/lib/work/ticket-access";
import { toListRow } from "@/lib/work/ticket-view";

export async function GET(request: NextRequest) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const operatorId = request.nextUrl.searchParams.get("operatorId");
  if (!operatorId) return fail("operatorId is required", 400);

  const access = await readOperatorQueueAccess(operatorId, user.id, user.role);
  // Чужая сеть не «нельзя», а «нет такой».
  if (!access) return notFound();

  const open = request.nextUrl.searchParams.get("status") !== "all";
  const tickets = await prisma.ticket.findMany({
    where: {
      operatorId,
      ...(open ? { status: { in: ["OPEN", "IN_PROGRESS"] } } : {}),
      ...(access.pointIds
        ? { OR: [{ pointId: { in: access.pointIds } }, { pointId: null }] }
        : {}),
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: 200,
    include: {
      point: { select: { name: true, city: true } },
      reporter: { select: { username: true } },
      messages: { orderBy: { createdAt: "asc" }, take: 50 },
    },
  });
  const now = new Date();
  return ok({ tickets: tickets.map((ticket) => toListRow(ticket, now)) });
}
