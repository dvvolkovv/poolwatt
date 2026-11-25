"use server";

// §52 — the franchise commission a head network takes at its franchisees'
// points.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { saveSubpartnerAgreement } from "@/lib/pricing/subpartner-service";

export type ActionResult = { ok: true } | { ok: false; formError: string };

const schema = z.object({
  headId: z.string().min(1),
  subId: z.string().min(1),
  chargeFeePct: z.number().min(0).max(100),
  active: z.boolean(),
  note: z.string().trim().max(200).nullable(),
});

export async function saveSubpartnerAction(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await saveSubpartnerAgreement({ ...parsed.data, actorId: session.user.id });
    revalidatePath("/[locale]/me/charger-operator/[id]/pricing", "page");
    return { ok: true };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not save." };
  }
}
