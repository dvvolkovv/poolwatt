"use client";

// US-52 — "сообщить о поломке за 30 секунд". The type is the button: one tap
// sends the report. Everything else on this screen is optional, because every
// extra required field is seconds the customer spends in the rain.

import { useState, useTransition } from "react";
import Link from "next/link";
import { sendReport, type ReportResult } from "@/app/[locale]/c/[id]/report/actions";

const TYPES = [
  "NO_START",
  "INTERRUPTED",
  "DAMAGED_CABLE",
  "SCREEN_DEAD",
  "BLOCKED",
  "WRONG_PRICE",
  "OTHER",
] as const;

export function ReportForm({
  pointId,
  locale,
  connectors,
  labels,
}: {
  pointId: string;
  locale: string;
  connectors: { id: string; label: string }[];
  labels: {
    connector: string;
    anyConnector: string;
    comment: string;
    send: string;
    sending: string;
    sent: string;
    opened: string;
    alternatives: string;
    noAlternatives: string;
    types: Record<string, string>;
  };
}) {
  const [connectorId, setConnectorId] = useState(connectors[0]?.id ?? "");
  const [comment, setComment] = useState("");
  const [result, setResult] = useState<ReportResult | null>(null);
  const [pending, startTransition] = useTransition();

  function send(problemType: string) {
    setResult(null);
    startTransition(async () => {
      const r = await sendReport({
        pointId,
        connectorId: connectorId || null,
        problemType,
        comment: comment.trim() || null,
      });
      setResult(r);
    });
  }

  if (result?.ok) {
    return (
      <div data-testid="report-sent" className="space-y-4">
        <p className="text-sm text-up">{labels.sent}</p>
        {result.opened && <p className="text-[13px] text-muted">{labels.opened}</p>}

        <section>
          <h2 className="mb-2 text-[11px] uppercase tracking-[0.14em] text-muted">
            {labels.alternatives}
          </h2>
          {result.alternatives.length === 0 ? (
            <p className="text-sm text-muted">{labels.noAlternatives}</p>
          ) : (
            <ul className="divide-y divide-hairline text-sm" data-testid="report-alternatives">
              {result.alternatives.map((p) => (
                <li key={p.id} className="flex items-baseline justify-between gap-3 py-2">
                  <Link
                    href={`/${locale}/c/${p.id}`}
                    prefetch={false}
                    className="underline hover:text-accent"
                  >
                    {p.name}
                  </Link>
                  <span className="num text-[12px] text-muted">
                    {[p.city, p.distanceM != null ? formatDistance(p.distanceM) : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {connectors.length > 0 && (
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
            <option value="">{labels.anyConnector}</option>
            {connectors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="problem-types">
        {TYPES.map((type) => (
          <button
            key={type}
            type="button"
            data-testid={`report-${type}`}
            disabled={pending}
            onClick={() => send(type)}
            className="rounded border border-hairline px-3 py-3 text-left text-sm hover:border-accent disabled:opacity-50"
          >
            {pending ? labels.sending : labels.types[type]}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
          {labels.comment}
        </span>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          aria-label={labels.comment}
          rows={3}
          className="w-full rounded border border-hairline bg-bg px-3 py-2 text-sm"
        />
      </label>

      {result && !result.ok && <p className="text-[13px] text-down">{result.formError}</p>}
    </div>
  );
}

function formatDistance(metres: number): string {
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
}
