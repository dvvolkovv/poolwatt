"use client";

// US-25 — one offer, many stations. The form edits a template's tariff
// windows and hours; applying it is the button on the row below.

import { useState, useTransition } from "react";
import { saveTemplateAction } from "@/app/[locale]/me/charger-operator/[id]/templates/actions";

const PAYMENT_METHODS = ["TOKEN", "POOLWATT_CARD", "BANK_CARD", "APP"] as const;

const field = "rounded border border-hairline bg-bg px-2 py-1 text-sm";
const label = "mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted";

interface Window {
  label: string;
  fromHour: string;
  toHour: string;
  priceFiat: string;
  priceTokens: string;
  idleFeePerMin: string;
  coopDiscount: string;
}

const emptyWindow = (): Window => ({
  label: "",
  fromHour: "0",
  toHour: "24",
  priceFiat: "",
  priceTokens: "",
  idleFeePerMin: "",
  coopDiscount: "0",
});

export interface TemplateFormLabels {
  name: string;
  windows: string;
  windowLabel: string;
  fromHour: string;
  toHour: string;
  priceFiat: string;
  priceTokens: string;
  idleFee: string;
  coopDiscount: string;
  addWindow: string;
  dropWindow: string;
  open24: string;
  holidayNote: string;
  paymentMethods: string;
  currency: string;
  save: string;
  help: string;
}

export function TemplateForm({
  operatorId,
  labels,
}: {
  operatorId: string;
  labels: TemplateFormLabels;
}) {
  const [name, setName] = useState("");
  const [windows, setWindows] = useState<Window[]>([emptyWindow()]);
  const [open24, setOpen24] = useState(true);
  const [holidayNote, setHolidayNote] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [paymentMethods, setPaymentMethods] = useState<string[]>(["TOKEN"]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));
  const patch = (i: number, key: keyof Window, value: string) =>
    setWindows((ws) => ws.map((w, j) => (j === i ? { ...w, [key]: value } : w)));

  return (
    <form
      className="space-y-4"
      data-testid="template-form"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await saveTemplateAction({
            operatorId,
            name,
            open24,
            holidayNote: holidayNote.trim() || null,
            paymentMethods,
            amenities: [],
            tariffs: windows.map((w) => ({
              label: w.label.trim() || null,
              // Hours are what an owner thinks in; minutes are what §28 stores.
              fromMinute: Math.round(Number(w.fromHour) * 60),
              toMinute: Math.round(Number(w.toHour) * 60),
              priceFiat: numOrNull(w.priceFiat),
              currency,
              priceTokens: numOrNull(w.priceTokens),
              idleFeePerMin: numOrNull(w.idleFeePerMin),
              coopDiscount: Number(w.coopDiscount || 0),
            })),
          });
          if (!r.ok) setError(r.formError);
          else {
            setName("");
            setWindows([emptyWindow()]);
          }
        });
      }}
    >
      <p className="text-[12px] text-muted">{labels.help}</p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className={label}>{labels.name}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label={labels.name}
            className={`${field} w-[220px]`}
          />
        </label>
        <label className="block text-sm">
          <span className={label}>{labels.currency}</span>
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
            aria-label={labels.currency}
            className={`${field} w-20`}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={open24} onChange={(e) => setOpen24(e.target.checked)} />
          {labels.open24}
        </label>
      </div>

      <fieldset>
        <legend className={label}>{labels.windows}</legend>
        <div className="space-y-2">
          {windows.map((w, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-muted">{labels.windowLabel}</span>
                <input
                  value={w.label}
                  onChange={(e) => patch(i, "label", e.target.value)}
                  aria-label={`${labels.windowLabel} ${i + 1}`}
                  className={`${field} w-24`}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-muted">{labels.fromHour}</span>
                <input
                  type="number"
                  min={0}
                  max={24}
                  value={w.fromHour}
                  onChange={(e) => patch(i, "fromHour", e.target.value)}
                  aria-label={`${labels.fromHour} ${i + 1}`}
                  className={`num ${field} w-16`}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-muted">{labels.toHour}</span>
                <input
                  type="number"
                  min={0}
                  max={24}
                  value={w.toHour}
                  onChange={(e) => patch(i, "toHour", e.target.value)}
                  aria-label={`${labels.toHour} ${i + 1}`}
                  className={`num ${field} w-16`}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-muted">{labels.priceFiat}</span>
                <input
                  type="number"
                  min={0}
                  step={0.0001}
                  value={w.priceFiat}
                  onChange={(e) => patch(i, "priceFiat", e.target.value)}
                  aria-label={`${labels.priceFiat} ${i + 1}`}
                  className={`num ${field} w-24`}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-muted">{labels.priceTokens}</span>
                <input
                  type="number"
                  min={0}
                  step={0.0001}
                  value={w.priceTokens}
                  onChange={(e) => patch(i, "priceTokens", e.target.value)}
                  aria-label={`${labels.priceTokens} ${i + 1}`}
                  className={`num ${field} w-24`}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-muted">{labels.idleFee}</span>
                <input
                  type="number"
                  min={0}
                  step={0.0001}
                  value={w.idleFeePerMin}
                  onChange={(e) => patch(i, "idleFeePerMin", e.target.value)}
                  aria-label={`${labels.idleFee} ${i + 1}`}
                  className={`num ${field} w-20`}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-muted">{labels.coopDiscount}</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={w.coopDiscount}
                  onChange={(e) => patch(i, "coopDiscount", e.target.value)}
                  aria-label={`${labels.coopDiscount} ${i + 1}`}
                  className={`num ${field} w-16`}
                />
              </label>
              {windows.length > 1 && (
                <button
                  type="button"
                  onClick={() => setWindows((ws) => ws.filter((_, j) => j !== i))}
                  className="rounded border border-hairline px-2 py-1 text-[12px] text-muted hover:border-down"
                >
                  {labels.dropWindow}
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setWindows((ws) => [...ws, emptyWindow()])}
          className="mt-2 rounded border border-hairline px-2 py-1 text-[12px] hover:border-accent"
        >
          {labels.addWindow}
        </button>
      </fieldset>

      <div className="flex flex-wrap items-end gap-4">
        <fieldset>
          <legend className={label}>{labels.paymentMethods}</legend>
          <div className="flex flex-wrap gap-3 text-sm">
            {PAYMENT_METHODS.map((m) => (
              <label key={m} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={paymentMethods.includes(m)}
                  onChange={() =>
                    setPaymentMethods((ms) =>
                      ms.includes(m) ? ms.filter((x) => x !== m) : [...ms, m],
                    )
                  }
                />
                {m}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block grow text-sm">
          <span className={label}>{labels.holidayNote}</span>
          <input
            value={holidayNote}
            onChange={(e) => setHolidayNote(e.target.value)}
            aria-label={labels.holidayNote}
            className={`${field} w-full`}
          />
        </label>
      </div>

      <button
        type="submit"
        disabled={pending || name.trim().length < 2}
        data-testid="save-template"
        className="rounded border border-accent px-3 py-1.5 text-[13px] text-accent hover:bg-accent/10 disabled:opacity-50"
      >
        {labels.save}
      </button>

      {error && (
        <p className="text-[13px] text-down" data-testid="template-error">
          {error}
        </p>
      )}
    </form>
  );
}
