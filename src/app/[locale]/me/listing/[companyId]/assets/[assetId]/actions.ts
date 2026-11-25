"use server";

// US-29 — clearing an alarm from the station console (ТЗ §30).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAlert } from "@/lib/exchange/asset-alerts";
import { deleteLayout, saveLayout } from "@/lib/dashboard/dashboard-service";

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

// US-27 — the producer's own widget panel (§30).

const layoutSchema = z.object({
  name: z.string().trim().min(1).max(40),
  widgets: z
    .array(z.object({ key: z.string().max(40), size: z.string().max(2) }))
    .min(1)
    .max(40),
  isDefault: z.boolean().optional(),
});

export type LayoutActionResult = { ok: true; name: string } | { ok: false; formError: string };

export async function saveDashboardLayout(input: unknown): Promise<LayoutActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };

  const parsed = layoutSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid layout." };
  }

  try {
    const saved = await saveLayout({
      userId: session.user.id,
      name: parsed.data.name,
      widgets: parsed.data.widgets,
      isDefault: parsed.data.isDefault,
    });
    revalidatePath("/[locale]/me/listing/[companyId]/assets/[assetId]", "page");
    return { ok: true, name: saved.name };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not save." };
  }
}

export async function deleteDashboardLayout(input: unknown): Promise<LayoutActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };

  const parsed = z.object({ name: z.string().trim().min(1).max(40) }).safeParse(input);
  if (!parsed.success) return { ok: false, formError: "Invalid layout." };

  try {
    await deleteLayout({ userId: session.user.id, name: parsed.data.name });
    revalidatePath("/[locale]/me/listing/[companyId]/assets/[assetId]", "page");
    return { ok: true, name: parsed.data.name };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not delete." };
  }
}
