"use server";

// Server actions behind the trading terminal — ТЗ §6, §9.
// They are thin wrappers over the exchange services; every business rule
// (corridor, funding, inventory) lives in the service layer and is shared with
// the /v1 REST surface.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { OrderRejected, cancelOrder, placeOrder } from "@/lib/exchange/order-service";
import { buyAhead } from "@/lib/exchange/payment-service";

export type OrderActionResult =
  | {
      ok: true;
      orderId: string;
      status: string;
      filledKwh: number;
      avgPrice: number | null;
      notional: number;
      rejectReason: string | null;
    }
  | { ok: false; formError: string };

const placeSchema = z.object({
  zoneId: z.string().min(1),
  side: z.enum(["BUY", "SELL"]),
  type: z.enum(["MARKET", "LIMIT"]),
  amountKwh: z.number().positive().max(10_000_000),
  limitPrice: z.number().positive().max(99.9999).nullable(),
  intervalStart: z.string().nullable(),
});

export async function submitOrder(input: unknown): Promise<OrderActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };

  const parsed = placeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid order." };
  }
  if (parsed.data.type === "LIMIT" && parsed.data.limitPrice == null) {
    return { ok: false, formError: "A limit order needs a price." };
  }

  let intervalStart: Date | null = null;
  if (parsed.data.intervalStart) {
    const d = new Date(parsed.data.intervalStart);
    if (!Number.isNaN(d.getTime())) intervalStart = d;
  }

  try {
    const result = await placeOrder({
      userId: session.user.id,
      zoneId: parsed.data.zoneId,
      side: parsed.data.side,
      type: parsed.data.type,
      amountKwh: parsed.data.amountKwh,
      limitPrice: parsed.data.limitPrice,
      intervalStart,
    });
    revalidatePath("/[locale]/exchange", "page");
    return {
      ok: true,
      orderId: result.orderId,
      status: result.status,
      filledKwh: result.filledKwh,
      avgPrice: result.avgPrice,
      notional: result.notional,
      rejectReason: result.rejectReason,
    };
  } catch (err) {
    if (err instanceof OrderRejected) return { ok: false, formError: err.message };
    return { ok: false, formError: err instanceof Error ? err.message : "Order failed." };
  }
}

export async function withdrawOrder(orderId: string): Promise<{ ok: boolean; formError?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };
  try {
    await cancelOrder(orderId, session.user.id);
    revalidatePath("/[locale]/exchange", "page");
    return { ok: true };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Cancel failed." };
  }
}

const buyAheadSchema = z.object({
  zoneId: z.string().min(1),
  amountKwh: z.number().positive().max(1_000_000),
  limitPrice: z.number().positive().max(99.9999).nullable(),
});

/** US-07 — "покупка кВт·ч впрок" from the wallet screen. */
export async function submitBuyAhead(input: unknown): Promise<OrderActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };

  const parsed = buyAheadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid purchase." };
  }

  try {
    const result = await buyAhead({
      userId: session.user.id,
      zoneId: parsed.data.zoneId,
      amountKwh: parsed.data.amountKwh,
      limitPrice: parsed.data.limitPrice,
    });
    revalidatePath("/[locale]/me/wallet", "page");
    return {
      ok: true,
      orderId: result.orderId,
      status: result.status,
      filledKwh: result.filledKwh,
      avgPrice: result.avgPrice,
      notional: result.notional,
      rejectReason: result.rejectReason,
    };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Purchase failed." };
  }
}
