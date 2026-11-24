"use server";

// Operator decision on a listing application — ТЗ §15 PATCH
// /v1/listing-applications/{id}/decision, US-02. Shares the service with the
// REST route so both paths apply the same side effects (KYB, IBAN, assets).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { ListingError, decideApplication } from "@/lib/exchange/listing-service";
import { sendListingDecisionToOwner } from "@/lib/resend-listing";

export type DecisionResult =
  | { ok: true; status: string; accountId: string | null; promotedAssets: number }
  | { ok: false; formError: string };

const schema = z
  .object({
    applicationId: z.string().min(1),
    approve: z.boolean(),
    comment: z.string().max(2000).optional().nullable(),
    screeningNote: z.string().max(2000).optional().nullable(),
  })
  .refine((v) => v.approve || Boolean(v.comment?.trim()), {
    message: "A rejection requires a comment.",
    path: ["comment"],
  });

export async function decideListing(input: unknown): Promise<DecisionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };
  if (session.user.role !== "ADMIN") return { ok: false, formError: "Operator role required." };

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid decision." };
  }

  try {
    const result = await decideApplication({
      applicationId: parsed.data.applicationId,
      reviewerId: session.user.id,
      approve: parsed.data.approve,
      comment: parsed.data.comment ?? null,
      screeningNote: parsed.data.screeningNote ?? null,
    });
    // US-02 — the producer must learn the decision and its comment.
    await sendListingDecisionToOwner({
      applicationId: parsed.data.applicationId,
      ownerUserId: result.ownerUserId,
      approved: parsed.data.approve,
      comment: parsed.data.comment ?? null,
    });
    revalidatePath("/[locale]/admin/listings", "page");
    return {
      ok: true,
      status: result.application.status,
      accountId: result.accountId,
      promotedAssets: result.promotedAssets,
    };
  } catch (err) {
    if (err instanceof ListingError) return { ok: false, formError: err.message };
    return { ok: false, formError: err instanceof Error ? err.message : "Decision failed." };
  }
}
