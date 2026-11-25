"use server";

// US-25 — the owner's side of §29.6.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { applyTemplate, deleteTemplate, saveTemplate } from "@/lib/points/point-template";

export type ActionResult = { ok: true; applied?: number } | { ok: false; formError: string };

const tariffSchema = z.object({
  label: z.string().trim().max(80).nullable(),
  fromMinute: z.number().int().min(0).max(1440),
  toMinute: z.number().int().min(0).max(1440),
  priceFiat: z.number().min(0).max(1000).nullable(),
  currency: z.string().length(3),
  priceTokens: z.number().min(0).max(1000).nullable(),
  idleFeePerMin: z.number().min(0).max(1000).nullable(),
  coopDiscount: z.number().int().min(0).max(100),
});

const saveSchema = z.object({
  operatorId: z.string().min(1),
  name: z.string().trim().min(2).max(80),
  tariffs: z.array(tariffSchema).max(12),
  open24: z.boolean(),
  holidayNote: z.string().trim().max(200).nullable(),
  paymentMethods: z.array(z.string().max(32)).max(10),
  amenities: z.array(z.string().max(32)).max(20),
});

async function run<T>(fn: (userId: string) => Promise<T>): Promise<
  { ok: true; value: T } | { ok: false; formError: string }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };
  try {
    const value = await fn(session.user.id);
    revalidatePath("/[locale]/me/charger-operator/[id]/templates", "page");
    return { ok: true, value };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not do that." };
  }
}

export async function saveTemplateAction(input: unknown): Promise<ActionResult> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const r = await run((userId) => saveTemplate({ ...parsed.data, actorId: userId }));
  return r.ok ? { ok: true } : r;
}

const applySchema = z.object({
  templateId: z.string().min(1),
  pointIds: z.array(z.string().max(40)).max(500).nullable(),
});

export async function applyTemplateAction(input: unknown): Promise<ActionResult> {
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) return { ok: false, formError: "Invalid input." };

  const r = await run((userId) => applyTemplate({ ...parsed.data, actorId: userId }));
  if (!r.ok) return r;
  // Revalidate the navigator too: fifty points just changed their price.
  revalidatePath("/[locale]/navigator", "page");
  return { ok: true, applied: r.value.applied };
}

export async function deleteTemplateAction(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ templateId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, formError: "Invalid input." };
  const r = await run((userId) => deleteTemplate(parsed.data.templateId, userId));
  return r.ok ? { ok: true } : r;
}
