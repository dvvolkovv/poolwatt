"use server";

// The operator's decision on a point card — ТЗ §29.4, US-24.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { decidePoint } from "@/lib/points/point-service";
import { sendPointDecisionToOwner } from "@/lib/points/point-mail";

const schema = z.object({
  pointId: z.string().min(1),
  approved: z.boolean(),
  note: z.string().trim().max(1000).nullable(),
});

export async function decidePointAction(
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
    const point = await decidePoint(
      parsed.data.pointId,
      session.user.id,
      parsed.data.approved,
      parsed.data.note,
    );
    await sendPointDecisionToOwner({
      pointId: point.id,
      name: point.name,
      approved: parsed.data.approved,
      note: point.reviewNote,
    });
    revalidatePath("/[locale]/admin/points/[id]", "page");
    revalidatePath("/[locale]/admin/points", "page");
    return { ok: true };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not decide." };
  }
}
