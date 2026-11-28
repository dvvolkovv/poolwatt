"use server";

// §48 — отправка в комнату и отметка «прочитано». Одни и те же действия на
// четырёх экранах (наряд на мониторе, наряд в телефоне, комнаты сети,
// комнаты в телефоне): право решает `chat-service`, а не страница.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  ChatError,
  MAX_CHAT_MESSAGE_LENGTH,
  markRoomSeen,
  postChatMessage,
} from "@/lib/work/chat-service";

const schema = z.object({
  key: z.string().min(1).max(80),
  body: z.string().trim().min(1).max(MAX_CHAT_MESSAGE_LENGTH),
});

export type ChatResult = { ok: true } | { ok: false; formError: string };

export async function sendChatMessage(input: unknown): Promise<ChatResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Authentication required." };

  try {
    await postChatMessage({
      key: parsed.data.key,
      userId: session.user.id,
      role: session.user.role,
      body: parsed.data.body,
    });
  } catch (err) {
    return { ok: false, formError: err instanceof ChatError ? err.message : "Could not send." };
  }
  revalidatePath("/[locale]/me/work-orders/[id]", "page");
  revalidatePath("/[locale]/app/work-orders/[id]", "page");
  return { ok: true };
}

/** Открыл комнату — значит прочитал. Чужая комната молчит: отметке негде лежать. */
export async function seenChatRoom(key: string): Promise<void> {
  const session = await auth();
  if (!session?.user) return;
  try {
    await markRoomSeen(key, session.user.id, session.user.role);
  } catch (err) {
    if (!(err instanceof ChatError)) throw err;
  }
}
