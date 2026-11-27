// Кому можно читать заявку и кому можно в ней писать — §51 и §47.
//
// До этой работы вопрос не стоял: у заявки не было ни одного действия, и
// право `tickets.write` из §47 не проверяла ни одна строка кода. Решение
// одно на все экраны и все методы, потому что право, проверенное в двух
// местах, расходится — и расходится в сторону «да».
//
// Инженер сюда не входит. §47 даёт роли ENGINEER наряды и склад, но не
// `tickets.read`, и это правильно: поломанный кабель ему нужен, переписка
// клиента с поддержкой — нет. Фотографию с места он всё равно увидит, её
// отдаёт маршрут файла по праву на наряд.

import type { Ticket, TicketAuthorKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can, readEmployee } from "@/lib/staff/staff-service";

export interface TicketView {
  ticket: Ticket;
  canRead: true;
  canWrite: boolean;
  /** С какой стороны этот человек говорит, если он говорит. */
  authorKind: Extract<TicketAuthorKind, "CUSTOMER" | "SUPPORT">;
}

/**
 * Заявка, если этому человеку её видно, иначе null. Null означает 404:
 * чужой заявки не существует, а не «существует, но нельзя».
 */
export async function readTicketForUser(
  ticketId: string,
  userId: string,
  role: string,
): Promise<TicketView | null> {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) return null;

  // Заявитель — своя заявка. Анонимную заявку (reporterId пуст) не может
  // присвоить никто: привязать её потом не к кому.
  if (ticket.reporterId && ticket.reporterId === userId) {
    return { ticket, canRead: true, canWrite: true, authorKind: "CUSTOMER" };
  }

  if (role === "ADMIN") {
    return { ticket, canRead: true, canWrite: true, authorKind: "SUPPORT" };
  }

  const operator = await prisma.chargerOperator.findUnique({
    where: { id: ticket.operatorId },
    select: { claimedById: true },
  });
  if (operator?.claimedById && operator.claimedById === userId) {
    return { ticket, canRead: true, canWrite: true, authorKind: "SUPPORT" };
  }

  const employee = await readEmployee(ticket.operatorId, userId);
  if (!employee) return null;
  const scope = ticket.pointId ?? undefined;
  if (!can(employee, "tickets.read", scope)) return null;
  return {
    ticket,
    canRead: true,
    canWrite: can(employee, "tickets.write", scope),
    authorKind: "SUPPORT",
  };
}

/** Те же правила для списка: какие заявки сети этот сотрудник видит. */
export async function readOperatorQueueAccess(
  operatorId: string,
  userId: string,
  role: string,
): Promise<{ canRead: boolean; canWrite: boolean; pointIds: string[] | null } | null> {
  const operator = await prisma.chargerOperator.findUnique({
    where: { id: operatorId },
    select: { claimedById: true },
  });
  if (!operator) return null;
  if (role === "ADMIN" || (operator.claimedById && operator.claimedById === userId)) {
    return { canRead: true, canWrite: true, pointIds: null };
  }
  const employee = await readEmployee(operatorId, userId);
  if (!employee || !can(employee, "tickets.read")) return null;
  return {
    canRead: true,
    canWrite: can(employee, "tickets.write"),
    // Пустой перечень в §47 значит «вся сеть».
    pointIds: employee.pointIds.length > 0 ? employee.pointIds : null,
  };
}
