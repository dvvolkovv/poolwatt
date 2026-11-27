// §51.4 — байты фотографии, которую клиент приложил к заявке.
//
// Два права, а не одно. Фотографию видит тот, кому видна заявка (§51), и
// тот, кому виден наряд, несущий ту же фотографию (§48 «фото клиента»).
// Второе обязательно: у роли ENGINEER нет права `tickets.read`, и это
// правильно — поломанный кабель ему нужен, переписка клиента с поддержкой
// нет.

import { NextRequest, NextResponse } from "next/server";
import { sessionUser } from "@/lib/exchange/api";
import { prisma } from "@/lib/prisma";
import { can, readEmployee } from "@/lib/staff/staff-service";
import { readTicketForUser } from "@/lib/work/ticket-access";
import { readTicketPhoto } from "@/lib/work/ticket-photos";

const missing = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const viewer = await sessionUser();
  if (!viewer) return missing();

  const photo = await readTicketPhoto(key);
  if (!photo) return missing();

  const allowed =
    (await readTicketForUser(photo.ticketId, viewer.id, viewer.role)) !== null ||
    (await mayReadThroughWorkOrder(key, viewer.id, viewer.role));
  if (!allowed) return missing();

  return new NextResponse(new Uint8Array(photo.bytes), {
    headers: {
      "Content-Type": photo.contentType,
      "Content-Length": String(photo.bytes.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}

/** §48 — инженер на наряде. */
async function mayReadThroughWorkOrder(
  key: string,
  userId: string,
  role: string,
): Promise<boolean> {
  const order = await prisma.workOrder.findFirst({
    where: { photos: { has: key } },
    select: {
      pointId: true,
      operatorId: true,
      companyId: true,
      assignee: { select: { userId: true } },
      operator: { select: { claimedById: true } },
      company: { select: { ownerUserId: true } },
    },
  });
  if (!order) return false;
  if (role === "ADMIN") return true;
  if (order.assignee?.userId === userId) return true;
  if (order.operator?.claimedById === userId) return true;
  if (order.company?.ownerUserId === userId) return true;
  if (!order.operatorId) return false;

  const employee = await readEmployee(order.operatorId, userId);
  return Boolean(employee && can(employee, "workorders.read", order.pointId ?? undefined));
}
