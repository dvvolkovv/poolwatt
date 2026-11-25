// POST /v1/payments/charge — ТЗ §15, US-08, §16.6.
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
import { chargeSession } from "@/lib/exchange/payment-service";
import { requireZone } from "@/lib/exchange/zone-service";

const bodySchema = z.object({
  zoneId: z.string().min(1),
  requestedKwh: z.number().positive().max(1_000_000),
  chargePointId: z.string().max(100).optional().nullable(),
  // §46 — the point and connector of our own that the session ran at, and
  // when it ran. Without them the receipt has no network and §45's gifts
  // cannot tell whose network a charge happened in.
  pointId: z.string().max(40).optional().nullable(),
  connectorId: z.string().max(40).optional().nullable(),
  startedAt: z.string().datetime().optional().nullable(),
  endedAt: z.string().datetime().optional().nullable(),
  cardId: z.string().max(100).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const parsed = await parseBody(req, bodySchema);
  if ("response" in parsed) return parsed.response;

  const key = idempotencyKey(req);
  try {
    return await idempotent({
      endpoint: "POST /v1/payments/charge",
      key,
      userKey: user.id,
      body: parsed.data,
      run: async () => {
        const zone = await requireZone(parsed.data.zoneId);
        const payment = await chargeSession({
          userId: user.id,
          zoneId: zone.id,
          requestedKwh: parsed.data.requestedKwh,
          chargePointId: parsed.data.chargePointId ?? null,
          pointId: parsed.data.pointId ?? null,
          connectorId: parsed.data.connectorId ?? null,
          startedAt: parsed.data.startedAt ? new Date(parsed.data.startedAt) : null,
          endedAt: parsed.data.endedAt ? new Date(parsed.data.endedAt) : null,
          cardId: parsed.data.cardId ?? null,
          idempotencyKey: key,
        });
        // A declined payment is a recorded outcome with a receipt-less row.
        return { status: payment.status === "FAILED" ? 402 : 201, data: { payment } };
      },
    });
  } catch (err) {
    return domainError(err);
  }
}
