"use server";

// Producer listing cabinet — ТЗ §4, §9 "Веб-кабинет производителя", §12 US-01.
//
// The same services the /v1 REST surface uses, so a producer walking through
// the site and a partner driving the API end up with identical records.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  type ListingDocument,
  ListingError,
  addDocument,
  createCompany,
  documentsOf,
  draftApplicationFor,
  removeDocument,
  submitApplication,
} from "@/lib/exchange/listing-service";
import { DocumentError, MAX_DOCUMENT_BYTES } from "@/lib/exchange/listing-docs";
import { prisma } from "@/lib/prisma";
import { sendListingSubmittedToAdmin } from "@/lib/resend-listing";

export type ListingActionResult = {
  ok: boolean;
  companyId?: string;
  applicationId?: string;
  status?: string;
  documents?: ListingDocument[];
  fieldErrors?: Record<string, string>;
  formError?: string;
};

const companySchema = z.object({
  legalName: z.string().trim().min(2).max(200),
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "Country must be a two-letter ISO code"),
  regNumber: z.string().trim().min(1).max(100),
  vatNumber: z.string().trim().max(60).optional().nullable(),
  type: z.enum(["PRODUCER", "WHOLESALE", "COOPERATIVE", "OPERATOR"]),
  website: z.string().trim().max(300).optional().nullable(),
  contactName: z.string().trim().max(160).optional().nullable(),
  contactEmail: z.string().trim().email().max(200).optional().nullable().or(z.literal("")),
  contactPhone: z.string().trim().max(60).optional().nullable(),
});

export type CompanyInput = z.input<typeof companySchema>;

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !out[key]) out[key] = issue.message;
  }
  return out;
}

/** The company, if this caller may act on it. */
async function ownedCompany(companyId: string) {
  const session = await auth();
  if (!session?.user) return { error: "Not authenticated." as const };
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, legalName: true, country: true, type: true, ownerUserId: true },
  });
  if (!company) return { error: "Company not found." as const };
  if (company.ownerUserId !== session.user.id && session.user.role !== "ADMIN") {
    return { error: "This company belongs to someone else." as const };
  }
  return { company, userId: session.user.id };
}

export async function registerCompany(input: CompanyInput): Promise<ListingActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };

  const parsed = companySchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  const d = parsed.data;
  try {
    const company = await createCompany({
      legalName: d.legalName,
      country: d.country,
      regNumber: d.regNumber,
      vatNumber: d.vatNumber || null,
      type: d.type,
      website: d.website || null,
      contactName: d.contactName || null,
      contactEmail: d.contactEmail || null,
      contactPhone: d.contactPhone || null,
      ownerUserId: session.user.id,
    });
    const draft = await draftApplicationFor(company.id);
    revalidatePath("/[locale]/me/listing", "page");
    return { ok: true, companyId: company.id, applicationId: draft.id, documents: [] };
  } catch (err) {
    // The (country, regNumber) pair is unique: the company is already listed,
    // possibly by someone else, and that is not a field-level typo.
    const message = err instanceof Error ? err.message : String(err);
    if (/Unique constraint/i.test(message)) {
      return {
        ok: false,
        formError: `A company with registration number ${d.regNumber} in ${d.country.toUpperCase()} is already registered.`,
      };
    }
    return { ok: false, formError: message.slice(0, 300) };
  }
}

/** US-01 — one file into the company's draft application. */
export async function uploadDocument(
  companyId: string,
  file: File,
): Promise<ListingActionResult> {
  const guard = await ownedCompany(companyId);
  if ("error" in guard) return { ok: false, formError: guard.error };

  if (!file || file.size === 0) return { ok: false, formError: "Choose a file first." };
  if (file.size > MAX_DOCUMENT_BYTES) {
    return {
      ok: false,
      formError: `The file is ${Math.round(file.size / 1024 / 1024)} MB, over the 20 MB limit.`,
    };
  }

  try {
    const draft = await draftApplicationFor(companyId);
    const { application } = await addDocument({
      applicationId: draft.id,
      filename: file.name,
      bytes: Buffer.from(await file.arrayBuffer()),
      actorUserId: guard.userId,
    });
    revalidatePath("/[locale]/me/listing/[companyId]", "page");
    return {
      ok: true,
      companyId,
      applicationId: draft.id,
      documents: application.documents,
    };
  } catch (err) {
    if (err instanceof DocumentError || err instanceof ListingError) {
      return { ok: false, formError: err.message };
    }
    return { ok: false, formError: err instanceof Error ? err.message : "Upload failed." };
  }
}

export async function dropDocument(
  companyId: string,
  docId: string,
): Promise<ListingActionResult> {
  const guard = await ownedCompany(companyId);
  if ("error" in guard) return { ok: false, formError: guard.error };

  try {
    const draft = await draftApplicationFor(companyId);
    const { documents } = await removeDocument({
      applicationId: draft.id,
      docId,
      actorUserId: guard.userId,
    });
    revalidatePath("/[locale]/me/listing/[companyId]", "page");
    return { ok: true, companyId, applicationId: draft.id, documents };
  } catch (err) {
    if (err instanceof ListingError) return { ok: false, formError: err.message };
    return { ok: false, formError: err instanceof Error ? err.message : "Removal failed." };
  }
}

/** US-01 — draft → "на проверке", and the operator hears about it. */
export async function sendApplication(companyId: string): Promise<ListingActionResult> {
  const guard = await ownedCompany(companyId);
  if ("error" in guard) return { ok: false, formError: guard.error };

  try {
    const application = await submitApplication({
      companyId,
      actorUserId: guard.userId,
    });
    const documents = documentsOf(application);
    await sendListingSubmittedToAdmin({
      applicationId: application.id,
      legalName: guard.company.legalName,
      country: guard.company.country,
      type: guard.company.type,
      documents: documents.length,
    });
    revalidatePath("/[locale]/me/listing", "page");
    revalidatePath("/[locale]/me/listing/[companyId]", "page");
    return {
      ok: true,
      companyId,
      applicationId: application.id,
      status: application.status,
      documents,
    };
  } catch (err) {
    if (err instanceof ListingError) return { ok: false, formError: err.message };
    return { ok: false, formError: err instanceof Error ? err.message : "Submit failed." };
  }
}
