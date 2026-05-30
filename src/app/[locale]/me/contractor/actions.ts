"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { contractorSchema, type ContractorInput } from "@/lib/contractor-schema";
import { slugify } from "@/lib/slugify";

export type ActionResult = {
  ok: boolean;
  id?: string;
  fieldErrors?: Record<string, string>;
  formError?: string;
};

async function generateUniqueSlug(base: string): Promise<string> {
  const root = slugify(base);
  const candidates = await prisma.contractor.findMany({
    where: { slug: { startsWith: root } },
    select: { slug: true },
  });
  const taken = new Set(candidates.map((c) => c.slug));
  if (!taken.has(root)) return root;
  for (let n = 2; n < 10_000; n++) {
    const cand = `${root}-${n}`.slice(0, 60);
    if (!taken.has(cand)) return cand;
  }
  // extremely unlikely fallback
  return `${root}-${Date.now()}`.slice(0, 60);
}

export async function createContractor(input: ContractorInput): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated" };

  const parsed = contractorSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0];
      if (typeof k === "string" && !fieldErrors[k]) fieldErrors[k] = issue.message;
    }
    return { ok: false, fieldErrors };
  }

  const d = parsed.data;
  const slug = await generateUniqueSlug(d.displayName);

  const created = await prisma.$transaction(async (tx) => {
    const c = await tx.contractor.create({
      data: {
        slug,
        entityType: d.entityType,
        displayName: d.displayName,
        legalName: d.legalName ?? null,
        registrationNumber: d.registrationNumber ?? null,
        country: d.country,
        city: d.city,
        foundedYear: d.foundedYear ?? null,
        workCategories: d.workCategories,
        renewableTypes: d.renewableTypes,
        countriesServed: d.countriesServed,
        bio: d.bio,
        websiteUrl: d.websiteUrl ?? null,
        logoUrl: d.logoUrl ?? null,
        contactEmail: d.contactEmail,
        contactPhone: d.contactPhone,
      },
      select: { id: true, slug: true, displayName: true, country: true, entityType: true },
    });
    await tx.contractorMember.create({
      data: { contractorId: c.id, userId: session.user.id, role: "OWNER" },
    });
    return c;
  });

  try {
    const { sendContractorNewToAdmin } = await import("@/lib/resend-contractor");
    await sendContractorNewToAdmin(created);
  } catch (err) {
    console.error("[contractor] admin notification failed:", err);
  }

  revalidatePath("/[locale]/me/contractor", "page");
  return { ok: true, id: created.id };
}

async function requireOwnerMembership(contractorId: string, userId: string) {
  const member = await prisma.contractorMember.findUnique({
    where: { contractorId_userId: { contractorId, userId } },
    select: { role: true },
  });
  return member?.role === "OWNER";
}

export async function updateContractor(
  id: string,
  input: ContractorInput,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated" };

  const existing = await prisma.contractor.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!existing) return { ok: false, formError: "Contractor not found" };

  const isOwner = await requireOwnerMembership(id, session.user.id);
  if (!isOwner) return { ok: false, formError: "Contractor not found" };  // 404-style, don't leak existence

  if (existing.status !== "PENDING") {
    return { ok: false, formError: "Cannot edit a contractor that is no longer PENDING" };
  }

  const parsed = contractorSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0];
      if (typeof k === "string" && !fieldErrors[k]) fieldErrors[k] = issue.message;
    }
    return { ok: false, fieldErrors };
  }

  const d = parsed.data;
  // keep in sync with createContractor's data block
  await prisma.contractor.update({
    where: { id },
    data: {
      entityType: d.entityType,
      displayName: d.displayName,
      legalName: d.legalName ?? null,
      registrationNumber: d.registrationNumber ?? null,
      country: d.country,
      city: d.city,
      foundedYear: d.foundedYear ?? null,
      workCategories: d.workCategories,
      renewableTypes: d.renewableTypes,
      countriesServed: d.countriesServed,
      bio: d.bio,
      websiteUrl: d.websiteUrl ?? null,
      logoUrl: d.logoUrl ?? null,
      contactEmail: d.contactEmail,
      contactPhone: d.contactPhone,
    },
  });

  revalidatePath("/[locale]/me/contractor", "page");
  revalidatePath(`/[locale]/me/contractor/${id}`, "page");
  return { ok: true, id };
}

export async function withdrawContractor(id: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated" };

  const existing = await prisma.contractor.findUnique({
    where: { id },
    select: { id: true, status: true, displayName: true, country: true, entityType: true },
  });
  if (!existing) return { ok: false, formError: "Contractor not found" };

  const isOwner = await requireOwnerMembership(id, session.user.id);
  if (!isOwner) return { ok: false, formError: "Contractor not found" };

  if (existing.status !== "PENDING") {
    return { ok: false, formError: "Cannot withdraw a contractor that is no longer PENDING" };
  }

  // Delete row; ContractorMember rows cascade.
  await prisma.contractor.delete({ where: { id } });

  try {
    const { sendContractorWithdrawnToAdmin } = await import("@/lib/resend-contractor");
    await sendContractorWithdrawnToAdmin(existing);
  } catch (err) {
    console.error("[contractor] withdraw notification failed:", err);
  }

  revalidatePath("/[locale]/me/contractor", "page");
  return { ok: true };
}
