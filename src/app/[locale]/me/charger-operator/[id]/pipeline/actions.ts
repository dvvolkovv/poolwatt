"use server";

// §48 / US-51 — the board's own buttons.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  LEAD_STAGES,
  addLeadNote,
  createLead,
  deleteLead,
  markLeadLost,
  moveLead,
  reopenLead,
  updateLead,
} from "@/lib/crm/lead-service";

export type ActionResult = { ok: true } | { ok: false; formError: string };

function refresh() {
  revalidatePath("/[locale]/me/charger-operator/[id]/pipeline", "page");
}

async function run(fn: (userId: string) => Promise<unknown>): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };
  try {
    await fn(session.user.id);
    refresh();
    return { ok: true };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not do that." };
  }
}

const createSchema = z.object({
  operatorId: z.string().min(1),
  title: z.string().trim().min(2).max(160),
  country: z.string().trim().max(2).nullable(),
  city: z.string().trim().max(80).nullable(),
  addressLine: z.string().trim().max(200).nullable(),
  ownerEmployeeId: z.string().min(1).nullable(),
  dueAt: z.string().datetime().nullable(),
});

export async function createLeadAction(input: unknown): Promise<ActionResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { dueAt, ...rest } = parsed.data;
  return run((userId) =>
    createLead({ ...rest, actorId: userId, dueAt: dueAt ? new Date(dueAt) : null }),
  );
}

const moveSchema = z.object({
  leadId: z.string().min(1),
  stage: z.enum(LEAD_STAGES),
  position: z.number().int().min(0).max(1000).optional(),
});

export async function moveLeadAction(input: unknown): Promise<ActionResult> {
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, formError: "Invalid input." };
  return run((userId) => moveLead({ ...parsed.data, actorId: userId }));
}

const updateSchema = z.object({
  leadId: z.string().min(1),
  ownerEmployeeId: z.string().min(1).nullable(),
  dueAt: z.string().datetime().nullable(),
});

export async function updateLeadAction(input: unknown): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, formError: "Invalid input." };
  const { dueAt, ...rest } = parsed.data;
  return run((userId) =>
    updateLead({ ...rest, actorId: userId, dueAt: dueAt ? new Date(dueAt) : null }),
  );
}

export async function lostLeadAction(input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({ leadId: z.string().min(1), reason: z.string().trim().min(2).max(300) })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: "Say why it was lost." };
  }
  return run((userId) => markLeadLost({ ...parsed.data, actorId: userId }));
}

export async function reopenLeadAction(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ leadId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, formError: "Invalid input." };
  return run((userId) => reopenLead(parsed.data.leadId, userId));
}

export async function noteLeadAction(input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({ leadId: z.string().min(1), text: z.string().trim().min(1).max(2000) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, formError: "Invalid input." };
  return run((userId) => addLeadNote({ ...parsed.data, actorId: userId }));
}

export async function deleteLeadAction(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ leadId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, formError: "Invalid input." };
  return run((userId) => deleteLead(parsed.data.leadId, userId));
}
