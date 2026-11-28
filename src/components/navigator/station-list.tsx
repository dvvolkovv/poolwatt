"use client";

// Список станций во всю ширину. Строка — это кнопка: нажатие открывает
// карточку станции. До 2026-11-28 этот список жил в колонке 380 точек рядом
// с картой, и на телефоне занимал половину экрана, а карта уезжала за край.

import { Zap, MapPin, ChevronRight } from "lucide-react";
import type { ChargerStation } from "@/lib/chargers";
import { formatDistance } from "@/lib/navigator/areas";

export type ListStation = ChargerStation & { distanceKm?: number | null };

const STATUS_DOT: Record<string, string> = {
  operational: "bg-green",
  planned: "bg-info",
  temporarily_unavailable: "bg-accent",
};

export function StationList({
  stations,
  loading,
  selectedId,
  onSelect,
  labels,
}: {
  stations: ListStation[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (station: ListStation) => void;
  labels: Record<string, string>;
}) {
  // Пока ждём — полосы на месте будущих строк. Надпись «Загружаем станции…»
  // посреди пустого экрана читается как поломка, особенно когда холодный
  // ответ из OpenStreetMap идёт двадцать секунд.
  if (loading && stations.length === 0) {
    return (
      <ul data-testid="station-skeleton" className="divide-y divide-hairline">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <li key={i} className="flex items-center gap-3 px-4 py-4">
            <span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-card" />
            <span className="min-w-0 flex-1 space-y-2">
              <span className="block h-3 w-2/3 animate-pulse rounded bg-card" />
              <span className="block h-2.5 w-1/3 animate-pulse rounded bg-card" />
            </span>
          </li>
        ))}
      </ul>
    );
  }

  if (stations.length === 0) {
    return (
      <p
        data-testid="navigator-empty"
        className="px-4 py-10 text-center text-[14px] text-muted"
      >
        {labels.noStations}
      </p>
    );
  }

  return (
    <ul data-testid="station-list" className="divide-y divide-hairline">
      {stations.map((station) => {
        const free = station.connections.filter(
          (c) => c.availability === "FREE",
        ).length;
        return (
          <li key={station.id}>
            <button
              type="button"
              onClick={() => onSelect(station)}
              data-testid="station-row"
              aria-current={station.id === selectedId}
              className={`flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-card ${
                station.id === selectedId ? "bg-card" : ""
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      STATUS_DOT[station.status] ?? "bg-muted"
                    }`}
                  />
                  <span className="truncate text-[15px] font-semibold text-foreground">
                    {station.title}
                  </span>
                </span>

                <span className="mt-0.5 flex items-center gap-1 text-[12px] text-muted">
                  <MapPin size={11} className="shrink-0" />
                  <span className="truncate">
                    {[station.city, station.operator]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>

                <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                  <span className="num inline-flex items-center gap-1 text-accent">
                    <Zap size={11} />
                    {station.maxPowerKw} kW
                  </span>
                  {station.operatorPrice && (
                    <span className="num text-foreground">
                      {Number(station.operatorPrice.pricePerKwh).toFixed(2)}{" "}
                      {station.operatorPrice.currency}/kWh
                    </span>
                  )}
                  {station.poolwattPointId && (
                    <span
                      data-testid="row-free-count"
                      className={free > 0 ? "text-green" : "text-muted"}
                    >
                      {free > 0
                        ? `${free} ${labels.availability_FREE}`
                        : labels.availability_BUSY}
                    </span>
                  )}
                </span>
              </span>

              {station.distanceKm != null && (
                <span
                  data-testid="station-distance"
                  className="num shrink-0 text-[13px] text-muted-strong"
                >
                  {formatDistance(station.distanceKm)}
                </span>
              )}
              <ChevronRight size={16} className="shrink-0 text-muted" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
