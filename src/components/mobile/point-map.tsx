"use client";

// §27 — карта пунктов приёма под телефон: кластеризация на мелком масштабе,
// геолокация, значок по типу и доступности, мини-карточка по тапу.
//
// Кластеризация родная для GeoJSON-источника maplibre: отрисовщик умеет это
// сам, и ставить рядом вторую библиотеку не за что. Стиль — тот же Carto
// dark-matter, что в навигаторе на монитор, чтобы два экрана выглядели
// одной системой.
//
// Фильтры применяет сервер, а не этот экран: в один прямоугольник влезает до
// трёхсот пунктов, и качать их все, чтобы выбросить двести девяносто, — не
// то, что делают на мобильной сети.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ChargerStation } from "@/lib/chargers";
import {
  activeCount,
  toQuery,
  type MapFilters,
} from "@/lib/mobile/map-filters";
import type { RouteLabels } from "@/components/route-sheet";
import { MapFilterSheet, type FilterLabels } from "./map-filter-sheet";
import { PointMiniCard, rollUpAvailability, type MiniLabels } from "./point-mini-card";

const STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/** Первая торговая зона из предложения владельцу — Словакия. */
const FALLBACK_CENTER: [number, number] = [17.1077, 48.1486];
const FALLBACK_ZOOM = 10;

const FETCH_DEBOUNCE_MS = 600;

const GLYPH: Record<string, string> = {
  CHARGING_STATION: "⚡",
  POWERBANK: "▮",
  GENERATION: "☀",
  MIXED: "◆",
};

export type MapLabels = FilterLabels &
  MiniLabels & {
    oursOnly: string;
    locate: string;
    locateDenied: string;
    empty: string;
    loading: string;
    found: string;
  };

type Props = {
  locale: string;
  initialFilters: MapFilters;
  initialStation: ChargerStation | null;
  initialView: { lat: number; lng: number; zoom: number } | null;
  labels: MapLabels;
  routeLabels: RouteLabels;
};

function toFeatures(stations: ChargerStation[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: stations.map((s) => ({
      type: "Feature",
      id: undefined,
      geometry: { type: "Point", coordinates: [s.lng, s.lat] },
      properties: {
        stationId: s.id,
        availability: s.poolwattPointId ? rollUpAvailability(s) : "FOREIGN",
        glyph: s.pointType ? (GLYPH[s.pointType] ?? "◆") : "·",
      },
    })),
  };
}

export function PointMap({
  locale,
  initialFilters,
  initialStation,
  initialView,
  labels,
  routeLabels,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const styleReady = useRef(false);

  const [stations, setStations] = useState<ChargerStation[]>(
    initialStation ? [initialStation] : [],
  );
  const [selected, setSelected] = useState<ChargerStation | null>(initialStation);
  const [filters, setFilters] = useState<MapFilters>(initialFilters);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [onlyOurs, setOnlyOurs] = useState(false);
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);

  const stationsRef = useRef(stations);
  stationsRef.current = stations;
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const hereRef = useRef(here);
  hereRef.current = here;

  const inflight = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runFetch = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = map.getBounds();
    if (!bounds) return;
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    inflight.current?.abort();
    const ac = new AbortController();
    inflight.current = ac;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        south: sw.lat.toFixed(5),
        west: sw.lng.toFixed(5),
        north: ne.lat.toFixed(5),
        east: ne.lng.toFixed(5),
      });
      const pos = hereRef.current;
      if (pos) {
        params.set("atLat", pos.lat.toFixed(5));
        params.set("atLng", pos.lng.toFixed(5));
      }
      const query = toQuery(filtersRef.current);
      const res = await fetch(`/api/chargers?${params}${query ? `&${query}` : ""}`, {
        signal: ac.signal,
      });
      if (!res.ok) return;
      const rows = (await res.json()) as ChargerStation[];
      setOnlyOurs(res.headers.get("X-Ours-Only") === "1");
      setStations(rows);
      // Выбранный пункт мог выпасть из выдачи — тогда мини-карточка закрывается.
      setSelected((cur) => (cur ? (rows.find((r) => r.id === cur.id) ?? null) : null));
    } catch (e) {
      // Отказ сети не ломает экран: зарядка начинается по QR, а не отсюда.
      if ((e as Error).name !== "AbortError") console.error("[map] fetch failed", e);
    } finally {
      if (inflight.current === ac) {
        inflight.current = null;
        setLoading(false);
      }
    }
  }, []);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(runFetch, FETCH_DEBOUNCE_MS);
  }, [runFetch]);

  // Карта поднимается один раз: пересоздавать её на каждый фильтр значит
  // терять положение, которое водитель только что нашёл.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const start: [number, number] = initialView
      ? [initialView.lng, initialView.lat]
      : initialStation
        ? [initialStation.lng, initialStation.lat]
        : FALLBACK_CENTER;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE,
      center: start,
      zoom: initialView?.zoom ?? (initialStation ? 14 : FALLBACK_ZOOM),
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("points", {
        type: "geojson",
        data: toFeatures(stationsRef.current),
        cluster: true,
        clusterRadius: 50,
        clusterMaxZoom: 12,
      });

      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "points",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#2563eb",
          "circle-opacity": 0.85,
          "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 50, 26],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0b0f14",
        },
      });
      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "points",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 12,
        },
        paint: { "text-color": "#ffffff" },
      });
      map.addLayer({
        id: "pin",
        type: "circle",
        source: "points",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": 10,
          "circle-color": [
            "match",
            ["get", "availability"],
            "FREE",
            "#10b981",
            "BUSY",
            "#f5b400",
            "BOOKED",
            "#38bdf8",
            "OUT_OF_SERVICE",
            "#f87171",
            "FOREIGN",
            "#64748b",
            "#94a3b8",
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0b0f14",
        },
      });
      map.addLayer({
        id: "pin-glyph",
        type: "symbol",
        source: "points",
        filter: ["!", ["has", "point_count"]],
        layout: { "text-field": ["get", "glyph"], "text-size": 11 },
        paint: { "text-color": "#0b0f14" },
      });

      styleReady.current = true;
      runFetch();
    });

    map.on("click", "clusters", (e) => {
      const feature = map.queryRenderedFeatures(e.point, { layers: ["clusters"] })[0];
      const clusterId = feature?.properties?.cluster_id;
      if (clusterId == null) return;
      const source = map.getSource("points") as maplibregl.GeoJSONSource;
      source.getClusterExpansionZoom(clusterId).then((zoom) => {
        const geom = feature.geometry as GeoJSON.Point;
        map.easeTo({ center: geom.coordinates as [number, number], zoom });
      });
    });

    const pick = (e: maplibregl.MapMouseEvent) => {
      const feature = map.queryRenderedFeatures(e.point, {
        layers: ["pin", "pin-glyph"],
      })[0];
      const id = feature?.properties?.stationId as string | undefined;
      if (!id) return;
      setSelected(stationsRef.current.find((s) => s.id === id) ?? null);
    };
    map.on("click", "pin", pick);
    map.on("click", "pin-glyph", pick);

    map.on("moveend", schedule);

    return () => {
      if (timer.current) clearTimeout(timer.current);
      inflight.current?.abort();
      map.remove();
      mapRef.current = null;
      styleReady.current = false;
    };
    // Экран поднимает карту один раз; дальше ею управляют эффекты ниже.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Новая выдача — новые пины.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady.current) return;
    const source = map.getSource("points") as maplibregl.GeoJSONSource | undefined;
    source?.setData(toFeatures(stations));
  }, [stations]);

  // Фильтры в адресе: найденный вид — это ссылка.
  useEffect(() => {
    const query = toQuery(filters);
    const url = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState(null, "", url);
  }, [filters]);

  function applyFilters(next: MapFilters) {
    setFilters(next);
    setSheetOpen(false);
    filtersRef.current = next;
    runFetch();
  }

  function locate() {
    if (!navigator.geolocation) {
      setLocationDenied(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const at = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setHere(at);
        hereRef.current = at;
        setLocationDenied(false);
        mapRef.current?.easeTo({ center: [at.lng, at.lat], zoom: 13 });
      },
      () => setLocationDenied(true),
      { timeout: 8_000, maximumAge: 60_000 },
    );
  }

  const count = useMemo(() => activeCount(filters), [filters]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={containerRef} className="h-full w-full" data-testid="point-map" />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 p-3">
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            data-testid="map-filters"
            className="rounded-full border border-hairline bg-card/95 px-4 py-2 text-[13px] backdrop-blur-sm"
          >
            {labels.filters}
            {count > 0 && <span className="num ml-1.5 text-accent">{count}</span>}
          </button>
          <button
            type="button"
            onClick={locate}
            data-testid="locate"
            className="rounded-full border border-hairline bg-card/95 px-4 py-2 text-[13px] backdrop-blur-sm"
          >
            {labels.locate}
          </button>
          <span
            className="rounded-full bg-card/95 px-3 py-2 text-[12px] text-muted backdrop-blur-sm"
            data-testid="map-count"
          >
            {loading ? labels.loading : `${stations.length} ${labels.found}`}
          </span>
        </div>

        {onlyOurs && (
          <p
            className="pointer-events-auto mt-2 rounded-lg bg-card/95 px-3 py-2 text-[12px] leading-snug text-muted backdrop-blur-sm"
            data-testid="ours-only"
          >
            {labels.oursOnly}
          </p>
        )}
        {locationDenied && (
          <p
            className="pointer-events-auto mt-2 rounded-lg bg-card/95 px-3 py-2 text-[12px] leading-snug text-muted backdrop-blur-sm"
            data-testid="locate-denied"
          >
            {labels.locateDenied}
          </p>
        )}
        {!loading && stations.length === 0 && (
          <p
            className="pointer-events-auto mt-2 rounded-lg bg-card/95 px-3 py-2 text-[12px] leading-snug text-muted backdrop-blur-sm"
            data-testid="map-empty"
          >
            {labels.empty}
          </p>
        )}
      </div>

      {selected && (
        <PointMiniCard
          locale={locale}
          station={selected}
          labels={labels}
          routeLabels={routeLabels}
          onClose={() => setSelected(null)}
        />
      )}

      {sheetOpen && (
        <MapFilterSheet
          initial={filters}
          labels={labels}
          onApply={applyFilters}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}
