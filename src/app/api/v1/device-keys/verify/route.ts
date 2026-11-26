// POST /v1/device-keys/verify — ответ аутентификатора на привязку (§25).
//
// Подпись проверяет сервер: клиент здесь не решает ничего.

import { NextRequest } from "next/server";
import { z } from "zod";
import { domainError, ok, parseBody, sessionUser, unauthorized } from "@/lib/exchange/api";
import { registerDevice } from "@/lib/webauthn/device-keys";

const bodySchema = z.object({
  // Форма ответа аутентификатора своя; разбирает её библиотека WebAuthn.
  response: z.unknown(),
  name: z.string().max(60).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const parsed = await parseBody(req, bodySchema);
  if ("response" in parsed) return parsed.response;

  try {
    const result = await registerDevice({
      userId: user.id,
      response: parsed.data.response as never,
      name: parsed.data.name ?? null,
    });
    return ok({ deviceKeyId: result.deviceKeyId }, 201);
  } catch (err) {
    return domainError(err);
  }
}
