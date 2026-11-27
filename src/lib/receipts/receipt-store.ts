// The receipt as a stored document — ТЗ §46.
//
// `receipt-document.ts` *builds* a document out of live rows. That is the
// right way to make one and the wrong way to read one: until this file
// existed, every reader rebuilt the receipt from whatever the rows said
// today, so a partner editing their VAT rate or their legal name quietly
// rewrote receipts issued months ago — and the DATEV export of a closed month
// with them. §46 asks for "исправление по регламенту с журналом изменений",
// which only means something if the document stops changing by itself.
//
// So: the document is frozen the first time it is read, and from then on it is
// read back verbatim. Changing it goes through a claim and a correction
// (`receipt-claims.ts`, `receipt-correction.ts`), which issue a new version
// rather than edit this one.
//
// A receipt issued before this file existed freezes at its first read, with
// whatever the rows say at that moment. That is the best the data allows, and
// it is better than a document that never stops moving.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildReceiptDocument, type ReceiptDocument } from "./receipt-document";

/** The fields that are `Date` in the document and strings in the JSON. */
function reviveDates(doc: ReceiptDocument): ReceiptDocument {
  const date = (v: unknown): Date | null => {
    if (v instanceof Date) return v;
    if (typeof v === "string") {
      const parsed = new Date(v);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  };

  return {
    ...doc,
    issuedAt: date(doc.issuedAt) ?? new Date(0),
    session: doc.session
      ? {
          ...doc.session,
          startedAt: date(doc.session.startedAt),
          endedAt: date(doc.session.endedAt),
        }
      : null,
  };
}

/** The stored snapshot, as the document type sees it. */
export function reviveDocument(stored: Prisma.JsonValue | null): ReceiptDocument | null {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  return reviveDates(stored as unknown as ReceiptDocument);
}

/**
 * Build the document and store it, unless it is stored already.
 *
 * The write is conditional on `document: null`, so two readers racing for the
 * same unfrozen receipt cannot overwrite each other: the second one's update
 * matches no row and it reads what the first one wrote.
 */
export async function freezeReceiptDocument(receiptId: string): Promise<ReceiptDocument | null> {
  const doc = await buildReceiptDocument(receiptId);
  if (!doc) return null;

  await prisma.receipt.updateMany({
    // `Prisma.DbNull` is the column being NULL; a plain `null` here would
    // mean the JSON value `null` and match nothing.
    where: { id: receiptId, document: { equals: Prisma.DbNull } },
    data: { document: doc as unknown as Prisma.InputJsonValue },
  });

  const row = await prisma.receipt.findUnique({
    where: { id: receiptId },
    select: { document: true },
  });
  return reviveDocument(row?.document ?? null) ?? doc;
}

/**
 * The document this receipt *is* — what every reader should use: the page in
 * the wallet, the phone, the print view of a station terminal, the email.
 */
export async function readReceiptDocument(receiptId: string): Promise<ReceiptDocument | null> {
  const row = await prisma.receipt.findUnique({
    where: { id: receiptId },
    select: { id: true, document: true },
  });
  if (!row) return null;

  const stored = reviveDocument(row.document);
  if (stored) return stored;

  return freezeReceiptDocument(receiptId);
}
