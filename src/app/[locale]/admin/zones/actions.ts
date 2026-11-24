"use server";

// Operator actions on the spot reference — ТЗ §6, §16.5.

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { refreshZoneSpot } from "@/lib/exchange/spot-service";

export type RefreshActionResult =
  | { ok: true; stored: number }
  | { ok: false; error: string };

/** Pull the day-ahead curve for one zone right now, instead of waiting an hour. */
export async function refreshZone(zoneId: string): Promise<RefreshActionResult> {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return { ok: false, error: "Not allowed." };

  const result = await refreshZoneSpot(zoneId);
  revalidatePath("/[locale]/admin/zones", "page");

  if (result.status === "refreshed") return { ok: true, stored: result.stored };
  if (result.status === "skipped") return { ok: false, error: result.reason };
  return { ok: false, error: result.error };
}
