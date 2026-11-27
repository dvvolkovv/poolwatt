"use client";

// §46 — the form support fills in: which fields of the document move, or why
// the claim is refused. The list of fields is closed on purpose: the
// regulation allows what does not touch money.

import { useState, useTransition } from "react";
import {
  correctReceiptAction,
  rejectClaimAction,
} from "@/app/[locale]/admin/receipt-claims/actions";

export interface ClaimField {
  field: string;
  label: string;
  current: string;
}

export function ClaimResolver({
  claimId,
  fields,
  labels,
}: {
  claimId: string;
  fields: ClaimField[];
  labels: {
    correct: string;
    reject: string;
    note: string;
    rejectReason: string;
    done: string;
    rejected: string;
    keep: string;
  };
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.field, f.current])),
  );
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const changed = fields
    .filter((f) => (values[f.field] ?? "") !== f.current)
    .map((f) => ({
      field: f.field,
      after:
        values[f.field] === ""
          ? null
          : f.field === "vat.ratePct"
            ? Number(values[f.field])
            : values[f.field],
    }));

  return (
    <div className="mt-3 space-y-3" data-testid="claim-resolver">
      <div className="grid gap-2 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.field} className="block text-[13px]">
            <span className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-muted">
              {f.label}
            </span>
            <input
              value={values[f.field] ?? ""}
              onChange={(e) => setValues({ ...values, [f.field]: e.target.value })}
              aria-label={f.label}
              data-testid={`claim-field-${f.field}`}
              className="w-full rounded border border-hairline bg-bg px-3 py-1.5 text-[13px]"
            />
          </label>
        ))}
      </div>

      <label className="block text-[13px]">
        <span className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-muted">
          {labels.note}
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label={labels.note}
          data-testid="claim-note"
          rows={2}
          className="w-full rounded border border-hairline bg-bg px-3 py-1.5 text-[13px]"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending || changed.length === 0}
          data-testid="claim-correct"
          onClick={() => {
            setError(null);
            setMessage(null);
            startTransition(async () => {
              const r = await correctReceiptAction({ claimId, changes: changed, note });
              if (r.ok) setMessage(labels.done);
              else setError(r.formError);
            });
          }}
          className="rounded border border-accent px-3 py-1.5 text-[13px] text-accent hover:bg-accent/10 disabled:opacity-50"
        >
          {labels.correct}
        </button>
        <span className="text-[12px] text-muted">{labels.keep}</span>
      </div>

      <div className="flex flex-wrap items-end gap-2 border-t border-hairline pt-3">
        <label className="block grow text-[13px]">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-muted">
            {labels.rejectReason}
          </span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label={labels.rejectReason}
            data-testid="claim-reject-reason"
            className="w-full rounded border border-hairline bg-bg px-3 py-1.5 text-[13px]"
          />
        </label>
        <button
          type="button"
          disabled={pending || reason.trim().length < 10}
          data-testid="claim-reject"
          onClick={() => {
            setError(null);
            setMessage(null);
            startTransition(async () => {
              const r = await rejectClaimAction({ claimId, reason });
              if (r.ok) setMessage(labels.rejected);
              else setError(r.formError);
            });
          }}
          className="rounded border border-hairline px-3 py-1.5 text-[13px] text-muted hover:border-down hover:text-down disabled:opacity-50"
        >
          {labels.reject}
        </button>
      </div>

      {message && (
        <p className="text-[13px] text-up" data-testid="claim-done">
          {message}
        </p>
      )}
      {error && (
        <p className="text-[13px] text-down" data-testid="claim-error">
          {error}
        </p>
      )}
    </div>
  );
}
