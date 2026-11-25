// PUT /v1/partners/{id}/pricing — ТЗ §54.
//
// Sets the one price a whole network charges, and records the version. The
// per-point tariffs of §52 are edited through the point wizard; this is the
// method §54 names, and the one an outside system wants.

import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, parseBody, sessionUser, unauthorized } from "@/lib/exchange/api";
import { prisma } from "@/lib/prisma";
import { PricingError } from "@/lib/pricing/pricing-service";
import { setNetworkPrice } from "@/lib/pricing/network-price";
import { readPricingOverview } from "@/lib/pricing/pricing-overview";

const bodySchema = z.object({
  pricePerKwh: z.number().positive().max(99.9999).nullable(),
  currency: z.string().length(3).nullable(),
  note: z.string().max(200).optional().nullable(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await sessionUser();
  if (!user) return unauthorized();
  const { id } = await params;

  const operator = await prisma.chargerOperator.findUnique({
    where: { id },
    select: { claimedById: true },
  });
  // A network that is not yours does not exist here.
  if (!operator || operator.claimedById !== user.id) return fail("Not found", 404);

  const overview = await readPricingOverview(id);
  return ok({ pricing: overview });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await sessionUser();
  if (!user) return unauthorized();
  const { id } = await params;

  const parsed = await parseBody(req, bodySchema);
  if ("response" in parsed) return parsed.response;

  try {
    const view = await setNetworkPrice({
      operatorId: id,
      pricePerKwh: parsed.data.pricePerKwh,
      currency: parsed.data.currency,
      actorId: user.id,
      note: parsed.data.note ?? null,
    });
    return ok({ pricing: view });
  } catch (err) {
    if (err instanceof PricingError) {
      // "Belongs to somebody else" is a 404: confirming a network exists is
      // itself something a stranger should not learn here.
      return fail(err.message, /somebody else|No such network/.test(err.message) ? 404 : 400);
    }
    throw err;
  }
}
