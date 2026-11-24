"use client";

// US-02 — the operator records the KYB and sanctions verdicts before deciding.
// No provider is contracted yet, so these are their own checks: the form asks
// what they searched, because a verdict with nothing behind it proves nothing.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordScreeningCheck } from "@/app/[locale]/admin/listings/actions";

const KINDS = ["KYB", "SANCTIONS", "ADVERSE_MEDIA"] as const;
const RESULTS = ["CLEAR", "HIT", "INCONCLUSIVE"] as const;

export type ScreeningLabels = {
  title: string;
  help: string;
  kind: string;
  result: string;
  evidence: string;
  evidencePlaceholder: string;
  save: string;
  saving: string;
  latest: string;
  none: string;
  blocked: string;
  ready: string;
  provider: string;
  checkedAt: string;
  kindNames: Record<string, string>;
  resultNames: Record<string, string>;
};

export type LatestRow = {
  kind: string;
  result: string;
  provider: string;
  checkedAt: string;
  evidence: string | null;
};

export function ScreeningForm({
  companyId,
  latest,
  blockedReason,
  labels,
}: {
  companyId: string;
  latest: LatestRow[];
  blockedReason: string | null;
  labels: ScreeningLabels;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<(typeof KINDS)[number]>("KYB");
  const [result, setResult] = useState<(typeof RESULTS)[number]>("CLEAR");
  const [evidence, setEvidence] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const r = await recordScreeningCheck({ companyId, kind, result, evidence });
      if (!r.ok) {
        setError(r.formError);
        return;
      }
      setEvidence("");
      router.refresh();
    });
  }

  return (
    <section className="mb-8 rounded border border-hairline p-4">
      <h2 className="text-[13px] uppercase tracking-[0.14em] text-muted">{labels.title}</h2>
      <p className="mb-4 mt-1 max-w-[80ch] text-[12px] text-muted">{labels.help}</p>

      {latest.length === 0 ? (
        <p className="mb-4 text-sm text-muted">{labels.none}</p>
      ) : (
        <ul className="mb-4 text-sm">
          {latest.map((row) => (
            <li key={row.kind} className="border-b border-hairline py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span>
                  <b>{labels.kindNames[row.kind] ?? row.kind}</b>:{" "}
                  <span className={row.result === "CLEAR" ? "text-up" : "text-down"}>
                    {labels.resultNames[row.result] ?? row.result}
                  </span>
                </span>
                <span className="num text-[12px] text-muted">
                  {labels.provider}: {row.provider} · {labels.checkedAt}: {row.checkedAt}
                </span>
              </div>
              {row.evidence && (
                <p className="mt-1 text-[12px] text-muted">{row.evidence}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className={`mb-4 text-[13px] ${blockedReason ? "text-down" : "text-up"}`}>
        {blockedReason ? `${labels.blocked} ${blockedReason}` : labels.ready}
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <Caption>{labels.kind}</Caption>
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}
            className="rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {labels.kindNames[k] ?? k}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <Caption>{labels.result}</Caption>
          <select
            name="result"
            value={result}
            onChange={(e) => setResult(e.target.value as (typeof RESULTS)[number])}
            className="rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
          >
            {RESULTS.map((r) => (
              <option key={r} value={r}>
                {labels.resultNames[r] ?? r}
              </option>
            ))}
          </select>
        </label>

        <label className="block min-w-[18rem] flex-1 text-sm">
          <Caption>{labels.evidence}</Caption>
          <input
            name="evidence"
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder={labels.evidencePlaceholder}
            maxLength={2000}
            className="w-full rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
          />
        </label>

        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded border border-hairline px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50"
        >
          {pending ? labels.saving : labels.save}
        </button>
      </div>

      {error && <p className="mt-2 text-[13px] text-down">{error}</p>}
    </section>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
      {children}
    </span>
  );
}
