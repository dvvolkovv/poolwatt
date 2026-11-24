"use client";

// US-29 — the open alarms of one station, and clearing them (ТЗ §30).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clearAlert } from "@/app/[locale]/me/listing/[companyId]/assets/[assetId]/actions";

export type AlertRow = {
  id: string;
  kind: string;
  note: string;
  occurredAt: string;
  notified: boolean;
};

export function AssetAlerts({
  alerts,
  labels,
}: {
  alerts: AlertRow[];
  labels: {
    title: string;
    none: string;
    notified: string;
    pending: string;
    notePlaceholder: string;
    clear: string;
    kind: Record<string, string>;
  };
}) {
  const router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <section className="mt-10" data-testid="asset-alerts">
      <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">{labels.title}</h2>
      {alerts.length === 0 ? (
        <p className="text-sm text-muted">{labels.none}</p>
      ) : (
        <ul className="divide-y divide-hairline text-sm">
          {alerts.map((a) => (
            <li key={a.id} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-down">{labels.kind[a.kind] ?? a.kind}</span>
                <span className="num text-[12px] text-muted">
                  {a.occurredAt.slice(0, 16).replace("T", " ")} ·{" "}
                  {a.notified ? labels.notified : labels.pending}
                </span>
              </div>
              <p className="mt-1 text-[13px] text-muted">{a.note}</p>
              <div className="mt-2 flex gap-2">
                <input
                  value={notes[a.id] ?? ""}
                  onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })}
                  placeholder={labels.notePlaceholder}
                  aria-label={labels.notePlaceholder}
                  className="flex-1 rounded border border-hairline bg-transparent px-2 py-1 text-[13px]"
                />
                <button
                  type="button"
                  disabled={pending || !(notes[a.id] ?? "").trim()}
                  onClick={() => {
                    setError(null);
                    startTransition(async () => {
                      const r = await clearAlert({ alertId: a.id, note: notes[a.id] ?? "" });
                      if (!r.ok) setError(r.formError ?? "Could not clear.");
                      else router.refresh();
                    });
                  }}
                  className="rounded border border-hairline px-3 py-1 text-[13px] hover:border-accent disabled:opacity-50"
                >
                  {labels.clear}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-[13px] text-down">{error}</p>}
    </section>
  );
}
