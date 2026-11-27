"use client";

// §46 — the accountant's button: this document is wrong, here is why, take it
// back. One claim at a time per document; the row says so afterwards.

import { useState, useTransition } from "react";
import { fileReceiptClaimAction } from "@/app/[locale]/me/charger-operator/[id]/accounting/actions";

const REASONS = ["REQUISITES", "VAT", "SESSION_DETAILS", "AMOUNTS", "OTHER"] as const;

export function ReturnReceiptForm({
  receiptId,
  labels,
}: {
  receiptId: string;
  labels: {
    open: string;
    reason: string;
    comment: string;
    send: string;
    sent: string;
    reasonNames: Record<string, string>;
  };
}) {
  const [shown, setShown] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number]>("REQUISITES");
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done) {
    return (
      <span className="text-[12px] text-up" data-testid="claim-sent">
        {labels.sent}
      </span>
    );
  }

  if (!shown) {
    return (
      <button
        type="button"
        onClick={() => setShown(true)}
        data-testid="return-receipt"
        className="text-[12px] text-muted underline hover:text-foreground"
      >
        {labels.open}
      </button>
    );
  }

  return (
    <div className="space-y-2" data-testid="return-receipt-form">
      <select
        value={reason}
        onChange={(e) => setReason(e.target.value as (typeof REASONS)[number])}
        aria-label={labels.reason}
        data-testid="claim-reason"
        className="w-full rounded border border-hairline bg-bg px-2 py-1 text-[12px]"
      >
        {REASONS.map((r) => (
          <option key={r} value={r}>
            {labels.reasonNames[r]}
          </option>
        ))}
      </select>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={labels.comment}
        aria-label={labels.comment}
        data-testid="claim-comment"
        rows={2}
        className="w-full rounded border border-hairline bg-bg px-2 py-1 text-[12px]"
      />
      <button
        type="button"
        disabled={pending || comment.trim().length < 10}
        data-testid="claim-send"
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const r = await fileReceiptClaimAction({ receiptId, reason, comment });
            if (r.ok) setDone(true);
            else setError(r.formError);
          });
        }}
        className="rounded border border-accent px-2 py-1 text-[12px] text-accent hover:bg-accent/10 disabled:opacity-50"
      >
        {labels.send}
      </button>
      {error && (
        <p className="text-[12px] text-down" data-testid="claim-send-error">
          {error}
        </p>
      )}
    </div>
  );
}
