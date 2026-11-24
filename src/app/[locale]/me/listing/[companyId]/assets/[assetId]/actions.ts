"use server";

// US-29 — clearing an alarm from the station console (ТЗ §30).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAlert } from "@/lib/exchange/asset-alerts";

const schema = z.object({
  alertId: z.string().min(1),
  note: z.string().trim().min(1).max(500),
});

export async function clearAlert(
  input: unknown,
): Promise<{ ok: boolean; formError?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  // Only the company that owns the asset, or the operator, may clear it.
  const alert = await prisma.assetAlert.findUnique({
    where: { id: parsed.data.alertId },
    select: { asset: { select: { company: { select: { ownerUserId: true } } } } },
  });
  if (!alert) return { ok: false, formError: "Alert not found." };
  if (
    alert.asset.company.ownerUserId !== session.user.id &&
    session.user.role !== "ADMIN"
  ) {
    return { ok: false, formError: "Not your asset." };
  }

  try {
    await resolveAlert(parsed.data.alertId, session.user.id, parsed.data.note);
    revalidatePath("/[locale]/me/listing/[companyId]/assets/[assetId]", "page");
    return { ok: true };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not clear." };
  }
}
