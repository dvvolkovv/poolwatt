"use client";

// Девять фильтров §27 листом снизу. Вокабуляры берутся из map-filters.ts —
// второго списка разъёмов и способов оплаты в коде не появляется.

import { useState } from "react";
import {
  CONNECTORS,
  EMPTY_FILTERS,
  PAYMENT_METHODS,
  POINT_TYPES,
  POWER_LEVELS,
  type MapFilters,
} from "@/lib/mobile/map-filters";

export type FilterLabels = {
  filters: string;
  apply: string;
  reset: string;
  type: string;
  connector: string;
  power: string;
  free: string;
  maxFiat: string;
  maxTokens: string;
  open24: string;
  pay: string;
  green: string;
  greenHint: string;
  any: string;
  pointType: Record<string, string>;
  payMethod: Record<string, string>;
  powerLevel: Record<string, string>;
};

const SELECT =
  "mt-1 w-full rounded-lg border border-hairline bg-card-alt px-3 py-2.5 text-[15px]";
const FIELD = "text-[12px] uppercase tracking-[0.16em] text-muted";

export function MapFilterSheet({
  initial,
  labels,
  onApply,
  onClose,
}: {
  initial: MapFilters;
  labels: FilterLabels;
  onApply: (next: MapFilters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<MapFilters>(initial);

  function set<K extends keyof MapFilters>(key: K, value: MapFilters[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function price(value: string): number | null {
    const n = Number(value);
    return value !== "" && Number.isFinite(n) && n > 0 ? n : null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/60"
      onClick={onClose}
      data-testid="filter-sheet"
    >
      <div
        className="max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border-t border-hairline bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 text-[12px] uppercase tracking-[0.16em] text-muted">
          {labels.filters}
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className={FIELD}>{labels.type}</span>
            <select
              className={SELECT}
              value={draft.type ?? ""}
              aria-label={labels.type}
              data-testid="filter-type"
              onChange={(e) => set("type", e.target.value || null)}
            >
              <option value="">{labels.any}</option>
              {POINT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {labels.pointType[t] ?? t}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className={FIELD}>{labels.connector}</span>
            <select
              className={SELECT}
              value={draft.connector ?? ""}
              aria-label={labels.connector}
              data-testid="filter-connector"
              onChange={(e) => set("connector", e.target.value || null)}
            >
              <option value="">{labels.any}</option>
              {CONNECTORS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className={FIELD}>{labels.power}</span>
            <select
              className={SELECT}
              value={draft.power ?? ""}
              aria-label={labels.power}
              data-testid="filter-power"
              onChange={(e) => set("power", e.target.value || null)}
            >
              <option value="">{labels.any}</option>
              {POWER_LEVELS.map((p) => (
                <option key={p} value={p}>
                  {labels.powerLevel[p] ?? p}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className={FIELD}>{labels.pay}</span>
            <select
              className={SELECT}
              value={draft.paymentMethod ?? ""}
              aria-label={labels.pay}
              data-testid="filter-pay"
              onChange={(e) => set("paymentMethod", e.target.value || null)}
            >
              <option value="">{labels.any}</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {labels.payMethod[m] ?? m}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className={FIELD}>{labels.maxFiat}</span>
            <input
              className={`${SELECT} num`}
              inputMode="decimal"
              aria-label={labels.maxFiat}
              data-testid="filter-max-fiat"
              value={draft.maxPriceFiat ?? ""}
              onChange={(e) => set("maxPriceFiat", price(e.target.value))}
            />
          </label>

          <label className="block">
            <span className={FIELD}>{labels.maxTokens}</span>
            <input
              className={`${SELECT} num`}
              inputMode="decimal"
              aria-label={labels.maxTokens}
              data-testid="filter-max-tokens"
              value={draft.maxPriceTokens ?? ""}
              onChange={(e) => set("maxPriceTokens", price(e.target.value))}
            />
          </label>

          <Switch
            label={labels.free}
            testId="filter-free"
            on={draft.freeOnly}
            onChange={(v) => set("freeOnly", v)}
          />
          <Switch
            label={labels.open24}
            testId="filter-open24"
            on={draft.open24}
            onChange={(v) => set("open24", v)}
          />
          <Switch
            label={labels.green}
            hint={labels.greenHint}
            testId="filter-green"
            on={draft.greenOnly}
            onChange={(v) => set("greenOnly", v)}
          />
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => onApply(draft)}
            data-testid="filters-apply"
            className="flex-1 rounded-full bg-accent py-3 text-[13px] font-semibold uppercase tracking-[0.18em] text-accent-foreground"
          >
            {labels.apply}
          </button>
          <button
            type="button"
            onClick={() => onApply(EMPTY_FILTERS)}
            data-testid="filters-reset"
            className="rounded-full border border-hairline px-5 py-3 text-[13px] uppercase tracking-[0.18em] text-muted"
          >
            {labels.reset}
          </button>
        </div>
      </div>
    </div>
  );
}

function Switch({
  label,
  hint,
  testId,
  on,
  onChange,
}: {
  label: string;
  hint?: string;
  testId: string;
  on: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div>
      <label className="flex items-center justify-between gap-3 py-1">
        <span className="text-[15px]">{label}</span>
        <input
          type="checkbox"
          checked={on}
          aria-label={label}
          data-testid={testId}
          onChange={(e) => onChange(e.target.checked)}
          className="h-5 w-5 accent-[var(--accent)]"
        />
      </label>
      {hint && <p className="text-[12px] leading-snug text-muted">{hint}</p>}
    </div>
  );
}
