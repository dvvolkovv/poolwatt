"use client";

// US-24, step one of the wizard: the draft row is created before anything
// else, so §29.2's autosave has something to save into.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPoint } from "@/app/[locale]/me/charger-operator/[id]/points/actions";

const TYPES = ["CHARGING_STATION", "POWERBANK", "GENERATION", "MIXED"] as const;

export function NewPointForm({
  operatorId,
  locale,
  labels,
}: {
  operatorId: string;
  locale: string;
  labels: {
    name: string;
    type: string;
    create: string;
    types: Record<string, string>;
  };
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]>("CHARGING_STATION");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await createPoint({ operatorId, type, name });
          if (!r.ok) setError(r.formError);
          else router.push(`/${locale}/me/charger-operator/${operatorId}/points/${r.pointId}`);
        });
      }}
    >
      <label className="block text-sm">
        <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
          {labels.name}
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label={labels.name}
          className="w-[260px] rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
          {labels.type}
        </span>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as (typeof TYPES)[number])}
          aria-label={labels.type}
          className="rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
        >
          {TYPES.map((v) => (
            <option key={v} value={v}>
              {labels.types[v]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={pending || name.trim().length < 2}
        className="rounded border border-hairline px-3 py-1.5 text-[13px] hover:border-accent disabled:opacity-50"
      >
        {labels.create}
      </button>
      {error && <p className="w-full text-[13px] text-down">{error}</p>}
    </form>
  );
}
