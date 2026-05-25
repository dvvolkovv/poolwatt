"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { ProducerRow as ProducerRowT, RenewableSource } from "@/lib/producers";
import type { Currency, ExchangeRates } from "@/lib/currency";
import { ProducerRow } from "./producer-row";
import { ProducerCardMobile } from "./producer-card-mobile";

const SOURCE_FILTERS: { key: RenewableSource | "ALL"; icon: string }[] = [
  { key: "ALL", icon: "⚡" },
  { key: "SOLAR", icon: "☀️" },
  { key: "WIND", icon: "💨" },
  { key: "HYDRO", icon: "💧" },
  { key: "BIOMASS", icon: "🌿" },
  { key: "GEOTHERMAL", icon: "🌋" },
  { key: "HYBRID", icon: "🔄" },
];

type SortKey = "rank" | "price" | "pctChange24h" | "available" | "delivered24h" | "soc";
type SortDir = "asc" | "desc";

const SORT_FIELDS: Record<SortKey, (r: ProducerRowT) => number> = {
  rank: (r) => r.rank,
  price: (r) => r.pricePerKwhUsd,
  pctChange24h: (r) => r.pctChange24h ?? 0,
  available: (r) => r.availableKwh,
  delivered24h: (r) => r.delivered24hKwh,
  soc: (r) => r.stateOfChargePct,
};

function SortHeader({
  label,
  field,
  currentKey,
  currentDir,
  onSort,
  align = "right",
}: {
  label: string;
  field: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const isActive = currentKey === field;
  const arrow = isActive ? (currentDir === "asc" ? " ▲" : " ▼") : "";
  const alignCls = align === "right" ? "text-right" : "text-left";
  return (
    <th
      className={`${alignCls} font-medium px-5 py-4 cursor-pointer select-none hover:text-foreground transition-colors`}
      onClick={() => onSort(field)}
    >
      {label}
      <span className="num text-[10px]">{arrow}</span>
    </th>
  );
}

export function ProducerListClient({
  rows,
  currency,
  rates,
  locale,
}: {
  rows: ProducerRowT[];
  currency: Currency;
  rates: ExchangeRates | null;
  locale: string;
}) {
  const t = useTranslations("listing");
  const tSource = useTranslations("source");
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<RenewableSource | "ALL">("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "rank" || key === "price" ? "asc" : "desc");
    }
  };

  const filtered = useMemo(() => {
    let base = sourceFilter === "ALL"
      ? rows
      : rows.filter((r) => r.primarySource === sourceFilter);
    const q = query.trim().toLowerCase();
    if (q) {
      base = base.filter(
        (r) =>
          r.handle.toLowerCase().includes(q) ||
          r.displayName.toLowerCase().includes(q) ||
          r.city.toLowerCase().includes(q),
      );
    }
    const fn = SORT_FIELDS[sortKey];
    const sorted = [...base].sort((a, b) => fn(a) - fn(b));
    if (sortDir === "desc") sorted.reverse();
    return sorted;
  }, [rows, query, sourceFilter, sortKey, sortDir]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <input
          type="text"
          placeholder={t("search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="bg-card border border-hairline rounded-md px-3 py-2 text-sm placeholder:text-muted focus:ring-1 focus:ring-accent outline-none w-full max-w-sm"
        />
        <div className="flex flex-wrap gap-1.5">
          {SOURCE_FILTERS.map(({ key, icon }) => (
            <button
              key={key}
              onClick={() => setSourceFilter(key)}
              className={`px-3 py-1.5 text-[12px] rounded-full border transition-colors ${
                sourceFilter === key
                  ? "bg-accent/15 border-accent/40 text-accent font-medium"
                  : "bg-card border-hairline text-muted hover:text-foreground hover:border-foreground/20"
              }`}
            >
              <span className="mr-1">{icon}</span>
              {key === "ALL" ? "All" : tSource(key)}
            </button>
          ))}
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-card border border-hairline rounded-[20px] overflow-hidden overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-[11px] uppercase tracking-[0.18em] text-muted border-b border-hairline">
              <SortHeader
                label={t("rank")}
                field="rank"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={toggleSort}
                align="left"
              />
              <th className="text-left font-medium px-5 py-4">{t("producer")}</th>
              <th className="text-left font-medium px-5 py-4">{t("source")}</th>
              <SortHeader
                label={t("stateOfCharge")}
                field="soc"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={toggleSort}
                align="left"
              />
              <SortHeader
                label={t("available")}
                field="available"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={toggleSort}
              />
              <SortHeader
                label={t("price")}
                field="price"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={toggleSort}
              />
              <SortHeader
                label={t("delivered24h")}
                field="delivered24h"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={toggleSort}
              />
              <SortHeader
                label={t("change24h")}
                field="pctChange24h"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={toggleSort}
              />
              <th className="text-left font-medium px-5 py-4">{t("weekly")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <ProducerRow
                key={row.id}
                row={row}
                currency={currency}
                rates={rates}
                locale={locale}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {filtered.map((row) => (
          <ProducerCardMobile
            key={row.id}
            row={row}
            currency={currency}
            rates={rates}
            locale={locale}
          />
        ))}
      </div>
    </div>
  );
}
