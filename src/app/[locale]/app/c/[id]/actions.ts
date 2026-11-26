"use server";

// §27 «отзывы» — одно действие, которым водитель оставляет или переписывает
// свой отзыв. Право на отзыв проверяет служба, а не страница.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { saveReview } from "@/lib/points/point-reviews";

const schema = z.object({
  pointId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  text: z.string().max(2000),
});

const REASON: Record<string, string> = {
  no_visit: "A review is left by somebody who charged here.",
  bad_rating: "The rating is one to five stars.",
  no_point: "No such point.",
};

export async function submitReview(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign in to leave a review." };

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const result = await saveReview({
    userId: session.user.id,
    pointId: parsed.data.pointId,
    rating: parsed.data.rating,
    text: parsed.data.text,
  });
  if (!result.ok) return { ok: false, error: REASON[result.reason] ?? "Could not save." };

  revalidatePath("/[locale]/app/c/[id]", "page");
  revalidatePath("/[locale]/c/[id]", "page");
  return { ok: true };
}
