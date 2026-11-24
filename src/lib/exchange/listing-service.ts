// Producer listing and onboarding — ТЗ §4, §12 (US-01, US-02), §14, §19.
//
// The listing decision is the gate the whole platform hangs off: approving an
// application is what flips KYB to APPROVED, opens the participant's IBAN
// (§19 US-13) and lets their assets leave DRAFT for the telemetry probation.
// Nothing downstream re-checks those preconditions, so they are all applied
// here, in one transaction.

import {
  AssetStatus,
  CompanyType,
  KybStatus,
  ListingApplicationStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { type Db, writeAudit } from "./audit";
import { openCompanyAccount } from "./settlement-service";

export interface ListingDocument {
  name: string;
  url: string;
  bytes: number;
  mime: string;
}

/** US-01: PDF/JPG up to 20 MB. */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const ALLOWED_DOCUMENT_MIME = ["application/pdf", "image/jpeg", "image/png"];

export class ListingError extends Error {}

export function validateDocuments(docs: ListingDocument[]): string | null {
  if (docs.length === 0) return "At least one document is required";
  for (const d of docs) {
    if (!d.name || !d.url) return "Every document needs a name and a URL";
    if (d.bytes > MAX_DOCUMENT_BYTES) {
      return `${d.name} is ${Math.round(d.bytes / 1024 / 1024)} MB, over the 20 MB limit`;
    }
    if (!ALLOWED_DOCUMENT_MIME.includes(d.mime)) {
      return `${d.name} has unsupported type ${d.mime} (PDF, JPEG or PNG only)`;
    }
  }
  return null;
}

export interface CreateCompanyInput {
  legalName: string;
  country: string;
  regNumber: string;
  vatNumber?: string | null;
  type: CompanyType;
  website?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  ownerUserId: string;
}

/** POST /v1/companies. */
export async function createCompany(input: CreateCompanyInput, db: Db = prisma) {
  const company = await db.company.create({
    data: {
      legalName: input.legalName.trim(),
      country: input.country.toUpperCase(),
      regNumber: input.regNumber.trim(),
      vatNumber: input.vatNumber?.trim() || null,
      type: input.type,
      website: input.website?.trim() || null,
      contactName: input.contactName?.trim() || null,
      contactEmail: input.contactEmail?.trim() || null,
      contactPhone: input.contactPhone?.trim() || null,
      ownerUserId: input.ownerUserId,
    },
  });
  await writeAudit(db, {
    actor: input.ownerUserId,
    entity: "Company",
    entityId: company.id,
    action: "company.created",
    after: { legalName: company.legalName, country: company.country, type: company.type },
  });
  return company;
}

/** POST /v1/listing-applications — §14 draft → submitted. */
export async function submitApplication(
  args: { companyId: string; documents: ListingDocument[]; actorUserId: string },
  db: Db = prisma,
) {
  const problem = validateDocuments(args.documents);
  if (problem) throw new ListingError(problem);

  const open = await db.listingApplication.findFirst({
    where: {
      companyId: args.companyId,
      status: { in: [ListingApplicationStatus.DRAFT, ListingApplicationStatus.SUBMITTED] },
    },
  });

  const data = {
    documents: args.documents as unknown as Prisma.InputJsonValue,
    status: ListingApplicationStatus.SUBMITTED,
    submittedAt: new Date(),
    decisionComment: null,
    decidedAt: null,
    reviewerId: null,
  };

  const application = open
    ? await db.listingApplication.update({ where: { id: open.id }, data })
    : await db.listingApplication.create({ data: { companyId: args.companyId, ...data } });

  await writeAudit(db, {
    actor: args.actorUserId,
    entity: "ListingApplication",
    entityId: application.id,
    action: "listing.submitted",
    after: { documents: args.documents.length },
  });
  return application;
}

export interface DecisionInput {
  applicationId: string;
  reviewerId: string;
  approve: boolean;
  comment?: string | null;
  screeningNote?: string | null;
}

/**
 * PATCH /v1/listing-applications/{id}/decision — §14 submitted → approved /
 * rejected. US-02: a rejection must carry a comment.
 */
export async function decideApplication(input: DecisionInput) {
  return prisma.$transaction(async (tx) => {
    const application = await tx.listingApplication.findUniqueOrThrow({
      where: { id: input.applicationId },
      include: { company: true },
    });
    if (application.status !== ListingApplicationStatus.SUBMITTED) {
      throw new ListingError(
        `Only a submitted application can be decided, this one is ${application.status}`,
      );
    }
    if (!input.approve && !input.comment?.trim()) {
      throw new ListingError("A rejection requires a comment");
    }

    const now = new Date();
    const updated = await tx.listingApplication.update({
      where: { id: application.id },
      data: {
        status: input.approve
          ? ListingApplicationStatus.APPROVED
          : ListingApplicationStatus.REJECTED,
        reviewerId: input.reviewerId,
        decisionComment: input.comment?.trim() || null,
        decidedAt: now,
      },
    });

    await tx.company.update({
      where: { id: application.companyId },
      data: {
        kybStatus: input.approve ? KybStatus.APPROVED : KybStatus.REJECTED,
        screeningNote: input.screeningNote?.trim() || application.company.screeningNote,
      },
    });

    let accountId: string | null = null;
    let promotedAssets = 0;
    if (input.approve) {
      // US-13 — the IBAN opens on approval, before any payout can be due.
      const account = await openCompanyAccount(tx, application.companyId);
      accountId = account.id;

      // §14 — approved paperwork lets assets start their telemetry probation.
      const { count } = await tx.asset.updateMany({
        where: {
          companyId: application.companyId,
          status: { in: [AssetStatus.DRAFT, AssetStatus.REVIEW] },
        },
        data: { status: AssetStatus.TEST },
      });
      promotedAssets = count;
    }

    await writeAudit(tx, {
      actor: input.reviewerId,
      entity: "ListingApplication",
      entityId: application.id,
      action: input.approve ? "listing.approved" : "listing.rejected",
      before: { status: application.status },
      after: { status: updated.status, comment: updated.decisionComment, accountId, promotedAssets },
    });

    return { application: updated, accountId, promotedAssets };
  });
}
