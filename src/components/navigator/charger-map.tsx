"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ChargerStation } from "@/lib/chargers";

const MB = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

const STYLES = MB
  ? {
      dark: `https://api.mapbox.com/styles/v1/mapbox/dark-v11?access_token=${MB}`,
      voyager: `https://api.mapbox.com/styles/v1/mapbox/streets-v12?access_token=${MB}`,
      satellite: `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12?access_token=${MB}`,
    }
  : {
      dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
      voyager: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
      satellite: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
    };

type StyleKey = keyof typeof STYLES;

export type Viewport = {
  south: number;
  west: number;
  north: number;
  east: number;
};

type Props = {
  stations: ChargerStation[];
  selectedId: string | null;
  onSelect: (station: ChargerStation) => void;
  onViewportChange: (vp: Viewport) => void;
};

const STATUS_COLOR: Record<string, string> = {
  operational: "#10b981",
  planned: "#38bdf8",
  temporarily_unavailable: "#f5b400",
  removed: "#f87171",
};

const POWER_SIZE: Record<string, number> = {
  ac_slow: 8,
  ac_fast: 10,
  dc_fast: 13,
  dc_ultra: 16,
};

export function ChargerMap({ stations, selectedId, onSelect, onViewportChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [mapStyle, setMapStyle] = useState<StyleKey>("dark");
  const [is3d, setIs3d] = useState(false);

  const notifyBounds = useCallback(
    (map: maplibregl.Map) => {
      const bounds = map.getBounds();
      if (!bounds) return;
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      // Clamp east>west: dragging across the antimeridian can produce
      // east < west and crash the bbox query.
      const east = ne.lng > sw.lng ? ne.lng : sw.lng + 0.01;
      onViewportChange({
        south: sw.lat,
        west: sw.lng,
        north: ne.lat,
        east,
      });
    },
    [onViewportChange],
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLES.dark,
      center: [17.1, 48.15],
      zoom: 10,
      pitch: 0,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      "top-right",
    );
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => notifyBounds(map));
    map.on("moveend", () => notifyBounds(map));

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [notifyBounds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(STYLES[mapStyle]);
  }, [mapStyle]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ pitch: is3d ? 60 : 0, duration: 600 });
  }, [is3d]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    for (const s of stations) {
      const size = POWER_SIZE[s.powerLevel] ?? 10;
      const color = STATUS_COLOR[s.status] ?? "#93a0b1";
      const isSelected = s.id === selectedId;

      const el = document.createElement("div");
      el.style.display = "flex";
      el.style.flexDirection = "column";
      el.style.alignItems = "center";
      el.style.cursor = "pointer";

      const dot = document.createElement("div");
      const dotSize = size * (isSelected ? 1.6 : 1);
      dot.style.width = `${dotSize}px`;
      dot.style.height = `${dotSize}px`;
      dot.style.borderRadius = "50%";
      dot.style.background = color;
      dot.style.border = isSelected ? "2px solid #f5f7fa" : "1.5px solid rgba(0,0,0,0.4)";
      dot.style.boxShadow = isSelected
        ? `0 0 12px ${color}`
        : `0 0 6px ${color}55`;
      dot.style.transition = "all 0.2s ease";

      const label = document.createElement("div");
      label.style.marginTop = "3px";
      label.style.padding = "2px 5px";
      label.style.borderRadius = "4px";
      label.style.background = "rgba(12,16,20,0.85)";
      label.style.border = `1px solid ${color}66`;
      label.style.whiteSpace = "nowrap";
      label.style.fontSize = "9px";
      label.style.lineHeight = "1.2";
      label.style.color = "#f5f7fa";
      label.style.textAlign = "center";
      label.style.fontFamily = "var(--font-mono, monospace)";
      const renewBadge = s.renewable ? `<span style="color:#10b981" title="Renewable energy">🍃</span> ` : "";
      label.innerHTML = `${renewBadge}<span style="color:${color};font-weight:600">${s.maxPowerKw} kW</span><br/><span style="opacity:0.7">${s.operator.length > 12 ? s.operator.slice(0, 11) + "…" : s.operator}</span>`;

      el.appendChild(dot);
      el.appendChild(label);

      const marker = new maplibregl.Marker({ element: el, anchor: "top" })
        .setLngLat([s.lng, s.lat])
        .addTo(map);

      el.addEventListener("click", () => onSelect(s));
      markersRef.current.push(marker);
    }
  }, [stations, selectedId, onSelect]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const s = stations.find((st) => st.id === selectedId);
    if (s) {
      map.flyTo({ center: [s.lng, s.lat], zoom: 14, duration: 800 });
    }
  }, [selectedId, stations]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      <div className="absolute top-4 left-4 flex gap-2 z-10">
        <button
          onClick={() => {
            const keys = Object.keys(STYLES) as StyleKey[];
            const next = keys[(keys.indexOf(mapStyle) + 1) % keys.length];
            setMapStyle(next);
          }}
          className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider rounded-md bg-card/90 backdrop-blur-sm text-foreground border border-hairline hover:bg-card-alt transition-colors"
        >
          {mapStyle === "dark" ? "Map" : mapStyle === "voyager" ? "Satellite" : "Dark"}
        </button>
        <button
          onClick={() => setIs3d(!is3d)}
          className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider rounded-md bg-card/90 backdrop-blur-sm text-foreground border border-hairline hover:bg-card-alt transition-colors"
        >
          {is3d ? "2D" : "3D"}
        </button>
      </div>
    </div>
  );
}
