"use server";

// §42's gift constructor, server side.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  createCampaign,
  setCampaignStatus,
  updateCampaign,
} from "@/lib/marketing/campaign-service";

export type ActionResult = { ok: true } | { ok: false; formError: string };

const createSchema = z.object({
  operatorId: z.string().min(1),
  name: z.string().trim().min(2).max(120),
  trigger: z.enum(["FIRST_CHARGE", "NTH_CHARGE", "VOLUME_PERIOD"]),
  triggerN: z.number().int().positive().max(100_000).nullable(),
  triggerPeriodDays: z.number().int().positive().max(365).nullable(),
  giftKwh: z.number().positive().max(100_000),
  scopePointIds: z.array(z.string().max(40)).max(200),
  validityDays: z.number().int().min(1).max(3650),
  oncePerClient: z.boolean(),
  minNextChargeKwh: z.number().positive().max(100_000).nullable(),
  budgetKwh: z.number().positive().max(10_000_000),
  fundingSource: z.enum(["TOKENS", "FIAT"]),
  zoneId: z.string().min(1),
  startsAt: z.string().datetime().nullable(),
  endsAt: z.string().datetime().nullable(),
});

async function withUser<T>(
  run: (userId: string) => Promise<T>,
): Promise<{ ok: true } | { ok: false; formError: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };
  try {
    await run(session.user.id);
    revalidatePath("/[locale]/me/charger-operator/[id]/campaigns", "page");
    return { ok: true };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not do that." };
  }
}

export async function createCampaignAction(input: unknown): Promise<ActionResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { operatorId, startsAt, endsAt, ...rest } = parsed.data;

  return withUser((userId) =>
    createCampaign(operatorId, userId, {
      ...rest,
      startsAt: startsAt ? new Date(startsAt) : null,
      endsAt: endsAt ? new Date(endsAt) : null,
    }),
  );
}

const statusSchema = z.object({
  campaignId: z.string().min(1),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "ENDED"]),
});

export async function setCampaignStatusAction(input: unknown): Promise<ActionResult> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, formError: "Invalid input." };
  return withUser((userId) =>
    setCampaignStatus(parsed.data.campaignId, userId, parsed.data.status),
  );
}

const budgetSchema = z.object({
  campaignId: z.string().min(1),
  budgetKwh: z.number().positive().max(10_000_000),
});

/** Topping the budget up is the one edit a running campaign usually needs. */
export async function setCampaignBudgetAction(input: unknown): Promise<ActionResult> {
  const parsed = budgetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, formError: "Invalid input." };
  return withUser((userId) =>
    updateCampaign(parsed.data.campaignId, userId, { budgetKwh: parsed.data.budgetKwh }),
  );
}
