"use server";

// §33 "Настройки владельца станции" / US-32.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { savePolicy } from "@/lib/reservations/reservation-service";

const schema = z.object({
  pointId: z.string().min(1),
  enabled: z.boolean(),
  walkUpConnectors: z.number().int().min(0).max(50),
  feeFiat: z.number().min(0).max(1000),
  guaranteeFiat: z.number().min(0).max(10000),
  noShowPenaltyFiat: z.number().min(0).max(10000),
  waitMinutes: z.number().int().min(1).max(240),
  freeCancelMinutes: z.number().int().min(0).max(1440),
  maxAheadHours: z.number().int().min(1).max(720),
  feeCountsTowards: z.boolean(),
  coopFree: z.boolean(),
});

export async function saveReservationPolicy(
  input: unknown,
): Promise<{ ok: boolean; formError?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { pointId, ...rest } = parsed.data;
  try {
    await savePolicy(pointId, session.user.id, rest);
    revalidatePath("/[locale]/me/charger-operator/[id]/points/[pointId]", "page");
    return { ok: true };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not save." };
  }
}
