"use client";

// Шапка страницы зарядок: поиск, страна, «рядом со мной» и панель фильтров.
//
// До 2026-11-28 всё это жило в боковой колонке шириной 380 точек, которой на
// телефоне нет места. Теперь это строка над списком, и она одинаковая во всех
// трёх разделах — станции, операторы, карта.

import { useState } from "react";
import { Search, SlidersHorizontal, Crosshair, X } from "lucide-react";
import type { ConnectorType, PowerLevel } from "@/lib/chargers";
import { COUNTRY_CODES, countryName } from "@/lib/navigator/areas";

export type SortKey = "distance" | "default" | "priceAsc";

export type Filters = {
  connector: ConnectorType | "";
  power: PowerLevel | "";
  status: string;
  query: string;
  sort: SortKey;
  freeOnly: boolean;
  /** Страна, по которой сужен список. Пустая — все, что попали в область. */
  country: string;
  /** Оператор, выбранный в разделе «Операторы». */
  operator: string;
};

const CONNECTOR_OPTIONS: { value: ConnectorType; label: string }[] = [
  { value: "CCS2", label: "CCS2 (Combo)" },
  { value: "CHAdeMO", label: "CHAdeMO" },
  { value: "Type2", label: "Type 2" },
  { value: "Type1", label: "Type 1 (J1772)" },
  { value: "Tesla", label: "Tesla" },
  { value: "Schuko", label: "Schuko" },
];

const POWER_OPTIONS: { value: PowerLevel; label: string }[] = [
  { value: "ac_slow", label: "AC ≤ 7 kW" },
  { value: "ac_fast", label: "AC ≤ 22 kW" },
  { value: "dc_fast", label: "DC ≤ 100 kW" },
  { value: "dc_ultra", label: "DC 150+ kW" },
];

export function FilterBar({
  filters,
  onChange,
  labels,
  locale,
  locating,
  located,
  onLocate,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  labels: Record<string, string>;
  locale: string;
  locating: boolean;
  located: boolean;
  onLocate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

  const chosen =
    (filters.connector ? 1 : 0) +
    (filters.power ? 1 : 0) +
    (filters.status ? 1 : 0) +
    (filters.freeOnly ? 1 : 0) +
    (filters.operator ? 1 : 0);

  return (
    <div className="border-b border-hairline bg-bg">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-2 px-4 py-3">
        <label className="relative flex min-w-0 flex-1 items-center">
          <Search
            size={15}
            aria-hidden
            className="pointer-events-none absolute left-3 text-muted"
          />
          <input
            value={filters.query}
            onChange={(e) => set({ query: e.target.value })}
            placeholder={labels.searchPlaceholder}
            aria-label={labels.searchPlaceholder}
            data-testid="navigator-search"
            className="min-h-[44px] w-full min-w-0 rounded-full border border-hairline bg-card pl-9 pr-3 text-[14px] text-foreground placeholder:text-muted focus:border-accent/60 focus:outline-none"
          />
        </label>

        <button
          type="button"
          onClick={onLocate}
          disabled={locating}
          data-testid="navigator-locate"
          aria-pressed={located}
          title={labels.nearMe}
          className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-full border px-3 text-[12px] font-semibold uppercase tracking-[0.12em] transition-colors ${
            located
              ? "border-accent/60 text-accent"
              : "border-hairline text-muted-strong hover:text-foreground"
          }`}
        >
          <Crosshair size={15} className={locating ? "animate-spin" : ""} />
          <span className="hidden sm:inline">
            {locating ? labels.locating : labels.nearMe}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid="navigator-filters"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-hairline px-4 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-strong transition-colors hover:text-foreground"
        >
          <SlidersHorizontal size={15} />
          {labels.filters}
          {chosen > 0 && (
            <span className="num rounded-full bg-accent px-1.5 text-[10px] text-accent-foreground">
              {chosen}
            </span>
          )}
        </button>
      </div>

      {open && (
        <div
          data-testid="navigator-filter-panel"
          className="mx-auto max-w-[1200px] px-4 pb-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={labels.country}>
              <select
                value={filters.country}
                onChange={(e) => set({ country: e.target.value })}
                data-testid="filter-country"
                className={SELECT}
              >
                <option value="">{labels.all}</option>
                {COUNTRY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {countryName(code, locale)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={labels.connectorType}>
              <select
                value={filters.connector}
                onChange={(e) =>
                  set({ connector: e.target.value as ConnectorType | "" })
                }
                data-testid="filter-connector"
                className={SELECT}
              >
                <option value="">{labels.all}</option>
                {CONNECTOR_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={labels.powerLevel}>
              <select
                value={filters.power}
                onChange={(e) => set({ power: e.target.value as PowerLevel | "" })}
                data-testid="filter-power"
                className={SELECT}
              >
                <option value="">{labels.all}</option>
                {POWER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={labels.sortLabel}>
              <select
                value={filters.sort}
                onChange={(e) => set({ sort: e.target.value as SortKey })}
                data-testid="filter-sort"
                className={SELECT}
              >
                <option value="distance">{labels.sortDistance}</option>
                <option value="default">{labels.sortDefault}</option>
                <option value="priceAsc">{labels.sortPriceAsc}</option>
              </select>
            </Field>

            <Field label={labels.statusLabel}>
              <select
                value={filters.status}
                onChange={(e) => set({ status: e.target.value })}
                data-testid="filter-status"
                className={SELECT}
              >
                <option value="">{labels.all}</option>
                <option value="operational">{labels.status_operational}</option>
                <option value="planned">{labels.status_planned}</option>
                <option value="temporarily_unavailable">
                  {labels.status_temporarily_unavailable}
                </option>
              </select>
            </Field>

            <label className="flex min-h-[44px] items-center gap-3 text-[14px] text-foreground">
              <input
                id="free-now"
                type="checkbox"
                checked={filters.freeOnly}
                onChange={(e) => set({ freeOnly: e.target.checked })}
                className="h-4 w-4 accent-accent"
              />
              <span>
                {labels.freeNow}
                <span className="block text-[11px] text-muted">
                  {labels.freeNowHelp}
                </span>
              </span>
            </label>
          </div>

          {filters.operator && (
            <button
              type="button"
              onClick={() => set({ operator: "" })}
              data-testid="clear-operator"
              className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-full border border-accent/50 px-4 text-[13px] text-accent"
            >
              {filters.operator}
              <X size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const SELECT =
  "min-h-[44px] w-full rounded-lg border border-hairline bg-card px-3 text-[14px] text-foreground focus:border-accent/60 focus:outline-none";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-[0.16em] text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
