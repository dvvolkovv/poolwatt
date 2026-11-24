"use client";

// §33 — the owner's booking terms. US-32: a change here applies to new
// bookings; the ones that exist keep the terms they were made under, which
// the service guarantees by copying them onto the booking.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveReservationPolicy } from "@/app/[locale]/me/charger-operator/[id]/points/[pointId]/policy-actions";

export type PolicyFormValues = {
  enabled: boolean;
  walkUpConnectors: number;
  feeFiat: number;
  guaranteeFiat: number;
  noShowPenaltyFiat: number;
  waitMinutes: number;
  freeCancelMinutes: number;
  maxAheadHours: number;
  feeCountsTowards: boolean;
  coopFree: boolean;
};

export function PolicyForm({
  pointId,
  initial,
  labels,
}: {
  pointId: string;
  initial: PolicyFormValues;
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof PolicyFormValues>(key: K, value: PolicyFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  return (
    <section className="mt-10" data-testid="policy-form">
      <h2 className="mb-1 text-[13px] uppercase tracking-[0.14em] text-muted">
        {labels.title}
      </h2>
      <p className="mb-3 max-w-[80ch] text-[12px] text-muted">{labels.help}</p>

      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={values.enabled}
          onChange={(e) => set("enabled", e.target.checked)}
        />
        {labels.enabled}
      </label>

      <div className="flex flex-wrap items-end gap-3">
        <Num label={labels.feeFiat} value={values.feeFiat} onChange={(v) => set("feeFiat", v)} />
        <Num
          label={labels.guaranteeFiat}
          value={values.guaranteeFiat}
          onChange={(v) => set("guaranteeFiat", v)}
        />
        <Num
          label={labels.noShowPenaltyFiat}
          value={values.noShowPenaltyFiat}
          onChange={(v) => set("noShowPenaltyFiat", v)}
        />
        <Num
          label={labels.waitMinutes}
          value={values.waitMinutes}
          onChange={(v) => set("waitMinutes", v)}
        />
        <Num
          label={labels.freeCancelMinutes}
          value={values.freeCancelMinutes}
          onChange={(v) => set("freeCancelMinutes", v)}
        />
        <Num
          label={labels.maxAheadHours}
          value={values.maxAheadHours}
          onChange={(v) => set("maxAheadHours", v)}
        />
        <Num
          label={labels.walkUpConnectors}
          value={values.walkUpConnectors}
          onChange={(v) => set("walkUpConnectors", v)}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-4 text-[13px]">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={values.feeCountsTowards}
            onChange={(e) => set("feeCountsTowards", e.target.checked)}
          />
          {labels.feeCountsTowards}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={values.coopFree}
            onChange={(e) => set("coopFree", e.target.checked)}
          />
          {labels.coopFree}
        </label>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          data-testid="policy-save"
          disabled={pending}
          onClick={() => {
            setError(null);
            setSaved(false);
            startTransition(async () => {
              const r = await saveReservationPolicy({ pointId, ...values });
              if (!r.ok) setError(r.formError ?? "Could not save.");
              else {
                setSaved(true);
                router.refresh();
              }
            });
          }}
          className="rounded border border-hairline px-3 py-1.5 text-[13px] hover:border-accent disabled:opacity-50"
        >
          {labels.save}
        </button>
        {saved && <span className="text-[12px] text-accent">{labels.saved}</span>}
        {error && <span className="text-[12px] text-down">{error}</span>}
      </div>
    </section>
  );
}

function Num({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
        {label}
      </span>
      <input
        value={String(value)}
        inputMode="decimal"
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value.replace(",", ".")) || 0)}
        className="num w-[110px] rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
      />
    </label>
  );
}
