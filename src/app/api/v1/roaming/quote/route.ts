// POST /v1/roaming/quote — ТЗ §15, §8 "Роуминг", US-11 ("пользователь видит
// курс пересчёта до подтверждения"). Changes nothing.
import type { NextRequest } from "next/server";
import { z } from "zod";
import { domainError, ok, parseBody, sessionUser, unauthorized } from "@/lib/exchange/api";
import { quoteRoaming } from "@/lib/exchange/roaming-service";

const bodySchema = z.object({
  visitedZone: z.string().min(1),
  amountKwh: z.number().positive().max(1_000_000),
  homeZone: z.string().min(1).optional(),
});

export async function POST(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const parsed = await parseBody(req, bodySchema);
  if ("response" in parsed) return parsed.response;

  try {
    const view = await quoteRoaming({ userId: user.id, ...parsed.data });
    return ok({ roaming: view });
  } catch (err) {
    return domainError(err);
  }
}
