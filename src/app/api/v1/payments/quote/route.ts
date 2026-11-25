// POST /v1/payments/quote — the all-in price shown before confirmation
// (ТЗ §54, §8). Changes nothing.
import type { NextRequest } from "next/server";
import { z } from "zod";
import { domainError, ok, parseBody, sessionUser, unauthorized } from "@/lib/exchange/api";
import { quoteCharge } from "@/lib/exchange/payment-service";
import { effectivePricePerKwh } from "@/lib/exchange/fees";
import { requireZone } from "@/lib/exchange/zone-service";

const bodySchema = z.object({
  zoneId: z.string().min(1),
  requestedKwh: z.number().positive().max(1_000_000),
  // §54 "Клиент видит итоговую цену и все платы до подтверждения" — the price
  // depends on the point: the network's plan sets the commission (§53) and a
  // gift only applies in its own network (§43). A quote without the point is
  // a different number from the one that will be charged.
  pointId: z.string().max(40).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const parsed = await parseBody(req, bodySchema);
  if ("response" in parsed) return parsed.response;

  try {
    const zone = await requireZone(parsed.data.zoneId);
    const quote = await quoteCharge({
      userId: user.id,
      zoneId: zone.id,
      requestedKwh: parsed.data.requestedKwh,
      pointId: parsed.data.pointId ?? null,
    });
    return ok({
      quote: {
        ...quote,
        effectivePricePerKwh: effectivePricePerKwh(quote.total, quote.deliverableKwh),
      },
    });
  } catch (err) {
    return domainError(err);
  }
}
