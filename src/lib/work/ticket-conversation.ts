// Разговор по заявке — §51 «клиент видит статус заявки и переписывается с
// поддержкой в чате», §48 «SLA по приоритету».
//
// Три правила, которые стоит прочитать прежде кода:
//
// 1. Срок реакции §48 закрывает **ответ человека**, а не наряд. Наряд по
//    технической поломке открывает система через минуту, и если считать
//    его ответом, то SLA выполняется всегда и не измеряет ничего.
// 2. «Решено» требует слов. Молча закрытая заявка для клиента ничем не
//    отличается от забытой — то же правило, что у заявки бухгалтера в §46.
// 3. Клиент, написавший в решённую заявку, открывает её заново: пока
//    проблема не ушла, заявка живая. Закрытая — конец, в неё не пишет никто,
//    кроме системы: системе есть что сообщить и после закрытия («станция
//    снова работает»).

import type { TicketAuthorKind, TicketMessage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Db } from "@/lib/exchange/audit";
import { publish, ticketChannel } from "@/lib/exchange/realtime";

export class TicketConversationError extends Error {}

export const MAX_MESSAGE_LENGTH = 4000;

export interface PostMessageArgs {
  ticketId: string;
  authorKind: Extract<TicketAuthorKind, "CUSTOMER" | "SUPPORT">;
  authorId: string;
  body: string;
}

/** Системная запись: факт, который сообщила сама платформа. */
export async function systemMessage(
  db: Db,
  ticketId: string,
  body: string,
): Promise<TicketMessage> {
  const message = await db.ticketMessage.create({
    data: { ticketId, authorKind: "SYSTEM", body: body.trim() },
  });
  await announce(ticketId, message);
  return message;
}

export async function postTicketMessage(args: PostMessageArgs): Promise<TicketMessage> {
  const body = args.body.trim();
  if (body.length === 0) throw new TicketConversationError("A message needs words");
  if (body.length > MAX_MESSAGE_LENGTH) {
    throw new TicketConversationError("The message is too long");
  }

  const message = await prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findUnique({
      where: { id: args.ticketId },
      select: { id: true, status: true },
    });
    if (!ticket) throw new TicketConversationError("No such ticket");
    if (ticket.status === "CLOSED") {
      throw new TicketConversationError("This ticket is closed: open a new one");
    }

    const created = await tx.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        authorKind: args.authorKind,
        authorId: args.authorId,
        body,
      },
    });

    if (args.authorKind === "SUPPORT") {
      // Условный update: два одновременных первых ответа дают одну отметку,
      // потому что второй не найдёт строки с пустым firstRespondedAt.
      await tx.ticket.updateMany({
        where: { id: ticket.id, firstRespondedAt: null },
        data: { firstRespondedAt: created.createdAt, status: "IN_PROGRESS" },
      });
    } else if (ticket.status === "RESOLVED") {
      // §51 — проблема не ушла, значит заявка снова живая.
      await tx.ticket.update({
        where: { id: ticket.id },
        data: { status: "IN_PROGRESS", resolvedAt: null },
      });
    }

    return created;
  });

  await announce(args.ticketId, message);
  return message;
}

export async function resolveTicket(args: {
  ticketId: string;
  authorId: string;
  body: string;
}): Promise<TicketMessage> {
  const body = args.body.trim();
  if (body.length === 0) {
    throw new TicketConversationError("Closing a ticket needs an answer in words");
  }

  const message = await prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findUnique({
      where: { id: args.ticketId },
      select: { id: true, status: true },
    });
    if (!ticket) throw new TicketConversationError("No such ticket");
    if (ticket.status === "CLOSED") {
      throw new TicketConversationError("This ticket is closed");
    }
    const created = await tx.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        authorKind: "SUPPORT",
        authorId: args.authorId,
        body,
      },
    });
    const now = created.createdAt;
    await tx.ticket.update({
      where: { id: ticket.id },
      data: { status: "RESOLVED", resolvedAt: now },
    });
    await tx.ticket.updateMany({
      where: { id: ticket.id, firstRespondedAt: null },
      data: { firstRespondedAt: now },
    });
    return created;
  });

  await announce(args.ticketId, message);
  return message;
}

/** Окончательное закрытие: вручную оператором или проходом воркера. */
export async function closeTicket(ticketId: string, at: Date = new Date()): Promise<void> {
  await prisma.ticket.update({
    where: { id: ticketId },
    data: { status: "CLOSED", closedAt: at },
  });
}

/** Живая доставка §15. Канал молчит — заявка всё равно записана. */
async function announce(ticketId: string, message: TicketMessage): Promise<void> {
  try {
    await publish(ticketChannel(ticketId), "ticket.message", {
      id: message.id,
      authorKind: message.authorKind,
      body: message.body,
      at: message.createdAt.toISOString(),
    });
  } catch {
    // Страница, пропустившая событие, покажет верное при следующей загрузке.
  }
}
