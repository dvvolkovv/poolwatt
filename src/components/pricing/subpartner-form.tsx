"use client";

// §52 — "Комиссия для своих субпартнёров (если партнёр — сеть с франчайзи)".

import { useState, useTransition } from "react";
import { saveSubpartnerAction } from "@/app/[locale]/me/charger-operator/[id]/pricing/actions";

export function SubpartnerForm({
  headId,
  networks,
  labels,
}: {
  headId: string;
  networks: { id: string; displayName: string }[];
  labels: {
    network: string;
    pct: string;
    note: string;
    save: string;
    help: string;
    none: string;
  };
}) {
  const [subId, setSubId] = useState("");
  const [pct, setPct] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-3"
      data-testid="subpartner-form"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await saveSubpartnerAction({
            headId,
            subId,
            chargeFeePct: Number(pct),
            active: true,
            note: note.trim() || null,
          });
          if (!r.ok) setError(r.formError);
          else {
            setPct("");
            setNote("");
          }
        });
      }}
    >
      <p className="text-[12px] text-muted">{labels.help}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
            {labels.network}
          </span>
          <select
            value={subId}
            onChange={(e) => setSubId(e.target.value)}
            aria-label={labels.network}
            className="rounded border border-hairline bg-bg px-2 py-1 text-sm"
          >
            <option value="">{labels.none}</option>
            {networks.map((n) => (
              <option key={n.id} value={n.id}>
                {n.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
            {labels.pct}
          </span>
          <input
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            aria-label={labels.pct}
            className="num w-24 rounded border border-hairline bg-bg px-2 py-1 text-sm"
          />
        </label>
        <label className="block grow text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
            {labels.note}
          </span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label={labels.note}
            className="w-full rounded border border-hairline bg-bg px-2 py-1 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={pending || !subId || pct.trim() === ""}
          data-testid="save-subpartner"
          className="rounded border border-accent px-3 py-1 text-[13px] text-accent hover:bg-accent/10 disabled:opacity-50"
        >
          {labels.save}
        </button>
      </div>
      {error && (
        <p className="text-[13px] text-down" data-testid="subpartner-error">
          {error}
        </p>
      )}
    </form>
  );
}
