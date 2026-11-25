"use server";

// US-21 — casting and changing a ballot. "Один член — один голос" is the
// unique key on (vote, member), so this action does not check it: it relies on
// it, which is the only way two simultaneous clicks cannot both be counted.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { castBallot } from "@/lib/exchange/coop-service";

export type ActionResult = { ok: true } | { ok: false; formError: string };

const schema = z.object({
  voteId: z.string().min(1),
  option: z.string().min(1).max(200),
});

export async function castBallotAction(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, formError: "Invalid input." };

  try {
    await castBallot({ ...parsed.data, userId: session.user.id });
    revalidatePath("/[locale]/me/coop/[id]", "page");
    return { ok: true };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not vote." };
  }
}
