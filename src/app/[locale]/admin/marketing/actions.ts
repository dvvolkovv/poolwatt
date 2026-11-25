"use server";

// The Poolwatt operator's decision on a partner's content — ТЗ §41
// "Модерация оператором Poolwatt перед публикацией".

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { decideContent } from "@/lib/marketing/content-service";
import { sendContentDecisionToPartner } from "@/lib/marketing/content-mail";

const schema = z.object({
  contentId: z.string().min(1),
  approved: z.boolean(),
  note: z.string().trim().max(1000).nullable(),
});

export async function decideContentAction(
  input: unknown,
): Promise<{ ok: boolean; formError?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };
  if (session.user.role !== "ADMIN") return { ok: false, formError: "Operators only." };

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const content = await decideContent(
      parsed.data.contentId,
      session.user.id,
      parsed.data.approved,
      parsed.data.note,
    );
    await sendContentDecisionToPartner({
      contentId: content.id,
      approved: parsed.data.approved,
      note: content.reviewNote,
    });
    revalidatePath("/[locale]/admin/marketing", "page");
    return { ok: true };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not decide." };
  }
}
