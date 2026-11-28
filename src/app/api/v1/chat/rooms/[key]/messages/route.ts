// GET|POST /v1/chat/rooms/{key}/messages — §48.
//
// POST идемпотентен и ключ требует: инженер пишет из подвала, сообщение
// ждёт в очереди §48, а досыл — это повтор по определению. Без ключа два
// досыла дали бы две одинаковые строки в чате наряда.
//
// Отказ по праву — 404, а не 403: чужой комнаты не существует.

import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  idempotencyKey,
  idempotent,
  notFound,
  ok,
  parseBody,
  sessionUser,
  unauthorized,
} from "@/lib/exchange/api";
import {
  ChatError,
  MAX_CHAT_MESSAGE_LENGTH,
  postChatMessage,
  readRoomMessages,
} from "@/lib/work/chat-service";

const schema = z.object({ body: z.string().trim().min(1).max(MAX_CHAT_MESSAGE_LENGTH) });

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const user = await sessionUser();
  if (!user) return unauthorized();
  try {
    return ok({ messages: await readRoomMessages(key, user.id, user.role) });
  } catch (err) {
    if (err instanceof ChatError) return notFound();
    throw err;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const user = await sessionUser();
  if (!user) return unauthorized();

  const parsed = await parseBody(request, schema);
  if ("response" in parsed) return parsed.response;
  const b = parsed.data;

  try {
    return await idempotent({
      endpoint: "POST /v1/chat/rooms/messages",
      key: idempotencyKey(request),
      userKey: user.id,
      body: { key, ...b },
      run: async () => {
        const message = await postChatMessage({
          key,
          userId: user.id,
          role: user.role,
          body: b.body,
        });
        return {
          status: 201,
          data: { message: { id: message.id, at: message.createdAt.toISOString() } },
        };
      },
    });
  } catch (err) {
    if (err instanceof ChatError) return notFound(err.message);
    throw err;
  }
}
