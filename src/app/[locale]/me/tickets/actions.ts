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
import {
  TicketCompensationError,
  grantTicketCompensation,
  refundTicketPayment,
} from "@/lib/work/ticket-compensation";
import { FeatureClosedError } from "@/lib/exchange/gates";

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

// §51 — компенсации. Решает их сторона поддержки: клиент о своей заявке
// только пишет. Размер подарка назначил партнёр, оператор решает «да или
// нет», поэтому у кнопки нет полей.
const refundSchema = z.object({
  ticketId: z.string().min(1),
  amountFiat: z.coerce.number().positive(),
  reason: z.string().trim().min(1).max(2000),
});

async function supportSide(ticketId: string) {
  const session = await auth();
  if (!session?.user) return null;
  const seen = await readTicketForUser(ticketId, session.user.id, session.user.role);
  if (!seen?.canWrite || seen.authorKind !== "SUPPORT") return null;
  return { userId: session.user.id };
}

export async function refundTicket(input: unknown): Promise<MessageResult> {
  const parsed = refundSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const side = await supportSide(parsed.data.ticketId);
  if (!side) return { ok: false, formError: "Not found." };

  try {
    await refundTicketPayment({
      ticketId: parsed.data.ticketId,
      supportUserId: side.userId,
      amountFiat: parsed.data.amountFiat,
      reason: parsed.data.reason,
    });
  } catch (err) {
    return {
      ok: false,
      formError:
        err instanceof TicketCompensationError || err instanceof FeatureClosedError
          ? err.message
          : "Could not refund.",
    };
  }
  revalidateTicket(parsed.data.ticketId);
  return { ok: true };
}

export async function compensateTicket(input: unknown): Promise<MessageResult> {
  const parsed = z.object({ ticketId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, formError: "Invalid input." };
  const side = await supportSide(parsed.data.ticketId);
  if (!side) return { ok: false, formError: "Not found." };

  try {
    await grantTicketCompensation(parsed.data.ticketId, side.userId);
  } catch (err) {
    return {
      ok: false,
      formError:
        err instanceof TicketCompensationError ? err.message : "Could not compensate.",
    };
  }
  revalidateTicket(parsed.data.ticketId);
  return { ok: true };
}

function revalidateTicket(ticketId: string) {
  for (const locale of ["ru", "en", "sk"]) {
    revalidatePath(`/${locale}/me/tickets/${ticketId}`);
    revalidatePath(`/${locale}/app/tickets/${ticketId}`);
    // Возврат двигает баланс, который печатают обе страницы кошелька.
    revalidatePath(`/${locale}/me/wallet`);
    revalidatePath(`/${locale}/app/wallet`);
  }
}
