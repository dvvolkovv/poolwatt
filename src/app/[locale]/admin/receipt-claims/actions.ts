"use server";

// §46 — support's side of a returned receipt: correct it by the regulation,
// or refuse in words the accountant can act on.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { correctReceipt, rejectClaim } from "@/lib/receipts/receipt-correction";

export type ClaimActionResult =
  | { ok: true; issuedReceiptId?: string }
  | { ok: false; formError: string };

const correctSchema = z.object({
  claimId: z.string().min(1),
  changes: z
    .array(
      z.object({
        field: z.string().min(1).max(60),
        after: z.union([z.string().max(300), z.number(), z.null()]),
      }),
    )
    .min(1)
    .max(12),
  note: z.string().trim().max(2000).optional(),
});

async function asSupport<T>(run: (userId: string) => Promise<T>): Promise<
  { ok: true; value: T } | { ok: false; formError: string }
> {
  const session = await auth();
  // Support is the platform operator, not a partner: §46 returns the receipt
  // "в поддержку Poolwatt".
  if (!session?.user || session.user.role !== "ADMIN") {
    return { ok: false, formError: "Not authorised." };
  }
  try {
    const value = await run(session.user.id);
    revalidatePath("/[locale]/admin/receipt-claims", "page");
    return { ok: true, value };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not do that." };
  }
}

export async function correctReceiptAction(input: unknown): Promise<ClaimActionResult> {
  const parsed = correctSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const result = await asSupport((userId) =>
    correctReceipt(userId, {
      claimId: parsed.data.claimId,
      changes: parsed.data.changes,
      note: parsed.data.note,
    }),
  );
  if (!result.ok) return result;
  return { ok: true, issuedReceiptId: result.value.issuedReceiptId };
}

const rejectSchema = z.object({
  claimId: z.string().min(1),
  reason: z.string().trim().min(10).max(2000),
});

export async function rejectClaimAction(input: unknown): Promise<ClaimActionResult> {
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: "Say why, in words the accountant can use." };
  }
  const result = await asSupport((userId) =>
    rejectClaim(userId, parsed.data.claimId, parsed.data.reason),
  );
  return result.ok ? { ok: true } : result;
}
