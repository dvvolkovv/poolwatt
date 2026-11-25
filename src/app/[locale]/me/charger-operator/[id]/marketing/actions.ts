"use server";

// The partner's side of §41 — everything that does not carry a file. The
// upload itself goes through POST /v1/partners/{id}/content, so the browser
// form and an outside caller are validated by exactly the same code.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  deleteContent,
  detachAsset,
  submitForReview,
  updateContent,
} from "@/lib/marketing/content-service";
import { sendContentSubmittedToOperator } from "@/lib/marketing/content-mail";

export type ActionResult = { ok: true } | { ok: false; formError: string };

const idSchema = z.object({ contentId: z.string().min(1) });

function refresh() {
  revalidatePath("/[locale]/me/charger-operator/[id]/marketing", "page");
}

async function withUser<T>(
  run: (userId: string) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; formError: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };
  try {
    return { ok: true, value: await run(session.user.id) };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not do that." };
  }
}

export async function submitContentAction(input: unknown): Promise<ActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, formError: "Invalid input." };

  const r = await withUser(async (userId) => {
    const content = await submitForReview(parsed.data.contentId, userId);
    await sendContentSubmittedToOperator(content.id);
    return content;
  });
  if (!r.ok) return r;
  refresh();
  return { ok: true };
}

export async function deleteContentAction(input: unknown): Promise<ActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, formError: "Invalid input." };

  const r = await withUser((userId) => deleteContent(parsed.data.contentId, userId));
  if (!r.ok) return r;
  refresh();
  return { ok: true };
}

export async function detachAssetAction(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ assetId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, formError: "Invalid input." };

  const r = await withUser((userId) => detachAsset(parsed.data.assetId, userId));
  if (!r.ok) return r;
  refresh();
  return { ok: true };
}

const scheduleSchema = z.object({
  contentId: z.string().min(1),
  startsAt: z.string().datetime().nullable(),
  endsAt: z.string().datetime().nullable(),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7),
  hourFrom: z.number().int().min(0).max(23).nullable(),
  hourTo: z.number().int().min(0).max(23).nullable(),
});

/** §41 "Расписание" — changing it sends the piece back through moderation. */
export async function saveScheduleAction(input: unknown): Promise<ActionResult> {
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { contentId, startsAt, endsAt, ...rest } = parsed.data;

  const r = await withUser((userId) =>
    updateContent(contentId, userId, {
      ...rest,
      startsAt: startsAt ? new Date(startsAt) : null,
      endsAt: endsAt ? new Date(endsAt) : null,
    }),
  );
  if (!r.ok) return r;
  refresh();
  return { ok: true };
}
