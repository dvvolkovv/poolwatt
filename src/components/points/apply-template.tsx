"use client";

// US-25 — the button that touches fifty points. It says how many it changed,
// because an owner pressing this needs to know it actually ran.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  applyTemplateAction,
  deleteTemplateAction,
} from "@/app/[locale]/me/charger-operator/[id]/templates/actions";

export function ApplyTemplate({
  templateId,
  points,
  labels,
}: {
  templateId: string;
  points: { id: string; name: string }[];
  labels: {
    applyAll: string;
    applySelected: string;
    pick: string;
    remove: string;
    applied: string;
    allHint: string;
  };
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const apply = (pointIds: string[] | null) =>
    startTransition(async () => {
      setError(null);
      setDone(null);
      const r = await applyTemplateAction({ templateId, pointIds });
      if (!r.ok) setError(r.formError);
      else {
        setDone(r.applied ?? 0);
        router.refresh();
      }
    });

  return (
    <div className="space-y-2" data-testid={`apply-${templateId}`}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
            {labels.pick}
          </span>
          <select
            multiple
            value={picked}
            onChange={(e) => setPicked(Array.from(e.target.selectedOptions).map((o) => o.value))}
            aria-label={labels.pick}
            className="min-w-[220px] rounded border border-hairline bg-bg px-2 py-1 text-sm"
          >
            {points.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={pending}
          data-testid={`apply-all-${templateId}`}
          onClick={() => apply(null)}
          className="rounded border border-accent px-3 py-1 text-[13px] text-accent hover:bg-accent/10 disabled:opacity-50"
        >
          {labels.applyAll} ({points.length})
        </button>
        <button
          type="button"
          disabled={pending || picked.length === 0}
          data-testid={`apply-some-${templateId}`}
          onClick={() => apply(picked)}
          className="rounded border border-hairline px-3 py-1 text-[13px] hover:border-accent disabled:opacity-50"
        >
          {labels.applySelected} ({picked.length})
        </button>
        <button
          type="button"
          disabled={pending}
          data-testid={`delete-${templateId}`}
          onClick={() =>
            startTransition(async () => {
              const r = await deleteTemplateAction({ templateId });
              if (!r.ok) setError(r.formError);
              else router.refresh();
            })
          }
          className="rounded border border-hairline px-3 py-1 text-[13px] text-muted hover:border-down disabled:opacity-50"
        >
          {labels.remove}
        </button>
      </div>
      <p className="text-[12px] text-muted">{labels.allHint}</p>
      {done != null && (
        <p className="text-[13px] text-up" data-testid={`applied-${templateId}`}>
          {labels.applied}: <span className="num">{done}</span>
        </p>
      )}
      {error && (
        <p className="text-[13px] text-down" data-testid="apply-error">
          {error}
        </p>
      )}
    </div>
  );
}
