"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { addFavorite, removeFavorite, type FavoriteKind } from "@/lib/favorites";

export type ToggleFavoriteResult =
  | { ok: true; nowFavorited: boolean }
  | { ok: false; error: "unauthenticated" | "invalid" | "server" };

// Single entry point for star-toggle from anywhere in the UI. Returns the new
// state so the client can confirm or revert its optimistic update. Failures
// surface as a typed error code (never throws to the caller); networking /
// unhandled exceptions become "server" so the client shows a generic toast.
export async function toggleFavorite(
  kind: FavoriteKind,
  id: string,
  desired: boolean,
): Promise<ToggleFavoriteResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "unauthenticated" };
  if (!id || typeof id !== "string") return { ok: false, error: "invalid" };
  if (kind !== "producer" && kind !== "charger") return { ok: false, error: "invalid" };

  try {
    if (desired) {
      await addFavorite(kind, session.user.id, id);
    } else {
      await removeFavorite(kind, session.user.id, id);
    }
    // The cabinet favorites page is the only place where the list changes
    // without the user clicking a star on it — invalidate so a freshly added
    // item appears on next visit. Other pages re-derive isFavorited from the
    // FavoriteButton's local state.
    revalidatePath("/[locale]/me/favorites", "page");
    return { ok: true, nowFavorited: desired };
  } catch (err) {
    console.error("[favorites] toggle failed:", err);
    return { ok: false, error: "server" };
  }
}
