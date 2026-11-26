// POST /v1/charge-sessions — ТЗ §22.9, US-20. Старт зарядки по QR.
//
// Первый момент §16.6: расчёт посчитан, деньги с запасом Y % зарезервированы,
// разъём занят. Ключ идемпотентности обязателен — это запись, которая двигает
// деньги и энергию (§15).
import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  domainError,
  idempotencyKey,
  idempotent,
  parseBody,
  sessionUser,
  unauthorized,
} from "@/lib/exchange/api";
import { authorizeSession } from "@/lib/exchange/charge-session";

const bodySchema = z.object({
  pointId: z.string().min(1).max(40),
  connectorId: z.string().min(1).max(40),
  plannedKwh: z.number().positive().max(1000),
});

export async function POST(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const parsed = await parseBody(req, bodySchema);
  if ("response" in parsed) return parsed.response;

  const key = idempotencyKey(req);
  try {
    return await idempotent({
      endpoint: "POST /v1/charge-sessions",
      key,
      userKey: user.id,
      body: parsed.data,
      run: async () => {
        const session = await authorizeSession({
          userId: user.id,
          pointId: parsed.data.pointId,
          connectorId: parsed.data.connectorId,
          plannedKwh: parsed.data.plannedKwh,
          idempotencyKey: key!,
        });
        return { status: 201, data: { session } };
      },
    });
  } catch (err) {
    return domainError(err);
  }
}
