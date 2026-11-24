"use server";

// §16.11 — let the operator run the check without waiting for the night.

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { reconcileRegistry } from "@/lib/exchange/reconciliation-service";

export type ReconcileActionResult =
  | { ok: true; driftCount: number; checked: number }
  | { ok: false; error: string };

export async function runReconciliationNow(): Promise<ReconcileActionResult> {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return { ok: false, error: "Not allowed." };

  try {
    const outcome = await reconcileRegistry({ scope: "manual" });
    revalidatePath("/[locale]/admin/reconciliation", "page");
    return {
      ok: true,
      driftCount: outcome.driftCount,
      checked: outcome.checks.reduce((sum, c) => sum + c.checked, 0),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Reconciliation failed." };
  }
}
