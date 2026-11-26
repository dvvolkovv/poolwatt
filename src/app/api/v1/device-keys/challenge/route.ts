// POST /v1/device-keys/challenge — одноразовый вызов (§25).
//
// Две цели: привязать устройство и подтвердить операцию. Вызов для одной цели
// не годится для другой, и живёт он две минуты.

import { NextRequest } from "next/server";
import { z } from "zod";
import { domainError, ok, parseBody, sessionUser, unauthorized } from "@/lib/exchange/api";
import { assertionChallenge, registrationChallenge } from "@/lib/webauthn/device-keys";

const bodySchema = z.object({ purpose: z.enum(["register", "transfer"]) });

export async function POST(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const parsed = await parseBody(req, bodySchema);
  if ("response" in parsed) return parsed.response;

  try {
    const options =
      parsed.data.purpose === "register"
        ? await registrationChallenge(user.id, user.username)
        : await assertionChallenge(user.id, "transfer");
    return ok({ options });
  } catch (err) {
    return domainError(err);
  }
}
