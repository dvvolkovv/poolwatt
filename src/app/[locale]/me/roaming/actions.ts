"use server";

// §8 "Роуминг", §9.10, US-11 — the two steps the driver takes: see the
// conversion, then confirm it. The rules live in the services; this only
// carries the form's values there and back.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { chargeSession, quoteCharge } from "@/lib/exchange/payment-service";

const schema = z.object({
  visitedZoneId: z.string().min(1),
  amountKwh: z.number().positive().max(100_000),
});

const confirmSchema = schema.extend({
  // §15 — one key per confirmed quote, so a double click charges once.
  idempotencyKey: z.string().min(8).max(190),
});

export type RoamingQuoteResult =
  | {
      ok: true;
      amountKwh: number;
      /** Null when no corridor can serve this session at all. */
      corridor: {
        homeZoneCode: string;
        partnerName: string;
        conversionRate: number;
        feePct: number;
        allowanceKwh: number | null;
      } | null;
      kwhFromRoaming: number;
      roamingDebitKwh: number;
      roamingFeeKwh: number;
      kwhFromBalance: number;
      kwhToBuy: number;
      energyCost: number;
      fee: number;
      total: number;
      currency: string;
      unservedKwh: number;
      feasible: boolean;
    }
  | { ok: false; formError: string };

export async function quoteRoamingSession(input: unknown): Promise<RoamingQuoteResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const plan = await quoteCharge({
      userId: session.user.id,
      zoneId: parsed.data.visitedZoneId,
      requestedKwh: parsed.data.amountKwh,
    });
    return {
      ok: true,
      amountKwh: parsed.data.amountKwh,
      corridor: plan.roaming
        ? {
            homeZoneCode: plan.roaming.homeZoneCode,
            partnerName: plan.roaming.partnerName,
            conversionRate: plan.roaming.conversionRate,
            feePct: plan.roaming.feePct,
            allowanceKwh: plan.roaming.allowanceKwh,
          }
        : null,
      kwhFromRoaming: plan.kwhFromRoaming,
      roamingDebitKwh: plan.roamingDebitKwh,
      roamingFeeKwh: plan.roamingFeeKwh,
      kwhFromBalance: plan.kwhFromBalance,
      kwhToBuy: plan.kwhFromMarket + plan.kwhFromAggregator,
      energyCost: plan.energyCost,
      fee: plan.fee,
      total: plan.total,
      currency: plan.currency,
      unservedKwh: plan.unservedKwh,
      feasible: plan.feasible,
    };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not price it." };
  }
}

export type RoamingConfirmResult =
  | {
      ok: true;
      receiptId: string | null;
      deliveredKwh: number;
      kwhFromRoaming: number;
      unservedKwh: number;
      amountFiat: number;
      currency: string;
    }
  | { ok: false; formError: string };

export async function confirmRoamingSession(input: unknown): Promise<RoamingConfirmResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };

  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const result = await chargeSession({
      userId: session.user.id,
      zoneId: parsed.data.visitedZoneId,
      requestedKwh: parsed.data.amountKwh,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    if (result.status === "FAILED") {
      return { ok: false, formError: result.failureReason ?? "The session could not be served." };
    }
    revalidatePath("/[locale]/me/roaming", "page");
    return {
      ok: true,
      receiptId: result.receiptId,
      deliveredKwh: result.deliveredKwh,
      kwhFromRoaming: result.kwhFromRoaming,
      unservedKwh: result.unservedKwh,
      amountFiat: result.amountFiat,
      currency: result.currency,
    };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "The session failed." };
  }
}
