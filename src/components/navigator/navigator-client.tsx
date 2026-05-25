"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChargerStation, ConnectorType, PowerLevel } from "@/lib/chargers";
import { ChargerMap } from "./charger-map";
import { Sidebar } from "./sidebar";
import { StationCard } from "./station-card";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

type Filters = {
  connector: ConnectorType | "";
  power: PowerLevel | "";
  status: string;
  query: string;
};

export function NavigatorClient({ labels }: { labels: Record<string, string> }) {
  const [stations, setStations] = useState<ChargerStation[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [filters, setFilters] = useState<Filters>({
    connector: "",
    power: "",
    status: "",
    query: "",
  });

  const fetchStations = useCallback(
    async (center: { lat: number; lng: number }, radius: number) => {
      if (radius > 500) return;
      setLoading(true);
      try {
        const params = new URLSearchParams({
          lat: center.lat.toFixed(5),
          lng: center.lng.toFixed(5),
          radius: Math.min(Math.round(radius), 50).toString(),
        });

        const res = await fetch(`/api/chargers?${params}`);
        if (res.ok) {
          const data: ChargerStation[] = await res.json();
          setStations(data);
        }
      } finally {
        setLoading(false);
      }
    },
    [],
  );

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
      {/* Sidebar */}
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

      {/* Sidebar toggle */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="absolute top-4 z-20 p-2 rounded-r-lg bg-card/90 backdrop-blur-sm border border-l-0 border-hairline text-muted hover:text-foreground transition-colors"
        style={{ left: sidebarOpen ? "380px" : "0px", transition: "left 0.3s" }}
      >
        {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
      </button>

      {/* Map */}
      <div className="flex-1 relative">
        <ChargerMap
          stations={filtered}
          selectedId={selectedId}
          onSelect={handleSelect}
          onBoundsChange={fetchStations}
        />

        {/* Station detail card */}
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
