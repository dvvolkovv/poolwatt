"use server";

// §51.5 — клиент переписывается с поддержкой, поддержка отвечает и решает.
// Одни и те же действия на четырёх страницах (кабинет и телефон у клиента,
// карточка у поддержки): право решает `readTicketForUser`, а не страница.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { readTicketForUser } from "@/lib/work/ticket-access";
import {
  MAX_MESSAGE_LENGTH,
  TicketConversationError,
  postTicketMessage,
  resolveTicket,
} from "@/lib/work/ticket-conversation";

const schema = z.object({
  ticketId: z.string().min(1),
  body: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});

export type MessageResult = { ok: true } | { ok: false; formError: string };

export async function sendTicketMessage(input: unknown): Promise<MessageResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Authentication required." };

  const seen = await readTicketForUser(parsed.data.ticketId, session.user.id, session.user.role);
  // Нет права писать — для экрана это то же, что нет заявки.
  if (!seen?.canWrite) return { ok: false, formError: "Not found." };

  try {
    await postTicketMessage({
      ticketId: parsed.data.ticketId,
      authorKind: seen.authorKind,
      authorId: session.user.id,
      body: parsed.data.body,
    });
  } catch (err) {
    return {
      ok: false,
      formError: err instanceof TicketConversationError ? err.message : "Could not send.",
    };
  }
  revalidateTicket(parsed.data.ticketId);
  return { ok: true };
}

export async function markTicketResolved(input: unknown): Promise<MessageResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    // §46 и здесь: закрыть молча нельзя, и отказ говорит именно об этом.
    return { ok: false, formError: "Closing a ticket needs an answer in words." };
  }
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Authentication required." };

  const seen = await readTicketForUser(parsed.data.ticketId, session.user.id, session.user.role);
  // Решает заявку только сторона поддержки: клиент может лишь написать.
  if (!seen?.canWrite || seen.authorKind !== "SUPPORT") {
    return { ok: false, formError: "Not found." };
  }

  try {
    await resolveTicket({
      ticketId: parsed.data.ticketId,
      authorId: session.user.id,
      body: parsed.data.body,
    });
  } catch (err) {
    return {
      ok: false,
      formError: err instanceof TicketConversationError ? err.message : "Could not resolve.",
    };
  }
  revalidateTicket(parsed.data.ticketId);
  return { ok: true };
}

function revalidateTicket(ticketId: string) {
  for (const locale of ["ru", "en", "sk"]) {
    revalidatePath(`/${locale}/me/tickets/${ticketId}`);
    revalidatePath(`/${locale}/app/tickets/${ticketId}`);
  }
}
