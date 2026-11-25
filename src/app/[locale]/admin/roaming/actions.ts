"use server";

// §8 "Роуминг" on the operator's side: the corridors and the periods closed
// against them. The money leaves Poolwatt elsewhere — here the operator only
// records which document closed a period.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { netRoamingPeriod, upsertRoamingAgreement } from "@/lib/exchange/roaming-service";

export type ActionResult = { ok: true; message?: string } | { ok: false; formError: string };

const corridorSchema = z.object({
  homeZone: z.string().min(1),
  visitedZone: z.string().min(1),
  partnerName: z.string().trim().min(2).max(120),
  feePct: z.number().min(0).max(100),
  dailyLimitKwh: z.number().min(0).max(1_000_000).nullable(),
  enabled: z.boolean(),
});

const netSchema = z.object({
  agreementId: z.string().min(1),
  upTo: z.string().min(4),
  reference: z.string().trim().min(2).max(200),
});

async function asOperator(run: (userId: string) => Promise<string | void>): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };
  if (session.user.role !== "ADMIN") return { ok: false, formError: "Operators only." };
  try {
    const message = await run(session.user.id);
    revalidatePath("/[locale]/admin/roaming", "page");
    return { ok: true, message: message ?? undefined };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not save." };
  }
}

export async function saveCorridorAction(input: unknown): Promise<ActionResult> {
  const parsed = corridorSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  return asOperator(async (userId) => {
    await upsertRoamingAgreement({ ...parsed.data, actorUserId: userId });
  });
}

export async function netPeriodAction(input: unknown): Promise<ActionResult> {
  const parsed = netSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const upTo = new Date(parsed.data.upTo);
  if (Number.isNaN(upTo.getTime())) return { ok: false, formError: "Invalid date." };

  return asOperator(async (userId) => {
    const result = await netRoamingPeriod({
      agreementId: parsed.data.agreementId,
      upTo,
      reference: parsed.data.reference,
      actorUserId: userId,
    });
    return `${result.closedSessions} · ${result.deliveredKwh} kWh`;
  });
}
