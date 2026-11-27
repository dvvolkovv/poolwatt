// §46 — a corrected document says so, and so does the one that replaced it.
// Both carry the journal, because "исправление по регламенту с журналом
// изменений" is of no use if the journal is only visible to support.

import Link from "next/link";
import type { CorrectionChange } from "@/lib/receipts/receipt-correction";

export interface CorrectionJournalEntry {
  id: string;
  at: Date;
  by: string;
  note: string | null;
  changes: CorrectionChange[];
  fromReceiptId: string;
  fromNumber: string | null;
  toReceiptId: string;
  toNumber: string | null;
}

export function CorrectionBanner({
  locale,
  /** Where a receipt lives on this surface: the cabinet or the phone. */
  receiptPath = (locale, id) => `/${locale}/me/wallet/receipts/${id}`,
  /** Set when this receipt has been replaced by a newer version. */
  correctedBy,
  /** Set when this receipt is itself a correction. */
  corrects,
  journal,
  labels,
}: {
  locale: string;
  receiptPath?: (locale: string, receiptId: string) => string;
  correctedBy: { id: string; number: string | null } | null;
  corrects: { id: string; number: string | null } | null;
  journal: CorrectionJournalEntry[];
  labels: { correctedBy: string; correctsDocument: string; journal: string };
}) {
  if (!correctedBy && !corrects && journal.length === 0) return null;

  const stamp = (d: Date) => d.toISOString().replace("T", " ").replace(/\..*Z$/, "Z");

  return (
    <div className="mb-4 rounded-lg border border-hairline bg-card-alt p-3 text-[13px]">
      {correctedBy && (
        <p data-testid="receipt-corrected-by">
          {labels.correctedBy.replace("{number}", correctedBy.number ?? correctedBy.id)}{" "}
          <Link
            href={receiptPath(locale, correctedBy.id)}
            prefetch={false}
            className="underline hover:text-accent"
          >
            →
          </Link>
        </p>
      )}
      {corrects && (
        <p data-testid="receipt-corrects">
          {labels.correctsDocument.replace("{number}", corrects.number ?? corrects.id)}{" "}
          <Link
            href={receiptPath(locale, corrects.id)}
            prefetch={false}
            className="underline hover:text-accent"
          >
            →
          </Link>
        </p>
      )}

      {journal.length > 0 && (
        <div className="mt-2 border-t border-hairline pt-2" data-testid="receipt-journal">
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted">
            {labels.journal}
          </div>
          <ul className="mt-1 space-y-1">
            {journal.map((entry) => (
              <li key={entry.id}>
                <span className="text-[12px] text-muted">
                  {stamp(entry.at)} · {entry.by}
                </span>
                <ul className="ml-4 list-disc text-[12px]">
                  {entry.changes.map((c) => (
                    <li key={c.field}>
                      {c.field}: <s>{String(c.before ?? "—")}</s> →{" "}
                      <strong>{String(c.after ?? "—")}</strong>
                    </li>
                  ))}
                </ul>
                {entry.note && <p className="ml-4 text-[12px] text-muted">{entry.note}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
