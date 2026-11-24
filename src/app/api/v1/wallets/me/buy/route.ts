// POST /v1/wallets/me/buy — ТЗ §15, US-07 "покупка кВт·ч впрок".
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
import { buyAhead } from "@/lib/exchange/payment-service";
import { requireZone } from "@/lib/exchange/zone-service";

const bodySchema = z.object({
  zoneId: z.string().min(1),
  amountKwh: z.number().positive().max(1_000_000),
  /** Omit for a one-click market buy; set for a limit order. */
  limitPrice: z.number().positive().max(99.9999).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const parsed = await parseBody(req, bodySchema);
  if ("response" in parsed) return parsed.response;

  try {
    const zone = await requireZone(parsed.data.zoneId);
    const order = await buyAhead({
      userId: user.id,
      zoneId: zone.id,
      amountKwh: parsed.data.amountKwh,
      limitPrice: parsed.data.limitPrice ?? null,
      idempotencyKey: idempotencyKey(req),
    });
    return ok({ order }, order.rejectReason ? 200 : 201);
  } catch (err) {
    return domainError(err);
  }
}
