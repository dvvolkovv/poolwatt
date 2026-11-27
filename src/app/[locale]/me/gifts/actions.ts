"use server";

// §42's promo code, as the driver enters it: in the cabinet, on the phone, or
// by opening the link a QR sticker carries.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { redeemPromoCode } from "@/lib/marketing/promo-code";

export type RedeemResult =
  | { ok: true; networkName: string; campaignName: string }
  | { ok: false; formError: string };

const schema = z.object({ code: z.string().trim().min(3).max(40) });

export async function redeemPromoCodeAction(input: unknown): Promise<RedeemResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, formError: "Enter the code." };

  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };

  try {
    const redeemed = await redeemPromoCode(session.user.id, parsed.data.code);
    revalidatePath("/[locale]/me/gifts", "page");
    revalidatePath("/[locale]/app/wallet", "page");
    return {
      ok: true,
      networkName: redeemed.networkName,
      campaignName: redeemed.campaignName,
    };
  } catch (err) {
    return {
      ok: false,
      formError: err instanceof Error ? err.message : "That code did not work.",
    };
  }
}
