// Что показывает экран заявки — один читатель на четыре страницы (кабинет и
// телефон у клиента, очередь и карточка у поддержки).
//
// Отдельный модуль, чтобы «ждёт ответа поддержки» и «срок истёк» считались в
// одном месте: цифра, посчитанная на двух страницах по-разному, однажды
// разойдётся, и объяснить это будет нечем.

import type { Ticket, TicketMessage, TicketStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface TicketListRow {
  id: string;
  problemType: string;
  status: TicketStatus;
  priority: string;
  pointName: string | null;
  pointCity: string | null;
  reporterName: string | null;
  createdAt: string;
  respondBy: string | null;
  /** §48 — ответа поддержки ещё не было. */
  awaitingAnswer: boolean;
  /** Срок ответа прошёл, а ответа так и нет. */
  overdue: boolean;
  escalated: boolean;
  lastMessage: { authorKind: string; body: string; at: string } | null;
  workOrderId: string | null;
}

export function toListRow(
  ticket: Ticket & {
    point?: { name: string; city: string | null } | null;
    reporter?: { username: string } | null;
    messages?: TicketMessage[];
  },
  now: Date = new Date(),
): TicketListRow {
  const awaitingAnswer = ticket.firstRespondedAt === null;
  const last = ticket.messages?.at(-1) ?? null;
  return {
    id: ticket.id,
    problemType: ticket.problemType,
    status: ticket.status,
    priority: ticket.priority,
    pointName: ticket.point?.name ?? null,
    pointCity: ticket.point?.city ?? null,
    reporterName: ticket.reporter?.username ?? null,
    createdAt: ticket.createdAt.toISOString(),
    respondBy: ticket.respondBy?.toISOString() ?? null,
    awaitingAnswer,
    overdue:
      awaitingAnswer &&
      ticket.respondBy !== null &&
      ticket.respondBy.getTime() < now.getTime() &&
      ticket.status !== "CLOSED",
    escalated: ticket.escalatedAt !== null,
    lastMessage: last
      ? { authorKind: last.authorKind, body: last.body, at: last.createdAt.toISOString() }
      : null,
    workOrderId: ticket.workOrderId,
  };
}

/** Мои заявки — §51.5, экран водителя. */
export async function listMyTickets(userId: string, take = 30): Promise<TicketListRow[]> {
  const tickets = await prisma.ticket.findMany({
    where: { reporterId: userId },
    orderBy: [{ createdAt: "desc" }],
    take,
    include: {
      point: { select: { name: true, city: true } },
      messages: { orderBy: { createdAt: "asc" }, take: 50 },
    },
  });
  const now = new Date();
  return tickets.map((t) => toListRow(t, now));
}

export interface TicketThreadMessage {
  id: string;
  authorKind: string;
  authorName: string | null;
  body: string;
  at: string;
}

export async function readThread(ticketId: string): Promise<TicketThreadMessage[]> {
  const messages = await prisma.ticketMessage.findMany({
    where: { ticketId },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { username: true } } },
  });
  return messages.map((m) => ({
    id: m.id,
    authorKind: m.authorKind,
    authorName: m.author?.username ?? null,
    body: m.body,
    at: m.createdAt.toISOString(),
  }));
}
