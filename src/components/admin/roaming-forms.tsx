"use client";

// §8 — the operator's two forms: a corridor, and the period closed against
// one. Both are thin: every rule they obey lives in roaming-service.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  netPeriodAction,
  saveCorridorAction,
  type ActionResult,
} from "@/app/[locale]/admin/roaming/actions";

type Zone = { id: string; code: string };

export function CorridorForm({
  zones,
  labels,
}: {
  zones: Zone[];
  labels: {
    homeZone: string;
    visitedZone: string;
    partner: string;
    feePct: string;
    dailyLimit: string;
    noLimit: string;
    enabled: string;
    save: string;
    saved: string;
  };
}) {
  const [homeZone, setHomeZone] = useState(zones[0]?.code ?? "");
  const [visitedZone, setVisitedZone] = useState(zones[1]?.code ?? zones[0]?.code ?? "");
  const [partnerName, setPartnerName] = useState("");
  const [feePct, setFeePct] = useState("2");
  const [dailyLimit, setDailyLimit] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    startTransition(async () => {
      const r = await saveCorridorAction({
        homeZone,
        visitedZone,
        partnerName,
        feePct: Number(feePct.replace(",", ".")),
        dailyLimitKwh: dailyLimit.trim() === "" ? null : Number(dailyLimit.replace(",", ".")),
        enabled,
      });
      setResult(r);
      if (r.ok) router.refresh();
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="grid max-w-[44rem] grid-cols-1 gap-3 sm:grid-cols-2"
      data-testid="corridor-form"
    >
      <Field label={labels.homeZone}>
        <select
          value={homeZone}
          onChange={(e) => setHomeZone(e.target.value)}
          aria-label={labels.homeZone}
          className="w-full rounded border border-hairline bg-transparent px-2 py-1.5 text-sm"
        >
          {zones.map((z) => (
            <option key={z.id} value={z.code}>
              {z.code}
            </option>
          ))}
        </select>
      </Field>
      <Field label={labels.visitedZone}>
        <select
          value={visitedZone}
          onChange={(e) => setVisitedZone(e.target.value)}
          aria-label={labels.visitedZone}
          className="w-full rounded border border-hairline bg-transparent px-2 py-1.5 text-sm"
        >
          {zones.map((z) => (
            <option key={z.id} value={z.code}>
              {z.code}
            </option>
          ))}
        </select>
      </Field>
      <Field label={labels.partner}>
        <input
          value={partnerName}
          onChange={(e) => setPartnerName(e.target.value)}
          aria-label={labels.partner}
          data-testid="corridor-partner"
          className="w-full rounded border border-hairline bg-transparent px-2 py-1.5 text-sm"
        />
      </Field>
      <Field label={labels.feePct}>
        <input
          inputMode="decimal"
          value={feePct}
          onChange={(e) => setFeePct(e.target.value)}
          aria-label={labels.feePct}
          className="num w-full rounded border border-hairline bg-transparent px-2 py-1.5"
        />
      </Field>
      <Field label={labels.dailyLimit}>
        <input
          inputMode="decimal"
          value={dailyLimit}
          onChange={(e) => setDailyLimit(e.target.value)}
          placeholder={labels.noLimit}
          aria-label={labels.dailyLimit}
          className="num w-full rounded border border-hairline bg-transparent px-2 py-1.5"
        />
      </Field>
      <label className="flex items-center gap-2 self-end text-[13px]">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        {labels.enabled}
      </label>

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={pending || partnerName.trim().length < 2}
          data-testid="corridor-save"
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {pending ? "…" : labels.save}
        </button>
        {result && !result.ok && (
          <span className="ml-3 text-[12px] text-down">{result.formError}</span>
        )}
        {result?.ok && <span className="ml-3 text-[12px] text-up">{labels.saved}</span>}
      </div>
    </form>
  );
}

export function NetPeriodForm({
  agreementId,
  labels,
}: {
  agreementId: string;
  labels: { upTo: string; reference: string; close: string; closed: string };
}) {
  const [upTo, setUpTo] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    startTransition(async () => {
      const r = await netPeriodAction({
        agreementId,
        // Inclusive of the whole chosen day.
        upTo: `${upTo}T23:59:59.999Z`,
        reference,
      });
      setResult(r);
      if (r.ok) {
        setReference("");
        router.refresh();
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-wrap items-center gap-2"
      data-testid={`net-form-${agreementId}`}
    >
      <input
        type="date"
        value={upTo}
        onChange={(e) => setUpTo(e.target.value)}
        aria-label={labels.upTo}
        className="num rounded border border-hairline bg-transparent px-2 py-1 text-[12px]"
      />
      <input
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        placeholder={labels.reference}
        aria-label={labels.reference}
        data-testid={`net-reference-${agreementId}`}
        className="rounded border border-hairline bg-transparent px-2 py-1 text-[12px]"
      />
      <button
        type="submit"
        disabled={pending || reference.trim().length < 2}
        data-testid={`net-close-${agreementId}`}
        className="rounded border border-hairline px-2 py-1 text-[12px] hover:border-accent disabled:opacity-50"
      >
        {pending ? "…" : labels.close}
      </button>
      {result && !result.ok && <span className="text-[12px] text-down">{result.formError}</span>}
      {result?.ok && (
        <span className="text-[12px] text-up">
          {labels.closed} {result.message}
        </span>
      )}
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
