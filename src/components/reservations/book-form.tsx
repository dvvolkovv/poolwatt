"use client";

// US-30 — "забронировать разъём". The driver picks a connector and roughly
// when they will be there; the window follows from the owner's waiting time.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { book, type BookResult } from "@/app/[locale]/c/[id]/book/actions";

const WHEN = [15, 30, 60, 120];

export function BookForm({
  connectors,
  policy,
  labels,
}: {
  connectors: { id: string; label: string; free: boolean }[];
  policy: {
    feeFiat: number;
    guaranteeFiat: number;
    noShowPenaltyFiat: number;
    waitMinutes: number;
    freeCancelMinutes: number;
    currency: string;
  };
  labels: {
    title: string;
    connector: string;
    when: string;
    minutes: string;
    book: string;
    booking: string;
    terms: string;
    fee: string;
    guarantee: string;
    penalty: string;
    window: string;
    freeCancel: string;
    booked: string;
    noFreeConnector: string;
  };
}) {
  const router = useRouter();
  const free = connectors.filter((c) => c.free);
  const [connectorId, setConnectorId] = useState(free[0]?.id ?? "");
  const [inMinutes, setInMinutes] = useState(30);
  const [result, setResult] = useState<BookResult | null>(null);
  const [pending, startTransition] = useTransition();

  if (free.length === 0) {
    return <p className="text-sm text-muted">{labels.noFreeConnector}</p>;
  }

  if (result?.ok) {
    return (
      <p className="text-sm text-up" data-testid="booking-made">
        {labels.booked} {new Date(result.windowEnd).toISOString().slice(11, 16)}
      </p>
    );
  }

  return (
    <div className="space-y-3" data-testid="book-form">
      <h2 className="text-[11px] uppercase tracking-[0.14em] text-muted">{labels.title}</h2>

      <label className="block">
        <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
          {labels.connector}
        </span>
        <select
          value={connectorId}
          onChange={(e) => setConnectorId(e.target.value)}
          aria-label={labels.connector}
          className="w-full rounded border border-hairline bg-bg px-3 py-2 text-sm"
        >
          {free.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend className="mb-1 text-[11px] uppercase tracking-[0.14em] text-muted">
          {labels.when}
        </legend>
        <div className="flex flex-wrap gap-2">
          {WHEN.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setInMinutes(m)}
              className={`rounded border px-3 py-1.5 text-[13px] ${
                m === inMinutes ? "border-accent text-accent" : "border-hairline text-muted"
              }`}
            >
              +{m} {labels.minutes}
            </button>
          ))}
        </div>
      </fieldset>

      <dl className="border-t border-hairline pt-3 text-[12px]">
        <div className="text-muted">{labels.terms}</div>
        <Row label={labels.fee} value={`${policy.feeFiat.toFixed(2)} ${policy.currency}`} />
        <Row
          label={labels.guarantee}
          value={`${policy.guaranteeFiat.toFixed(2)} ${policy.currency}`}
        />
        <Row
          label={labels.penalty}
          value={`${policy.noShowPenaltyFiat.toFixed(2)} ${policy.currency}`}
        />
        <Row label={labels.window} value={`${policy.waitMinutes} ${labels.minutes}`} />
        <Row
          label={labels.freeCancel}
          value={`${policy.freeCancelMinutes} ${labels.minutes}`}
        />
      </dl>

      <button
        type="button"
        data-testid="book-submit"
        disabled={pending || !connectorId}
        onClick={() => {
          setResult(null);
          startTransition(async () => {
            const r = await book({ connectorId, inMinutes });
            setResult(r);
            if (r.ok) router.refresh();
          });
        }}
        className="w-full rounded bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
      >
        {pending ? labels.booking : labels.book}
      </button>

      {result && !result.ok && (
        <p className="text-[13px] text-down" data-testid="book-error">
          {result.formError}
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-0.5">
      <dt className="text-muted">{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}
