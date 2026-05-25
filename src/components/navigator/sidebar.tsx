"use client";

import { useState } from "react";
import type { ChargerStation, ConnectorType, PowerLevel } from "@/lib/chargers";
import { powerLevelLabel } from "@/lib/chargers";
import { OPERATOR_INFO } from "@/lib/charger-operators";
import { Search, Filter, Zap, MapPin, ChevronDown, ChevronUp, Globe, Phone, Smartphone } from "lucide-react";

type Filters = {
  connector: ConnectorType | "";
  power: PowerLevel | "";
  status: string;
  query: string;
};

type Props = {
  stations: ChargerStation[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (station: ChargerStation) => void;
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  labels: Record<string, string>;
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

const OPERATORS = Object.entries(OPERATOR_INFO);

export function Sidebar({
  stations,
  loading,
  selectedId,
  onSelect,
  filters,
  onFiltersChange,
  labels,
}: Props) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [tab, setTab] = useState<"stations" | "operators">("stations");

  const set = (patch: Partial<Filters>) =>
    onFiltersChange({ ...filters, ...patch });

  return (
    <div className="flex flex-col h-full bg-bg border-r border-hairline">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-hairline">
        <h2 className="text-[16px] font-bold text-foreground flex items-center gap-2">
          <Zap size={18} className="text-accent" />
          {labels.title ?? "EV Chargers"}
        </h2>
        <p className="text-[11px] text-muted mt-1">
          {loading
            ? labels.loading ?? "Loading stations…"
            : `${stations.length} ${labels.stationsFound ?? "stations found"}`}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-hairline">
        <button
          onClick={() => setTab("stations")}
          className={`flex-1 py-2 text-[11px] uppercase tracking-wider font-medium transition-colors ${
            tab === "stations" ? "text-accent border-b-2 border-accent" : "text-muted hover:text-foreground"
          }`}
        >
          Stations
        </button>
        <button
          onClick={() => setTab("operators")}
          className={`flex-1 py-2 text-[11px] uppercase tracking-wider font-medium transition-colors ${
            tab === "operators" ? "text-accent border-b-2 border-accent" : "text-muted hover:text-foreground"
          }`}
        >
          Operators ({OPERATORS.length})
        </button>
      </div>

      {tab === "operators" && (
        <div className="flex-1 overflow-y-auto">
          {OPERATORS.map(([name, info]) => (
            <div key={name} className="px-4 py-3 border-b border-hairline hover:bg-card/60 transition-colors">
              <div className="text-[13px] font-medium text-foreground">{name}</div>
              <div className="mt-1.5 space-y-1">
                <a href={info.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-[11px] text-accent hover:underline">
                  <Globe size={10} /> {info.website.replace("https://", "").split("/")[0]}
                </a>
                <a href={`tel:${info.phone}`} className="flex items-center gap-1.5 text-[11px] text-muted hover:text-foreground">
                  <Phone size={10} /> {info.phone}
                </a>
                {info.app && (
                  <div className="flex items-center gap-1.5 text-[11px] text-muted">
                    <Smartphone size={10} />
                    <span>{info.app}</span>
                    {info.appStoreUrl && <a href={info.appStoreUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">iOS</a>}
                    {info.playStoreUrl && <a href={info.playStoreUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Android</a>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "stations" && <>
      {/* Search */}
      <div className="px-4 py-2 border-b border-hairline">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={filters.query}
            onChange={(e) => set({ query: e.target.value })}
            placeholder={labels.searchPlaceholder ?? "Search by name, city…"}
            className="w-full pl-9 pr-3 py-2 text-[13px] rounded-md bg-card border border-hairline text-foreground placeholder:text-muted/60 focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      {/* Filter toggle */}
      <button
        onClick={() => setFiltersOpen(!filtersOpen)}
        className="px-4 py-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-muted hover:text-foreground border-b border-hairline transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Filter size={12} />
          {labels.filters ?? "Filters"}
        </span>
        {filtersOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {/* Filter panel */}
      {filtersOpen && (
        <div className="px-4 py-3 border-b border-hairline space-y-3">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted mb-1">
              {labels.connectorType ?? "Connector"}
            </label>
            <select
              value={filters.connector}
              onChange={(e) => set({ connector: e.target.value as ConnectorType | "" })}
              className="w-full px-2 py-1.5 text-[12px] rounded-md bg-card border border-hairline text-foreground"
            >
              <option value="">{labels.all ?? "All"}</option>
              {CONNECTOR_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted mb-1">
              {labels.powerLevel ?? "Power"}
            </label>
            <select
              value={filters.power}
              onChange={(e) => set({ power: e.target.value as PowerLevel | "" })}
              className="w-full px-2 py-1.5 text-[12px] rounded-md bg-card border border-hairline text-foreground"
            >
              <option value="">{labels.all ?? "All"}</option>
              {POWER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-muted mb-1">
              {labels.statusLabel ?? "Status"}
            </label>
            <select
              value={filters.status}
              onChange={(e) => set({ status: e.target.value })}
              className="w-full px-2 py-1.5 text-[12px] rounded-md bg-card border border-hairline text-foreground"
            >
              <option value="">{labels.all ?? "All"}</option>
              <option value="operational">{labels.status_operational ?? "Operational"}</option>
              <option value="planned">{labels.status_planned ?? "Planned"}</option>
              <option value="temporarily_unavailable">{labels.status_temporarily_unavailable ?? "Temp. Unavailable"}</option>
            </select>
          </div>
        </div>
      )}

      {/* Station list */}
      <div className="flex-1 overflow-y-auto">
        {stations.length === 0 && !loading && (
          <div className="px-4 py-8 text-center text-[13px] text-muted">
            {labels.noStations ?? "No stations in this area. Pan the map to search."}
          </div>
        )}
        {stations.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s)}
            className={`w-full text-left px-4 py-3 border-b border-hairline transition-colors ${
              s.id === selectedId
                ? "bg-card-alt"
                : "hover:bg-card/60"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-foreground truncate">
                  {s.title}
                </p>
                <p className="text-[11px] text-muted truncate">{s.operator}</p>
              </div>
              <div className="shrink-0 flex items-center gap-1.5">
                {s.renewable && <span className="text-[10px]" title="Renewable energy">🍃</span>}
                <span className="num text-[12px] font-semibold text-accent flex items-center gap-0.5">
                  <Zap size={11} />
                  {s.maxPowerKw} kW
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <MapPin size={10} className="text-muted shrink-0" />
              <span className="text-[11px] text-muted truncate">
                {s.city}{s.country ? `, ${s.country}` : ""}
              </span>
              <div className="ml-auto flex items-center gap-1">
                {s.connections.slice(0, 3).map((c, i) => (
                  <span
                    key={i}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-card-alt text-muted font-medium"
                  >
                    {c.connectorType}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] text-muted num">
                {s.totalPoints} {labels.pts ?? "pts"}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{
                color: s.status === "operational" ? "#10b981" : s.status === "planned" ? "#38bdf8" : "#f5b400",
                background: s.status === "operational" ? "rgba(16,185,129,0.15)" : s.status === "planned" ? "rgba(56,189,248,0.15)" : "rgba(245,180,0,0.15)",
              }}>
                {labels[`status_${s.status}`] ?? s.status}
              </span>
              {powerLevelLabel(s.powerLevel) && (
                <span className="text-[10px] text-blue">{powerLevelLabel(s.powerLevel)}</span>
              )}
            </div>
          </button>
        ))}
      </div>
      </>}
    </div>
  );
}
