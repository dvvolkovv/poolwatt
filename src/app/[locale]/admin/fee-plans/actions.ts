"use server";

// §53 — the operator's own table: plans, rates, subscriptions, and the
// individual terms for a particular partner.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { assignPartnerPlan, savePlan } from "@/lib/pricing/fee-plan-service";

export type ActionResult = { ok: true } | { ok: false; formError: string };

const pct = z.number().min(0).max(100);

const planSchema = z.object({
  name: z.string().trim().min(2).max(80),
  tier: z.enum(["BASIC", "EXTENDED", "CORPORATE"]),
  participantType: z.enum(["PRODUCER", "WHOLESALE", "COOPERATIVE", "OPERATOR"]).nullable(),
  tradeFeePct: pct,
  chargeFeePct: pct,
  bookingFeePct: pct,
  subscriptionFiat: z.number().min(0).max(1_000_000),
  subscriptionPeriod: z.enum(["month", "quarter", "year"]),
  currency: z.string().length(3),
  includedInvoices: z.number().int().min(0).max(1_000_000).nullable(),
  includedCampaigns: z.number().int().min(0).max(10_000).nullable(),
  isDefault: z.boolean(),
  active: z.boolean(),
});

async function asOperator<T>(run: () => Promise<T>): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };
  if (session.user.role !== "ADMIN") return { ok: false, formError: "Operators only." };
  try {
    await run();
    revalidatePath("/[locale]/admin/fee-plans", "page");
    return { ok: true };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not save." };
  }
}

export async function savePlanAction(input: unknown): Promise<ActionResult> {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  return asOperator(() => savePlan(parsed.data));
}

const assignSchema = z
  .object({
    planId: z.string().min(1),
    companyId: z.string().min(1).nullable(),
    operatorId: z.string().min(1).nullable(),
    overrideTradeFeePct: pct.nullable(),
    overrideChargeFeePct: pct.nullable(),
    overrideBookingFeePct: pct.nullable(),
    note: z.string().trim().max(200).nullable(),
  })
  .refine((v) => Boolean(v.companyId) !== Boolean(v.operatorId), {
    message: "Name either a company or a network, not both.",
  });

export async function assignPlanAction(input: unknown): Promise<ActionResult> {
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const v = parsed.data;

  // Only the fields the operator actually filled in become overrides: §53's
  // individual terms are a patch over a plan, not a copy of it.
  const overrides: Record<string, number> = {};
  if (v.overrideTradeFeePct != null) overrides.tradeFeePct = v.overrideTradeFeePct;
  if (v.overrideChargeFeePct != null) overrides.chargeFeePct = v.overrideChargeFeePct;
  if (v.overrideBookingFeePct != null) overrides.bookingFeePct = v.overrideBookingFeePct;

  return asOperator(() =>
    assignPartnerPlan({
      planId: v.planId,
      companyId: v.companyId ?? undefined,
      operatorId: v.operatorId ?? undefined,
      overrides,
      note: v.note,
    }),
  );
}
