"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { setNetworkPrice } from "@/lib/pricing/network-price";
import { generateToken } from "@/lib/charger-operator-tokens";

export type ActionResult = {
  ok: boolean;
  fieldErrors?: Record<string, string>;
  formError?: string;
};

function nullify(s: string | undefined): string | null {
  return s && s.trim() !== "" ? s : null;
}

async function assertOwner(operatorId: string): Promise<
  | { ok: true; userId: string }
  | { ok: false; result: ActionResult }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, result: { ok: false, formError: "Not authenticated." } };
  const op = await prisma.chargerOperator.findUnique({
    where: { id: operatorId },
    select: { claimedById: true },
  });
  if (!op) return { ok: false, result: { ok: false, formError: "Operator not found." } };
  if (op.claimedById !== session.user.id) {
    return { ok: false, result: { ok: false, formError: "Not authorized." } };
  }
  return { ok: true, userId: session.user.id };
}

const cardSchema = z.object({
  operatorId: z.string().min(1),
  displayName: z.string().min(1, "Display name is required.").max(120),
  description: z.string().max(2000).optional(),
  websiteUrl: z.string().url().or(z.literal("")).optional(),
  logoUrl: z.string().url().or(z.literal("")).optional(),
  email: z.string().email().or(z.literal("")).optional(),
  phone: z.string().max(50).optional(),
});

export type UpdateChargerOperatorCardInput = z.input<typeof cardSchema>;

export async function updateChargerOperatorCard(input: UpdateChargerOperatorCardInput): Promise<ActionResult> {
  const parsed = cardSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]?.toString();
      if (key) fieldErrors[key] = issue.message;
    }
    return { ok: false, fieldErrors };
  }
  const owner = await assertOwner(parsed.data.operatorId);
  if (!owner.ok) return owner.result;

  await prisma.chargerOperator.update({
    where: { id: parsed.data.operatorId },
    data: {
      displayName: parsed.data.displayName,
      description: nullify(parsed.data.description),
      websiteUrl: nullify(parsed.data.websiteUrl),
      logoUrl: nullify(parsed.data.logoUrl),
      email: nullify(parsed.data.email),
      phone: nullify(parsed.data.phone),
    },
  });

  revalidatePath(`/[locale]/c`, "page");
  return { ok: true };
}

const SUPPORTED_CURRENCIES = ["EUR", "USD", "GBP", "CZK", "PLN", "CHF", "RUB", "UAH"] as const;

const priceSchema = z.object({
  operatorId: z.string().min(1),
  // null clears the operator's published tariff.
  pricePerKwh: z
    .number()
    .positive("Price must be greater than zero.")
    .max(99.9999, "Price must be at most 99.9999.")
    .nullable(),
  currency: z.enum(SUPPORTED_CURRENCIES).nullable(),
});

export type UpdateChargerOperatorPriceInput = z.input<typeof priceSchema>;

export async function updateChargerOperatorPrice(input: UpdateChargerOperatorPriceInput): Promise<ActionResult> {
  const parsed = priceSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]?.toString();
      if (key) fieldErrors[key] = issue.message;
    }
    return { ok: false, fieldErrors };
  }
  const { operatorId, pricePerKwh, currency } = parsed.data;
  // A price without a currency would render as a bare number — refuse it.
  if (pricePerKwh !== null && currency === null) {
    return { ok: false, fieldErrors: { currency: "Currency is required when price is set." } };
  }

  const owner = await assertOwner(operatorId);
  if (!owner.ok) return owner.result;

  // §54 — the price and its version are written together.
  await setNetworkPrice({
    operatorId,
    pricePerKwh,
    currency,
    actorId: owner.userId,
  });

  revalidatePath(`/[locale]/c`, "page");
  revalidatePath(`/[locale]/navigator`, "page");
  return { ok: true };
}

// ---- API keys (Step 4) ----------------------------------------------------

const createApiKeySchema = z.object({
  operatorId: z.string().min(1),
  label: z.string().min(1, "Label is required.").max(80),
});

export type CreateApiKeyResult =
  | { ok: true; plaintext: string; id: string }
  | { ok: false; fieldErrors?: Record<string, string>; formError?: string };

export async function createChargerOperatorApiKey(
  input: z.input<typeof createApiKeySchema>,
): Promise<CreateApiKeyResult> {
  const parsed = createApiKeySchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0]?.toString();
      if (k) fieldErrors[k] = issue.message;
    }
    return { ok: false, fieldErrors };
  }
  const owner = await assertOwner(parsed.data.operatorId);
  if (!owner.ok) return { ok: false, formError: owner.result.formError };

  const { plaintext, hash } = generateToken();
  const row = await prisma.chargerOperatorApiKey.create({
    data: { operatorId: parsed.data.operatorId, label: parsed.data.label, tokenHash: hash },
    select: { id: true },
  });
  return { ok: true, plaintext, id: row.id };
}

export async function revokeChargerOperatorApiKey(input: { keyId: string }): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };

  const key = await prisma.chargerOperatorApiKey.findUnique({
    where: { id: input.keyId },
    select: { id: true, revokedAt: true, operator: { select: { claimedById: true } } },
  });
  if (!key) return { ok: false, formError: "API key not found." };
  if (key.operator.claimedById !== session.user.id) return { ok: false, formError: "Not authorized." };
  if (key.revokedAt) return { ok: true }; // idempotent

  await prisma.chargerOperatorApiKey.update({
    where: { id: input.keyId },
    data: { revokedAt: new Date() },
  });
  return { ok: true };
}

export async function unlinkChargerOperatorClaim(input: { operatorId: string }): Promise<ActionResult> {
  const owner = await assertOwner(input.operatorId);
  if (!owner.ok) return owner.result;

  await prisma.chargerOperator.update({
    where: { id: input.operatorId },
    data: { claimedById: null, claimedAt: null },
  });

  return { ok: true };
}
