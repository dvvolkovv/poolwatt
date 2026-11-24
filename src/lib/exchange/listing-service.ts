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
import { ibansOpen } from "./gates";
import {
  MAX_DOCUMENT_BYTES,
  type StoredDocument,
  deleteDocument,
  readDocument,
  storeDocument,
} from "./listing-docs";
import { openCompanyAccount } from "./settlement-service";

export interface ListingDocument {
  name: string;
  url: string;
  bytes: number;
  mime: string;
  /** Set on files uploaded through the cabinet; absent on API-supplied links. */
  docId?: string;
}

export { MAX_DOCUMENT_BYTES };
export const ALLOWED_DOCUMENT_MIME = ["application/pdf", "image/jpeg", "image/png"];
/** Enough for a registration certificate, licences and per-asset grid papers. */
export const MAX_DOCUMENTS = 30;

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

/**
 * POST /v1/companies. §14 — the company is born with a DRAFT application, so
 * the cabinet has somewhere to put documents before anything is submitted.
 */
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
      applications: { create: { status: ListingApplicationStatus.DRAFT } },
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

/** The open application of a company: the DRAFT it is filling, created on demand. */
export async function draftApplicationFor(companyId: string, db: Db = prisma) {
  const open = await db.listingApplication.findFirst({
    where: { companyId, status: ListingApplicationStatus.DRAFT },
    orderBy: { createdAt: "desc" },
  });
  if (open) return open;
  return db.listingApplication.create({
    data: { companyId, status: ListingApplicationStatus.DRAFT },
  });
}

/** The documents column, typed. Shared by the cabinet, the admin page and the API. */
export function documentsOf(application: { documents: unknown }): ListingDocument[] {
  return Array.isArray(application.documents) ? (application.documents as ListingDocument[]) : [];
}

async function draftOrThrow(applicationId: string, db: Db) {
  const application = await db.listingApplication.findUniqueOrThrow({
    where: { id: applicationId },
  });
  if (application.status !== ListingApplicationStatus.DRAFT) {
    throw new ListingError(
      `Documents can only be changed while the application is a draft, this one is ${application.status}`,
    );
  }
  return application;
}

/** US-01 — one uploaded file joins the draft. */
export async function addDocument(
  args: { applicationId: string; filename: string; bytes: Buffer; actorUserId: string },
  db: Db = prisma,
): Promise<{ application: { documents: ListingDocument[] }; document: StoredDocument }> {
  const application = await draftOrThrow(args.applicationId, db);
  const existing = documentsOf(application);
  if (existing.length >= MAX_DOCUMENTS) {
    throw new ListingError(`An application takes at most ${MAX_DOCUMENTS} documents`);
  }

  const document = await storeDocument({
    applicationId: application.id,
    filename: args.filename,
    bytes: args.bytes,
  });

  const documents = [...existing, document];
  const updated = await db.listingApplication.update({
    where: { id: application.id },
    data: { documents: documents as unknown as Prisma.InputJsonValue },
  });
  await writeAudit(db, {
    actor: args.actorUserId,
    entity: "ListingApplication",
    entityId: application.id,
    action: "listing.document.added",
    after: { name: document.name, bytes: document.bytes, mime: document.mime },
  });
  return { application: { ...updated, documents }, document };
}

/** US-01 — the producer takes a file back out of the draft. */
export async function removeDocument(
  args: { applicationId: string; docId: string; actorUserId: string },
  db: Db = prisma,
): Promise<{ documents: ListingDocument[] }> {
  const application = await draftOrThrow(args.applicationId, db);
  const documents = documentsOf(application).filter((d) => d.docId !== args.docId);

  await deleteDocument(application.id, args.docId);
  const updated = await db.listingApplication.update({
    where: { id: application.id },
    data: { documents: documents as unknown as Prisma.InputJsonValue },
  });
  await writeAudit(db, {
    actor: args.actorUserId,
    entity: "ListingApplication",
    entityId: application.id,
    action: "listing.document.removed",
    after: { docId: args.docId, left: documents.length },
  });
  return { ...updated, documents };
}

export type DocumentFetch =
  | { status: "ok"; bytes: Buffer; mime: string; name: string }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "not-found" };

/**
 * One document, for the download route. KYB papers are visible to the company
 * that filed them and to the operator reviewing them (US-02), and to nobody
 * else — the id alone is not an access grant.
 */
export async function fetchDocument(
  args: {
    applicationId: string;
    docId: string;
    user: { id: string; role: "USER" | "ADMIN" } | null;
  },
  db: Db = prisma,
): Promise<DocumentFetch> {
  if (!args.user) return { status: "unauthorized" };

  const application = await db.listingApplication.findUnique({
    where: { id: args.applicationId },
    select: { id: true, documents: true, company: { select: { ownerUserId: true } } },
  });
  if (!application) return { status: "not-found" };

  const isOwner =
    application.company.ownerUserId !== null &&
    application.company.ownerUserId === args.user.id;
  if (!isOwner && args.user.role !== "ADMIN") return { status: "forbidden" };

  const entry = documentsOf(application).find((d) => d.docId === args.docId);
  if (!entry) return { status: "not-found" };

  const file = await readDocument(application.id, args.docId);
  if (!file) return { status: "not-found" };

  return { status: "ok", bytes: file.bytes, mime: file.mime, name: entry.name };
}

/**
 * POST /v1/listing-applications — §14 draft → submitted.
 *
 * The cabinet uploads files into the draft first and submits with no
 * `documents`; an API client may instead hand over links in one call, which
 * replaces whatever the draft held.
 */
export async function submitApplication(
  args: { companyId: string; documents?: ListingDocument[]; actorUserId: string },
  db: Db = prisma,
) {
  const open = await db.listingApplication.findFirst({
    where: {
      companyId: args.companyId,
      status: { in: [ListingApplicationStatus.DRAFT, ListingApplicationStatus.SUBMITTED] },
    },
    orderBy: { createdAt: "desc" },
  });

  const documents = args.documents ?? documentsOf(open ?? { documents: [] });
  const problem = validateDocuments(documents);
  if (problem) throw new ListingError(problem);

  const data = {
    documents: documents as unknown as Prisma.InputJsonValue,
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
    after: { documents: documents.length },
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
      // US-13 — the IBAN opens on approval, before any payout can be due. No
      // bank to issue it must not hold up the decision itself.
      if (ibansOpen()) {
        accountId = (await openCompanyAccount(tx, application.companyId)).id;
      }

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

    // The caller sends the decision mail after the transaction commits.
    return {
      application: updated,
      accountId,
      promotedAssets,
      ownerUserId: application.company.ownerUserId,
    };
  });
}
