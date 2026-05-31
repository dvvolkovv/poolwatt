"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChargerStation, ConnectorType, PowerLevel } from "@/lib/chargers";
import { ChargerMap, type Viewport } from "./charger-map";
import { Sidebar } from "./sidebar";
import { StationCard } from "./station-card";
import { PanelLeftClose, PanelLeftOpen, AlertTriangle, RotateCw, X } from "lucide-react";

type Filters = {
  connector: ConnectorType | "";
  power: PowerLevel | "";
  status: string;
  query: string;
};

type SourceTag = "live" | "cache" | "stale" | "mock" | null;

const FETCH_DEBOUNCE_MS = 600;

export function NavigatorClient({ labels }: { labels: Record<string, string> }) {
  const [stations, setStations] = useState<ChargerStation[]>([]);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<SourceTag>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [filters, setFilters] = useState<Filters>({
    connector: "",
    power: "",
    status: "",
    query: "",
  });

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<AbortController | null>(null);
  const lastViewport = useRef<Viewport | null>(null);

  const runFetch = useCallback(async (vp: Viewport) => {
    inflight.current?.abort();
    const ac = new AbortController();
    inflight.current = ac;

    setLoading(true);
    setErrorMsg(null);
    try {
      const params = new URLSearchParams({
        south: vp.south.toFixed(5),
        west: vp.west.toFixed(5),
        north: vp.north.toFixed(5),
        east: vp.east.toFixed(5),
      });
      const res = await fetch(`/api/chargers?${params}`, { signal: ac.signal });
      if (!res.ok) {
        setErrorMsg(labels.errorLoad ?? "Could not load stations");
        setStations([]);
        setSource(null);
        return;
      }
      const data = (await res.json()) as ChargerStation[];
      const tag = (res.headers.get("X-Source") as SourceTag) ?? "live";
      setStations(data);
      setSource(tag);
      if (tag === "stale" || tag === "mock") {
        setErrorMsg(res.headers.get("X-Error") ?? null);
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setErrorMsg(labels.errorLoad ?? "Could not load stations");
    } finally {
      if (inflight.current === ac) {
        inflight.current = null;
        setLoading(false);
      }
    }
  }, [labels.errorLoad]);

  const scheduleFetch = useCallback(
    (vp: Viewport) => {
      lastViewport.current = vp;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        runFetch(vp);
      }, FETCH_DEBOUNCE_MS);
    },
    [runFetch],
  );

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      inflight.current?.abort();
    };
  }, []);

  const handleRetry = useCallback(() => {
    if (lastViewport.current) runFetch(lastViewport.current);
  }, [runFetch]);

  const filtered = useMemo(() => {
    let result = stations;
    if (filters.connector) {
      result = result.filter((s) =>
        s.connections.some((c) => c.connectorType === filters.connector),
      );
    }
    if (filters.power) {
      result = result.filter((s) => s.powerLevel === filters.power);
    }
    if (filters.status) {
      result = result.filter((s) => s.status === filters.status);
    }
    if (filters.query) {
      const q = filters.query.toLowerCase();
      result = result.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.city.toLowerCase().includes(q) ||
          s.operator.toLowerCase().includes(q) ||
          s.address.toLowerCase().includes(q),
      );
    }
    return result;
  }, [stations, filters]);

  const selected = useMemo(
    () => filtered.find((s) => s.id === selectedId) ?? null,
    [filtered, selectedId],
  );

  const handleSelect = useCallback((s: ChargerStation) => {
    setSelectedId(s.id);
  }, []);

  return (
    <div className="fixed inset-0 top-16 flex">
      <div
        className={`${
          sidebarOpen ? "w-[380px]" : "w-0"
        } transition-all duration-300 overflow-hidden shrink-0 relative z-10`}
      >
        <Sidebar
          stations={filtered}
          loading={loading}
          selectedId={selectedId}
          onSelect={handleSelect}
          filters={filters}
          onFiltersChange={setFilters}
          labels={labels}
        />
      </div>

      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="absolute top-4 z-20 p-2 rounded-r-lg bg-card/90 backdrop-blur-sm border border-l-0 border-hairline text-muted hover:text-foreground transition-colors"
        style={{ left: sidebarOpen ? "380px" : "0px", transition: "left 0.3s" }}
      >
        {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
      </button>

      <div className="flex-1 relative">
        <ChargerMap
          stations={filtered}
          selectedId={selectedId}
          onSelect={handleSelect}
          onViewportChange={scheduleFetch}
        />

        <DataSourceBanner
          source={source}
          loading={loading}
          errorMsg={errorMsg}
          labels={labels}
          onRetry={handleRetry}
          onDismiss={() => setErrorMsg(null)}
        />

        {selected && (
          <div className="absolute top-4 right-4 w-[360px] max-h-[calc(100vh-6rem)] overflow-y-auto z-10">
            <StationCard
              station={selected}
              onClose={() => setSelectedId(null)}
              labels={labels}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function DataSourceBanner({
  source,
  loading,
  errorMsg,
  labels,
  onRetry,
  onDismiss,
}: {
  source: SourceTag;
  loading: boolean;
  errorMsg: string | null;
  labels: Record<string, string>;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  // Banner shows only when there is something useful to surface:
  // a degraded data source or an error. Live + no-error = silent.
  const degraded = source === "stale" || source === "mock";
  const hardError = !source && errorMsg;
  if (!degraded && !hardError) return null;

  const message = hardError
    ? labels.errorLoad
    : source === "stale"
      ? labels.sourceStale
      : labels.sourceMock;

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 max-w-[520px] w-[calc(100vw-2rem)]">
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-card/95 backdrop-blur-sm border border-amber-500/40 shadow-lg">
        <AlertTriangle size={16} className="text-amber-500 shrink-0" />
        <span className="text-[13px] text-foreground flex-1 leading-snug">{message}</span>
        <button
          onClick={onRetry}
          disabled={loading}
          className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider rounded-md border border-hairline text-foreground hover:bg-card-alt disabled:opacity-50 transition-colors"
        >
          <RotateCw size={11} className={loading ? "animate-spin" : ""} />
          {labels.retry}
        </button>
        <button
          onClick={onDismiss}
          className="p-1 text-muted hover:text-foreground transition-colors"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
