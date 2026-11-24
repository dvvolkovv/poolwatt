"use client";

// The seven steps of ТЗ §29.1 — тип → адрес → оборудование → тарифы → оплата
// → подключение → публикация — with the §27 mini-card standing beside them as
// a live preview.
//
// Each step saves itself on the way out, so §29.2's "черновик сохраняется
// автоматически" is literal: there is nothing to lose by closing the tab. The
// list of what is still missing comes from the server, which is the same list
// the submit guard uses.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  savePoint,
  submitPoint,
} from "@/app/[locale]/me/charger-operator/[id]/points/actions";
import { PointMiniCard, type MiniCardLabels, type MiniPoint } from "./point-mini-card";

const STEPS = [
  "type",
  "address",
  "equipment",
  "tariffs",
  "payment",
  "connection",
  "publish",
] as const;
type Step = (typeof STEPS)[number];

const CONNECTOR_TYPES = ["CCS2", "CHAdeMO", "TYPE2", "TYPE1", "TESLA", "GB_T", "SCHUKO"] as const;
const SOURCES = ["SOLAR", "WIND", "BIOGAS", "HYDRO", "GRID", "MIXED"] as const;
const PAYMENTS = ["TOKEN", "POOLWATT_CARD", "WHITE_LABEL_CARD", "BANK_CARD", "QR"] as const;
const AMENITIES = ["PARKING", "CAFE", "TOILET", "WIFI", "ACCESSIBLE", "COVERED"] as const;
const VISIBILITY = ["PUBLIC", "COOP_MEMBERS", "OWN_CLIENTS"] as const;

export type WizardState = {
  id: string;
  status: string;
  type: string;
  name: string;
  country: string;
  city: string;
  addressLine: string;
  latitude: string;
  longitude: string;
  gridZoneId: string;
  howToFind: string;
  energySource: string;
  storageKwh: string;
  connectors: { type: string; powerKw: string; currentAc: boolean; quantity: string }[];
  tariffs: { fromMinute: string; toMinute: string; priceFiat: string; currency: string; priceTokens: string; idleFeePerMin: string; coopDiscount: string }[];
  paymentMethods: string[];
  amenities: string[];
  visibility: string;
  ocppVersion: string;
  meterId: string;
  open24: boolean;
  holidayNote: string;
  description: string;
};

export type WizardLabels = Record<string, string> & { miniCard: MiniCardLabels };

export function PointWizard({
  initial,
  zones,
  missing,
  operatorName,
  locale,
  labels,
}: {
  initial: WizardState;
  zones: { id: string; code: string; name: string }[];
  missing: string[];
  operatorName: string;
  locale: string;
  labels: WizardLabels;
}) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [step, setStep] = useState<Step>("type");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof WizardState>(key: K, value: WizardState[K]) =>
    setState((s) => ({ ...s, [key]: value }));

  function payloadFor(current: Step): Record<string, unknown> {
    switch (current) {
      case "type":
        return { type: state.type, name: state.name };
      case "address":
        return {
          country: state.country.toUpperCase(),
          city: state.city,
          addressLine: state.addressLine,
          latitude: num(state.latitude),
          longitude: num(state.longitude),
          gridZoneId: state.gridZoneId || null,
          howToFind: state.howToFind,
        };
      case "equipment":
        return {
          energySource: state.energySource || undefined,
          storageKwh: state.storageKwh === "" ? null : num(state.storageKwh),
          connectors: state.connectors
            .filter((c) => c.type && num(c.powerKw) > 0)
            .map((c) => ({
              type: c.type,
              powerKw: num(c.powerKw),
              currentAc: c.currentAc,
              quantity: Math.max(1, Math.trunc(num(c.quantity) || 1)),
            })),
        };
      case "tariffs":
        return {
          tariffs: state.tariffs.map((t) => ({
            fromMinute: Math.trunc(num(t.fromMinute) || 0),
            toMinute: Math.trunc(num(t.toMinute) || 1440),
            priceFiat: t.priceFiat === "" ? null : num(t.priceFiat),
            currency: t.currency || "EUR",
            priceTokens: t.priceTokens === "" ? null : num(t.priceTokens),
            idleFeePerMin: t.idleFeePerMin === "" ? null : num(t.idleFeePerMin),
            coopDiscount: Math.trunc(num(t.coopDiscount) || 0),
          })),
        };
      case "payment":
        return {
          paymentMethods: state.paymentMethods,
          amenities: state.amenities,
          visibility: state.visibility,
        };
      case "connection":
        return { ocppVersion: state.ocppVersion || null, meterId: state.meterId || null };
      case "publish":
        return { description: state.description || null };
    }
  }

  function save(current: Step, then?: () => void) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      // Opening hours live on the payment step's screen but are their own
      // step on the server, because §29.5 lets them change without review.
      const steps: { step: string; payload: Record<string, unknown> }[] = [
        { step: current, payload: payloadFor(current) },
      ];
      if (current === "payment") {
        steps.push({
          step: "hours",
          payload: { open24: state.open24, holidayNote: state.holidayNote || null },
        });
      }
      for (const s of steps) {
        const r = await savePoint({ pointId: state.id, step: s.step, payload: s.payload });
        if (!r.ok) {
          setError(r.formError);
          return;
        }
      }
      setSaved(true);
      router.refresh();
      then?.();
    });
  }

  const index = STEPS.indexOf(step);

  const preview: MiniPoint = {
    id: state.id,
    name: state.name,
    operatorName,
    type: state.type,
    city: state.city || null,
    country: state.country || null,
    addressLine: state.addressLine || null,
    latitude: num(state.latitude) || null,
    longitude: num(state.longitude) || null,
    energySource: state.energySource || null,
    open24: state.open24,
    priceFiat: state.tariffs[0]?.priceFiat ? num(state.tariffs[0].priceFiat) : null,
    currency: state.tariffs[0]?.currency || "EUR",
    priceTokens: state.tariffs[0]?.priceTokens ? num(state.tariffs[0].priceTokens) : null,
    connectors: state.connectors
      .filter((c) => c.type)
      .map((c) => ({
        type: c.type,
        powerKw: num(c.powerKw),
        quantity: Math.max(1, Math.trunc(num(c.quantity) || 1)),
        status: "UNKNOWN" as const,
      })),
  };

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
      <div>
        <ol className="mb-6 flex flex-wrap gap-1 text-[12px]" data-testid="wizard-steps">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => save(step, () => setStep(s))}
                className={`rounded border px-2 py-1 ${
                  s === step ? "border-accent text-accent" : "border-hairline text-muted"
                }`}
              >
                {i + 1}. {labels[`step.${s}`]}
              </button>
            </li>
          ))}
        </ol>

        <div className="space-y-4">
          {step === "type" && (
            <>
              <Field label={labels["field.name"]}>
                <input
                  value={state.name}
                  onChange={(e) => set("name", e.target.value)}
                  aria-label={labels["field.name"]}
                  className={input}
                />
              </Field>
              <Field label={labels["field.type"]}>
                <select
                  value={state.type}
                  onChange={(e) => set("type", e.target.value)}
                  aria-label={labels["field.type"]}
                  className={input}
                >
                  {["CHARGING_STATION", "POWERBANK", "GENERATION", "MIXED"].map((v) => (
                    <option key={v} value={v}>
                      {labels[`kind.${v}`]}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}

          {step === "address" && (
            <>
              <Field label={labels["field.country"]}>
                <input value={state.country} onChange={(e) => set("country", e.target.value)} aria-label={labels["field.country"]} className={input} maxLength={2} />
              </Field>
              <Field label={labels["field.city"]}>
                <input value={state.city} onChange={(e) => set("city", e.target.value)} aria-label={labels["field.city"]} className={input} />
              </Field>
              <Field label={labels["field.addressLine"]}>
                <input value={state.addressLine} onChange={(e) => set("addressLine", e.target.value)} aria-label={labels["field.addressLine"]} className={input} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={labels["field.latitude"]}>
                  <input value={state.latitude} onChange={(e) => set("latitude", e.target.value)} aria-label={labels["field.latitude"]} inputMode="decimal" className={`${input} num`} />
                </Field>
                <Field label={labels["field.longitude"]}>
                  <input value={state.longitude} onChange={(e) => set("longitude", e.target.value)} aria-label={labels["field.longitude"]} inputMode="decimal" className={`${input} num`} />
                </Field>
              </div>
              <Field label={labels["field.gridZone"]}>
                <select value={state.gridZoneId} onChange={(e) => set("gridZoneId", e.target.value)} aria-label={labels["field.gridZone"]} className={input}>
                  <option value="">—</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.code} · {z.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={labels["field.howToFind"]}>
                <textarea value={state.howToFind} onChange={(e) => set("howToFind", e.target.value)} aria-label={labels["field.howToFind"]} rows={3} className={input} />
              </Field>
            </>
          )}

          {step === "equipment" && (
            <>
              <Field label={labels["field.energySource"]}>
                <select value={state.energySource} onChange={(e) => set("energySource", e.target.value)} aria-label={labels["field.energySource"]} className={input}>
                  <option value="">—</option>
                  {SOURCES.map((v) => (
                    <option key={v} value={v}>
                      {labels[`source.${v}`]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={labels["field.storageKwh"]}>
                <input value={state.storageKwh} onChange={(e) => set("storageKwh", e.target.value)} aria-label={labels["field.storageKwh"]} inputMode="decimal" className={`${input} num`} />
              </Field>

              <div>
                <div className="mb-2 text-[11px] uppercase tracking-[0.14em] text-muted">
                  {labels["field.connectors"]}
                </div>
                {state.connectors.map((c, i) => (
                  <div key={i} className="mb-2 flex flex-wrap items-end gap-2">
                    <select
                      value={c.type}
                      aria-label={`${labels["field.connectorType"]} ${i + 1}`}
                      onChange={(e) => updateRow("connectors", i, { type: e.target.value })}
                      className={input}
                    >
                      {CONNECTOR_TYPES.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <input
                      value={c.powerKw}
                      aria-label={`${labels["field.powerKw"]} ${i + 1}`}
                      onChange={(e) => updateRow("connectors", i, { powerKw: e.target.value })}
                      inputMode="decimal"
                      className={`${input} num w-[90px]`}
                    />
                    <input
                      value={c.quantity}
                      aria-label={`${labels["field.quantity"]} ${i + 1}`}
                      onChange={(e) => updateRow("connectors", i, { quantity: e.target.value })}
                      inputMode="numeric"
                      className={`${input} num w-[70px]`}
                    />
                    <label className="flex items-center gap-1 text-[12px] text-muted">
                      <input
                        type="checkbox"
                        checked={c.currentAc}
                        onChange={(e) => updateRow("connectors", i, { currentAc: e.target.checked })}
                      />
                      AC
                    </label>
                    <button type="button" onClick={() => removeRow("connectors", i)} className={ghost}>
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setState((s) => ({
                      ...s,
                      connectors: [
                        ...s.connectors,
                        { type: "TYPE2", powerKw: "22", currentAc: true, quantity: "1" },
                      ],
                    }))
                  }
                  className={ghost}
                >
                  + {labels["field.addConnector"]}
                </button>
              </div>
            </>
          )}

          {step === "tariffs" && (
            <div>
              {state.tariffs.map((t, i) => (
                <div key={i} className="mb-2 flex flex-wrap items-end gap-2">
                  <Small label={labels["field.fromMinute"]}>
                    <input value={t.fromMinute} aria-label={`${labels["field.fromMinute"]} ${i + 1}`} onChange={(e) => updateRow("tariffs", i, { fromMinute: e.target.value })} inputMode="numeric" className={`${input} num w-[70px]`} />
                  </Small>
                  <Small label={labels["field.toMinute"]}>
                    <input value={t.toMinute} aria-label={`${labels["field.toMinute"]} ${i + 1}`} onChange={(e) => updateRow("tariffs", i, { toMinute: e.target.value })} inputMode="numeric" className={`${input} num w-[70px]`} />
                  </Small>
                  <Small label={labels["field.priceFiat"]}>
                    <input value={t.priceFiat} aria-label={`${labels["field.priceFiat"]} ${i + 1}`} onChange={(e) => updateRow("tariffs", i, { priceFiat: e.target.value })} inputMode="decimal" className={`${input} num w-[90px]`} />
                  </Small>
                  <Small label={labels["field.priceTokens"]}>
                    <input value={t.priceTokens} aria-label={`${labels["field.priceTokens"]} ${i + 1}`} onChange={(e) => updateRow("tariffs", i, { priceTokens: e.target.value })} inputMode="decimal" className={`${input} num w-[90px]`} />
                  </Small>
                  <Small label={labels["field.idleFee"]}>
                    <input value={t.idleFeePerMin} aria-label={`${labels["field.idleFee"]} ${i + 1}`} onChange={(e) => updateRow("tariffs", i, { idleFeePerMin: e.target.value })} inputMode="decimal" className={`${input} num w-[90px]`} />
                  </Small>
                  <Small label={labels["field.coopDiscount"]}>
                    <input value={t.coopDiscount} aria-label={`${labels["field.coopDiscount"]} ${i + 1}`} onChange={(e) => updateRow("tariffs", i, { coopDiscount: e.target.value })} inputMode="numeric" className={`${input} num w-[70px]`} />
                  </Small>
                  <button type="button" onClick={() => removeRow("tariffs", i)} className={ghost}>
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setState((s) => ({
                    ...s,
                    tariffs: [
                      ...s.tariffs,
                      { fromMinute: "0", toMinute: "1440", priceFiat: "", currency: "EUR", priceTokens: "", idleFeePerMin: "", coopDiscount: "0" },
                    ],
                  }))
                }
                className={ghost}
              >
                + {labels["field.addTariff"]}
              </button>
            </div>
          )}

          {step === "payment" && (
            <>
              <CheckGroup
                legend={labels["field.paymentMethods"]}
                options={PAYMENTS}
                selected={state.paymentMethods}
                onToggle={(v) => toggle("paymentMethods", v)}
                label={(v) => labels[`payment.${v}`]}
              />
              <CheckGroup
                legend={labels["field.amenities"]}
                options={AMENITIES}
                selected={state.amenities}
                onToggle={(v) => toggle("amenities", v)}
                label={(v) => labels[`amenity.${v}`]}
              />
              <Field label={labels["field.visibility"]}>
                <select value={state.visibility} onChange={(e) => set("visibility", e.target.value)} aria-label={labels["field.visibility"]} className={input}>
                  {VISIBILITY.map((v) => (
                    <option key={v} value={v}>
                      {labels[`visibility.${v}`]}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={state.open24} onChange={(e) => set("open24", e.target.checked)} />
                {labels["field.open24"]}
              </label>
              <Field label={labels["field.holidayNote"]}>
                <input value={state.holidayNote} onChange={(e) => set("holidayNote", e.target.value)} aria-label={labels["field.holidayNote"]} className={input} />
              </Field>
            </>
          )}

          {step === "connection" && (
            <>
              <Field label={labels["field.ocppVersion"]}>
                <select value={state.ocppVersion} onChange={(e) => set("ocppVersion", e.target.value)} aria-label={labels["field.ocppVersion"]} className={input}>
                  <option value="">—</option>
                  <option value="1.6">OCPP 1.6</option>
                  <option value="2.0.1">OCPP 2.0.1</option>
                </select>
              </Field>
              <Field label={labels["field.meterId"]}>
                <input value={state.meterId} onChange={(e) => set("meterId", e.target.value)} aria-label={labels["field.meterId"]} className={input} />
              </Field>
              <p className="text-[12px] text-muted">{labels["connectionHelp"]}</p>
            </>
          )}

          {step === "publish" && (
            <>
              <Field label={labels["field.description"]}>
                <textarea value={state.description} onChange={(e) => set("description", e.target.value)} aria-label={labels["field.description"]} rows={4} className={input} />
              </Field>

              <div className="rounded border border-hairline p-3" data-testid="missing-fields">
                <div className="text-[11px] uppercase tracking-[0.14em] text-muted">
                  {labels["missing"]}
                </div>
                {missing.length === 0 ? (
                  <p className="mt-1 text-[13px] text-up">{labels["missingNone"]}</p>
                ) : (
                  <ul className="mt-1 text-[13px] text-down">
                    {missing.map((m) => (
                      <li key={m}>· {labels[`required.${m}`] ?? m}</li>
                    ))}
                  </ul>
                )}
              </div>

              <button
                type="button"
                data-testid="submit-point"
                disabled={pending || missing.length > 0 || state.status === "REVIEW"}
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    const r = await submitPoint(state.id);
                    if (!r.ok) setError(r.formError);
                    else {
                      setState((s) => ({ ...s, status: "REVIEW" }));
                      router.refresh();
                    }
                  });
                }}
                className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
              >
                {state.status === "REVIEW" ? labels["submitted"] : labels["submit"]}
              </button>
            </>
          )}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            disabled={pending || index === 0}
            onClick={() => save(step, () => setStep(STEPS[index - 1]))}
            className={ghost}
          >
            ← {labels["back"]}
          </button>
          <button
            type="button"
            data-testid="wizard-next"
            disabled={pending || index === STEPS.length - 1}
            onClick={() => save(step, () => setStep(STEPS[index + 1]))}
            className="rounded border border-hairline px-3 py-1.5 text-[13px] hover:border-accent disabled:opacity-50"
          >
            {labels["next"]} →
          </button>
          <button type="button" disabled={pending} onClick={() => save(step)} className={ghost}>
            {labels["save"]}
          </button>
          {saved && <span className="text-[12px] text-accent">{labels["saved"]}</span>}
          {error && <span className="text-[12px] text-down">{error}</span>}
        </div>
      </div>

      <aside>
        <div className="mb-2 text-[11px] uppercase tracking-[0.14em] text-muted">
          {labels["preview"]}
        </div>
        <PointMiniCard point={preview} locale={locale} labels={labels.miniCard} preview />
      </aside>
    </div>
  );

  function updateRow(
    key: "connectors" | "tariffs",
    index: number,
    patch: Record<string, unknown>,
  ) {
    setState((s) => ({
      ...s,
      [key]: s[key].map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  }

  function removeRow(key: "connectors" | "tariffs", index: number) {
    setState((s) => ({ ...s, [key]: s[key].filter((_, i) => i !== index) }));
  }

  function toggle(key: "paymentMethods" | "amenities", value: string) {
    setState((s) => ({
      ...s,
      [key]: s[key].includes(value) ? s[key].filter((v) => v !== value) : [...s[key], value],
    }));
  }
}

const input = "w-full rounded border border-hairline bg-bg px-3 py-1.5 text-sm";
const ghost = "rounded border border-hairline px-3 py-1.5 text-[13px] text-muted hover:text-foreground disabled:opacity-50";

function num(v: string): number {
  return Number(String(v).replace(",", ".")) || 0;
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

function Small({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

function CheckGroup({
  legend,
  options,
  selected,
  onToggle,
  label,
}: {
  legend: string;
  options: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
  label: (value: string) => string;
}) {
  return (
    <fieldset>
      <legend className="mb-1 text-[11px] uppercase tracking-[0.14em] text-muted">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-3">
        {options.map((v) => (
          <label key={v} className="flex items-center gap-1 text-[13px]">
            <input type="checkbox" checked={selected.includes(v)} onChange={() => onToggle(v)} />
            {label(v)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
