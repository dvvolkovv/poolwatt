"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

export async function unlinkChargerOperatorClaim(input: { operatorId: string }): Promise<ActionResult> {
  const owner = await assertOwner(input.operatorId);
  if (!owner.ok) return owner.result;

  await prisma.chargerOperator.update({
    where: { id: input.operatorId },
    data: { claimedById: null, claimedAt: null },
  });

  return { ok: true };
}
