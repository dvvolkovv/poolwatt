"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { ProducerRow as ProducerRowT } from "@/lib/producers";
import type { Currency, ExchangeRates } from "@/lib/currency";
import { ProducerRow } from "./producer-row";
import { ProducerCardMobile } from "./producer-card-mobile";

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
  const [query, setQuery] = useState("");
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
    const q = query.trim().toLowerCase();
    const base = q
      ? rows.filter(
          (r) =>
            r.handle.toLowerCase().includes(q) ||
            r.displayName.toLowerCase().includes(q) ||
            r.city.toLowerCase().includes(q),
        )
      : rows;
    const fn = SORT_FIELDS[sortKey];
    const sorted = [...base].sort((a, b) => fn(a) - fn(b));
    if (sortDir === "desc") sorted.reverse();
    return sorted;
  }, [rows, query, sortKey, sortDir]);

  return (
    <div className="space-y-6">
      <input
        type="text"
        placeholder={t("search")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="bg-card border border-hairline rounded-md px-3 py-2 text-sm placeholder:text-muted focus:ring-1 focus:ring-accent outline-none w-full max-w-sm"
      />

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
