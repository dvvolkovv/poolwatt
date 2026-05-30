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
