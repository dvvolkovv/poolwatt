// PUT /v1/admin/fee-plans/{id} — ТЗ §54.

import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, operatorUser, parseBody, unauthorized } from "@/lib/exchange/api";
import { prisma } from "@/lib/prisma";
import { FeeePlanError, savePlan } from "@/lib/pricing/fee-plan-service";
import { FeatureClosedError } from "@/lib/exchange/gates";

const pct = z.number().min(0).max(100);

const bodySchema = z.object({
  tier: z.enum(["BASIC", "EXTENDED", "CORPORATE"]).optional(),
  participantType: z
    .enum(["PRODUCER", "WHOLESALE", "COOPERATIVE", "OPERATOR"])
    .nullable()
    .optional(),
  tradeFeePct: pct.optional(),
  chargeFeePct: pct.optional(),
  bookingFeePct: pct.optional(),
  subscriptionFiat: z.number().min(0).max(1_000_000).optional(),
  subscriptionPeriod: z.enum(["month", "quarter", "year"]).optional(),
  currency: z.string().length(3).optional(),
  includedInvoices: z.number().int().min(0).nullable().optional(),
  includedCampaigns: z.number().int().min(0).nullable().optional(),
  isDefault: z.boolean().optional(),
  active: z.boolean().optional(),
  // §53's card tariffs: accepted so the refusal is explicit rather than a
  // silently ignored field.
  cardIssueFiat: z.number().optional(),
  cardInterchangePct: z.number().optional(),
});

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await operatorUser();
  if (!user) return unauthorized("Operators only");
  const { id } = await params;

  const parsed = await parseBody(req, bodySchema);
  if ("response" in parsed) return parsed.response;

  const existing = await prisma.platformFeePlan.findUnique({ where: { id } });
  if (!existing) return fail("No such plan", 404);

  try {
    const plan = await savePlan({ name: existing.name, ...parsed.data });
    return ok({
      plan: {
        id: plan.id,
        name: plan.name,
        tier: plan.tier,
        tradeFeePct: Number(plan.tradeFeePct),
        chargeFeePct: Number(plan.chargeFeePct),
        bookingFeePct: Number(plan.bookingFeePct),
        subscriptionFiat: Number(plan.subscriptionFiat),
        subscriptionPeriod: plan.subscriptionPeriod,
        isDefault: plan.isDefault,
        active: plan.active,
      },
    });
  } catch (err) {
    // A closed gate is not the caller's mistake: 503, as §15 has it.
    if (err instanceof FeatureClosedError) return fail(err.message, 503);
    if (err instanceof FeeePlanError) return fail(err.message, 400);
    throw err;
  }
}
