// §46 "исправление по регламенту с журналом изменений" — the second half of
// the claim flow.
//
// The regulation, in three rules:
//
//   1. Nothing is edited in place. A correction issues a *new version*: a new
//      `Receipt` with its own number and QR, carrying the corrected
//      document and pointing at the original. Both stay readable forever.
//   2. Only what does not move money or energy may change: the network's
//      requisites, the VAT rate and tax note (the sum paid stays, its split
//      changes — the ordinary reason for a corrected invoice in the EU), and
//      the descriptive fields of the session.
//   3. Every change is written down: who, when, and field by field what it
//      was and what it became (`ReceiptCorrection`).
//
// A claim about the amount is not a document error, it is a refund, and
// refunds need a payment provider — see `receiptRefundsOpen` in gates.

import { Prisma, type ReceiptClaimReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/exchange/audit";
import { assertReceiptRefundsOpen, receiptRefundsOpen } from "@/lib/exchange/gates";
import { receiptStamp } from "./receipt-number";
import { readReceiptDocument } from "./receipt-store";
import { splitVat } from "./vat";
import { notifyClaimant } from "./receipt-claims";

export class ReceiptCorrectionError extends Error {}

/** Exactly what rule 2 allows. Anything else is refused by name. */
export const CORRECTABLE_FIELDS = [
  "network.legalName",
  "network.regNumber",
  "network.vatNumber",
  "network.address",
  "vat.ratePct",
  "taxNote",
  "session.pointName",
  "session.pointAddress",
  "session.connector",
] as const;

export type CorrectableField = (typeof CORRECTABLE_FIELDS)[number];

export interface CorrectionChange {
  field: CorrectableField;
  before: string | number | null;
  after: string | number | null;
}

export interface CorrectionInput {
  claimId: string;
  /** Only the fields that actually change; an empty list is not a correction. */
  changes: { field: string; after: string | number | null }[];
  note?: string;
}

function isCorrectable(field: string): field is CorrectableField {
  return (CORRECTABLE_FIELDS as readonly string[]).includes(field);
}

function readPath(doc: Record<string, unknown>, path: CorrectableField): string | number | null {
  const [head, tail] = path.split(".") as [string, string | undefined];
  const top = doc[head];
  if (!tail) return (top as string | number | null) ?? null;
  if (!top || typeof top !== "object") return null;
  const value = (top as Record<string, unknown>)[tail];
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function writePath(
  doc: Record<string, unknown>,
  path: CorrectableField,
  value: string | number | null,
): void {
  const [head, tail] = path.split(".") as [string, string | undefined];
  if (!tail) {
    doc[head] = value;
    return;
  }
  const current = doc[head];
  if (!current || typeof current !== "object") {
    throw new ReceiptCorrectionError(`This receipt has no ${head} to correct`);
  }
  (current as Record<string, unknown>)[tail] = value;
}

/**
 * Issue the corrected version of a receipt under a claim.
 *
 * Safe to call twice: a claim that already carries a correction is refused,
 * and the check sits inside the transaction under a lock on the claim row, so
 * two clicks cannot produce two versions.
 */
export async function correctReceipt(
  supportUserId: string,
  input: CorrectionInput,
): Promise<{ correctionId: string; issuedReceiptId: string; changes: CorrectionChange[] }> {
  if (input.changes.length === 0) {
    throw new ReceiptCorrectionError("A correction with nothing in it is not a correction");
  }
  for (const change of input.changes) {
    if (!isCorrectable(change.field)) {
      throw new ReceiptCorrectionError(
        `${change.field} cannot be corrected: a receipt's amounts and its point are what happened, not what it says`,
      );
    }
  }

  const claim = await prisma.receiptClaim.findUnique({
    where: { id: input.claimId },
    include: { receipt: true },
  });
  if (!claim) throw new ReceiptCorrectionError("No such claim");
  if (claim.status !== "OPEN") throw new ReceiptCorrectionError("This claim is already answered");

  // §46 — the one claim support cannot answer with a document.
  if (claim.reason === "AMOUNTS" && !receiptRefundsOpen()) assertReceiptRefundsOpen();

  const doc = await readReceiptDocument(claim.receiptId);
  if (!doc) throw new ReceiptCorrectionError("That receipt has no document to correct");

  const next = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
  const changes: CorrectionChange[] = [];
  for (const change of input.changes) {
    const field = change.field as CorrectableField;
    const before = readPath(next, field);
    if (before === change.after) continue;
    writePath(next, field, change.after);
    changes.push({ field, before, after: change.after });
  }
  if (changes.length === 0) {
    throw new ReceiptCorrectionError("Those fields already say that");
  }

  // The VAT rate decides the split of a sum that does not change, so the
  // split is recomputed rather than left to disagree with the rate.
  if (changes.some((c) => c.field === "vat.ratePct")) {
    const ratePct = readPath(next, "vat.ratePct");
    next.vat = splitVat(
      Number(claim.receipt.totalFiat),
      typeof ratePct === "number" ? ratePct : null,
    );
  }

  const stamp = await receiptStamp(prisma, new Date());

  const result = await prisma.$transaction(async (tx) => {
    // Re-read under a lock: two support clicks must not both issue a version.
    const [locked] = await tx.$queryRaw<{ id: string; status: string }[]>`
      SELECT id, status::text AS status FROM "ReceiptClaim" WHERE id = ${input.claimId} FOR UPDATE
    `;
    if (!locked || locked.status !== "OPEN") {
      throw new ReceiptCorrectionError("This claim is already answered");
    }

    const issued = await tx.receipt.create({
      data: {
        ...stamp,
        correctsReceiptId: claim.receiptId,
        documentVersion: claim.receipt.documentVersion + 1,
        totalKwh: claim.receipt.totalKwh,
        totalFiat: claim.receipt.totalFiat,
        currency: claim.receipt.currency,
        burnedTokenIds: claim.receipt.burnedTokenIds,
        breakdown: claim.receipt.breakdown as Prisma.InputJsonValue,
        document: Prisma.DbNull,
      },
    });

    // The new document knows it is a document in its own right.
    const issuedDoc = {
      ...next,
      id: issued.id,
      number: stamp.number,
      verifyUrl: next.verifyUrl
        ? String(next.verifyUrl).replace(/[^/]+$/, stamp.verifyCode)
        : null,
    };
    await tx.receipt.update({
      where: { id: issued.id },
      data: { document: issuedDoc as unknown as Prisma.InputJsonValue },
    });

    const correction = await tx.receiptCorrection.create({
      data: {
        claimId: claim.id,
        receiptId: claim.receiptId,
        issuedReceiptId: issued.id,
        correctedById: supportUserId,
        changes: changes as unknown as Prisma.InputJsonValue,
        note: input.note?.trim() || null,
      },
    });

    await tx.receiptClaim.update({
      where: { id: claim.id },
      data: {
        status: "CORRECTED",
        resolvedById: supportUserId,
        resolvedAt: new Date(),
        resolution: input.note?.trim() || "Corrected document issued",
        // The claim is closed, so the next one is allowed.
        openKey: null,
      },
    });

    await writeAudit(tx, {
      actor: supportUserId,
      entity: "Receipt",
      entityId: claim.receiptId,
      action: "receipt.corrected",
      after: {
        claimId: claim.id,
        issuedReceiptId: issued.id,
        issuedNumber: stamp.number,
        changes,
      },
    });

    return { correctionId: correction.id, issuedReceiptId: issued.id, changes };
  });

  await notifyClaimant(claim.id).catch((err) =>
    console.error("[receipts] claim answer mail failed", err),
  );

  return result;
}

/**
 * Refuse a claim. The reason is mandatory: an accountant cannot act on
 * "no".
 */
export async function rejectClaim(
  supportUserId: string,
  claimId: string,
  reason: string,
): Promise<void> {
  const text = reason.trim();
  if (text.length < 10) throw new ReceiptCorrectionError("Say why, in words the accountant can use");

  const claim = await prisma.receiptClaim.findUnique({ where: { id: claimId } });
  if (!claim) throw new ReceiptCorrectionError("No such claim");
  if (claim.status !== "OPEN") throw new ReceiptCorrectionError("This claim is already answered");

  await prisma.$transaction(async (tx) => {
    const updated = await tx.receiptClaim.updateMany({
      where: { id: claimId, status: "OPEN" },
      data: {
        status: "REJECTED",
        resolvedById: supportUserId,
        resolvedAt: new Date(),
        resolution: text,
        openKey: null,
      },
    });
    if (updated.count === 0) {
      throw new ReceiptCorrectionError("This claim is already answered");
    }
    await writeAudit(tx, {
      actor: supportUserId,
      entity: "ReceiptClaim",
      entityId: claimId,
      action: "receipt.claim.rejected",
      after: { reason: text },
    });
  });

  await notifyClaimant(claimId).catch((err) =>
    console.error("[receipts] claim answer mail failed", err),
  );
}

/** §46's journal, as a page shows it: newest first. */
export async function readCorrectionJournal(receiptId: string) {
  // Both sides of the chain share one journal: opening either version shows
  // the same history.
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    select: { id: true, correctsReceiptId: true },
  });
  if (!receipt) return [];
  const rootId = receipt.correctsReceiptId ?? receipt.id;

  const rows = await prisma.receiptCorrection.findMany({
    where: { OR: [{ receiptId: rootId }, { issuedReceiptId: rootId }] },
    orderBy: { createdAt: "desc" },
    include: {
      correctedBy: { select: { username: true } },
      issuedReceipt: { select: { id: true, number: true } },
      receipt: { select: { id: true, number: true } },
      claim: { select: { id: true, reason: true, comment: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt,
    by: r.correctedBy.username,
    note: r.note,
    changes: (r.changes as unknown as CorrectionChange[]) ?? [],
    fromReceiptId: r.receipt.id,
    fromNumber: r.receipt.number,
    toReceiptId: r.issuedReceipt.id,
    toNumber: r.issuedReceipt.number,
    claimReason: (r.claim?.reason ?? null) as ReceiptClaimReason | null,
    claimComment: r.claim?.comment ?? null,
  }));
}

/** The version in force for this receipt: the last one in the chain. */
export async function receiptInForce(
  receiptId: string,
): Promise<{ id: string; number: string | null }> {
  let current = await prisma.receipt.findUniqueOrThrow({
    where: { id: receiptId },
    select: { id: true, number: true, correctedBy: { select: { id: true } } },
  });
  // The chain is one step long in practice, but a corrected correction is
  // allowed and has to resolve to the last one.
  while (current.correctedBy) {
    current = await prisma.receipt.findUniqueOrThrow({
      where: { id: current.correctedBy.id },
      select: { id: true, number: true, correctedBy: { select: { id: true } } },
    });
  }
  return { id: current.id, number: current.number };
}
