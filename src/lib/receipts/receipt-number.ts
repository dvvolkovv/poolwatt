// Document identity for a receipt — ТЗ §46.
//
// The number comes from one Postgres sequence, not from a count of rows: two
// receipts issued in the same millisecond must not claim the same number, and
// `count() + 1` under concurrency does exactly that. The sequence is created
// by the migration, outside any table, so it survives even if a receipt is
// deleted.
//
// What this number is *not*: a tax invoice number. Numbering under the law of
// the point's country is part of the tax opinion the owner still owes
// (see the EU legal plan, "Налоговое заключение по НДС").

import { randomBytes } from "node:crypto";
import type { Db } from "@/lib/exchange/audit";

export interface ReceiptStamp {
  number: string;
  verifyCode: string;
}

/** The next document number, as `PW-<year>-<6 digits>`. */
export async function nextReceiptNumber(db: Db, now: Date = new Date()): Promise<string> {
  const rows = await db.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('receipt_number_seq')`;
  const seq = Number(rows[0]?.nextval ?? 0);
  return `PW-${now.getUTCFullYear()}-${String(seq).padStart(6, "0")}`;
}

/**
 * The secret behind the QR code. A printed receipt is seen by anyone who picks
 * it up off the floor, so the verification page may only be reachable with
 * something that cannot be guessed from the receipt id or the number.
 */
export function newVerifyCode(): string {
  return randomBytes(16).toString("hex");
}

export async function receiptStamp(db: Db, now: Date = new Date()): Promise<ReceiptStamp> {
  return { number: await nextReceiptNumber(db, now), verifyCode: newVerifyCode() };
}
