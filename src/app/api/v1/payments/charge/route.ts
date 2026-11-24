// POST /v1/payments/charge — ТЗ §15, US-08, §16.6.
import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  domainError,
  idempotencyKey,
  ok,
  parseBody,
  sessionUser,
  unauthorized,
} from "@/lib/exchange/api";
import { chargeSession } from "@/lib/exchange/payment-service";
import { requireZone } from "@/lib/exchange/zone-service";

const bodySchema = z.object({
  zoneId: z.string().min(1),
  requestedKwh: z.number().positive().max(1_000_000),
  chargePointId: z.string().max(100).optional().nullable(),
  cardId: z.string().max(100).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const parsed = await parseBody(req, bodySchema);
  if ("response" in parsed) return parsed.response;

  try {
    const zone = await requireZone(parsed.data.zoneId);
    const payment = await chargeSession({
      userId: user.id,
      zoneId: zone.id,
      requestedKwh: parsed.data.requestedKwh,
      chargePointId: parsed.data.chargePointId ?? null,
      cardId: parsed.data.cardId ?? null,
      idempotencyKey: idempotencyKey(req),
    });
    // A declined payment is a recorded outcome with a receipt-less Payment row.
    return ok({ payment }, payment.status === "FAILED" ? 402 : 201);
  } catch (err) {
    return domainError(err);
  }
}
