"use server";

// §22.8, US-19 — перевод кВт·ч, подтверждение и отклонение.
//
// Все три зовут ту же службу, что метод API: правила §24 (кооператив, KYC,
// одна зона, пределы AML, реестр токенов и журнал) и подпись §25 живут там,
// а не здесь.

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  cancelTransfer,
  confirmTransfer,
  transferKwh,
} from "@/lib/exchange/transfer-service";

const sendSchema = z.object({
  zoneId: z.string().min(1),
  toUsername: z.string().min(3).max(30),
  amountKwh: z.number().positive().max(100_000),
  note: z.string().max(200),
  requireConfirmation: z.boolean(),
  assertion: z.unknown().optional(),
});

function fail(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : "Could not do that." };
}

export async function sendTransfer(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign in first." };

  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await transferKwh({
      fromUserId: session.user.id,
      toUsername: parsed.data.toUsername,
      zoneId: parsed.data.zoneId,
      amountKwh: parsed.data.amountKwh,
      note: parsed.data.note || null,
      requireConfirmation: parsed.data.requireConfirmation,
      sca: (parsed.data.assertion ?? null) as never,
      // §15 — один ключ на одно намерение, как в формах кабинета.
      idempotencyKey: randomUUID(),
    });
    revalidatePath("/[locale]/app/contacts", "page");
    revalidatePath("/[locale]/app/wallet", "page");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function acceptTransfer(
  transferId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign in first." };
  try {
    await confirmTransfer(transferId, session.user.id);
    revalidatePath("/[locale]/app/contacts", "page");
    revalidatePath("/[locale]/app/wallet", "page");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function declineTransfer(
  transferId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sign in first." };
  try {
    await cancelTransfer(transferId, session.user.id);
    revalidatePath("/[locale]/app/contacts", "page");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
