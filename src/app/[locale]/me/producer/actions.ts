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

async function assertOwner(producerId: string): Promise<
  | { ok: true; userId: string; handle: string }
  | { ok: false; result: ActionResult }
> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, result: { ok: false, formError: "Not authenticated." } };
  }
  const producer = await prisma.producer.findUnique({
    where: { id: producerId },
    select: { claimedById: true, handle: true },
  });
  if (!producer) {
    return { ok: false, result: { ok: false, formError: "Producer not found." } };
  }
  if (producer.claimedById !== session.user.id) {
    return { ok: false, result: { ok: false, formError: "Not authorized." } };
  }
  return { ok: true, userId: session.user.id, handle: producer.handle };
}

const cardSchema = z.object({
  producerId: z.string().min(1),
  displayName: z.string().min(1, "Display name is required.").max(120),
  bio: z.string().max(1000).optional(),
  logoUrl: z.string().url().or(z.literal("")).optional(),
  websiteUrl: z.string().url().or(z.literal("")).optional(),
  twitterUrl: z.string().url().or(z.literal("")).optional(),
});

export type UpdateProducerCardInput = z.input<typeof cardSchema>;

export async function updateProducerCard(input: UpdateProducerCardInput): Promise<ActionResult> {
  const parsed = cardSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]?.toString();
      if (key) fieldErrors[key] = issue.message;
    }
    return { ok: false, fieldErrors };
  }
  const owner = await assertOwner(parsed.data.producerId);
  if (!owner.ok) return owner.result;

  await prisma.producer.update({
    where: { id: parsed.data.producerId },
    data: {
      displayName: parsed.data.displayName,
      bio: nullify(parsed.data.bio),
      logoUrl: nullify(parsed.data.logoUrl),
      websiteUrl: nullify(parsed.data.websiteUrl),
      twitterUrl: nullify(parsed.data.twitterUrl),
    },
  });

  revalidatePath(`/[locale]/p/${owner.handle}`, "page");
  return { ok: true };
}

const profileSchema = z.object({
  producerId: z.string().min(1),
  description: z.string().max(2000).optional(),
  founded: z.number().int().min(1800).max(new Date().getFullYear() + 1).optional().nullable(),
  employees: z.string().max(50).optional(),
  website: z.string().url().or(z.literal("")).optional(),
  email: z.string().email().or(z.literal("")).optional(),
  phone: z.string().max(50).optional(),
  address: z.string().max(500).optional(),
  ceo: z.string().max(100).optional(),
  stockTicker: z.string().max(20).optional(),
});

export type UpdateProducerProfileInput = z.input<typeof profileSchema>;

export async function updateProducerProfile(input: UpdateProducerProfileInput): Promise<ActionResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]?.toString();
      if (key) fieldErrors[key] = issue.message;
    }
    return { ok: false, fieldErrors };
  }
  const owner = await assertOwner(parsed.data.producerId);
  if (!owner.ok) return owner.result;

  const data = {
    description: nullify(parsed.data.description),
    founded: parsed.data.founded ?? null,
    employees: nullify(parsed.data.employees),
    website: nullify(parsed.data.website),
    email: nullify(parsed.data.email),
    phone: nullify(parsed.data.phone),
    address: nullify(parsed.data.address),
    ceo: nullify(parsed.data.ceo),
    stockTicker: nullify(parsed.data.stockTicker),
  };

  await prisma.producerProfile.upsert({
    where: { producerId: parsed.data.producerId },
    create: { producerId: parsed.data.producerId, ...data },
    update: data,
  });

  revalidatePath(`/[locale]/p/${owner.handle}`, "page");
  return { ok: true };
}

export type UnlinkClaimInput = { producerId: string };

export async function unlinkClaim(input: UnlinkClaimInput): Promise<ActionResult> {
  const owner = await assertOwner(input.producerId);
  if (!owner.ok) return owner.result;

  await prisma.producer.update({
    where: { id: input.producerId },
    data: { claimedById: null, claimedAt: null },
  });

  revalidatePath(`/[locale]/p/${owner.handle}`, "page");
  return { ok: true };
}
