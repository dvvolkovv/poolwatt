"use client";

// §27 «ближайшие пункты» на экране зарядки — короткий список, не карта.
// Полная карта с кластеризацией и фильтрами — этап M3-б.
//
// Берём тот же `/api/chargers`, что навигатор, и оставляем только свои
// пункты: только у них есть разъём, который можно обещать, и цена, которую
// мы знаем.

import { useEffect, useState } from "react";
import Link from "next/link";

type Station = {
  id: string;
  title: string;
  address: string;
  lat: number;
  lng: number;
  poolwattPointId: string | null;
  costInfo: string | null;
  connections: { connectorType: string; powerKw: number; availability: string }[];
};

/** Полградуса вокруг — примерно 50 км по широте, этого хватает «рядом». */
const SPAN = 0.5;
const SHOW = 5;

function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function NearbyPoints({
  locale,
  labels,
}: {
  locale: string;
  labels: { nearby: string; nearbyHelp: string; nearbyEmpty: string };
}) {
  const [stations, setStations] = useState<Station[] | null>(null);
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!navigator.geolocation) {
      setDenied(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setHere({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setDenied(true),
      { timeout: 8_000, maximumAge: 60_000 },
    );
  }, []);

  useEffect(() => {
    if (!here) return;
    const ac = new AbortController();
    const params = new URLSearchParams({
      south: String(here.lat - SPAN),
      north: String(here.lat + SPAN),
      west: String(here.lng - SPAN),
      east: String(here.lng + SPAN),
    });
    fetch(`/api/chargers?${params}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Station[]) => setStations(rows.filter((s) => s.poolwattPointId)))
      // Отказ сети не ломает экран: зарядка начинается по QR, а не отсюда.
      .catch(() => setStations([]));
    return () => ac.abort();
  }, [here]);

  if (denied) {
    return (
      <p className="mt-6 text-[13px] text-muted" data-testid="nearby-denied">
        {labels.nearbyHelp}
      </p>
    );
  }

  const sorted = here && stations
    ? stations
        .map((s) => ({ s, d: metres(here, { lat: s.lat, lng: s.lng }) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, SHOW)
    : [];

  return (
    <section className="mt-8" data-testid="nearby-points">
      <h2 className="text-[12px] uppercase tracking-[0.16em] text-muted">
        {labels.nearby}
      </h2>
      {stations && sorted.length === 0 && (
        <p className="mt-2 text-[13px] text-muted">{labels.nearbyEmpty}</p>
      )}
      <ul className="mt-2 divide-y divide-hairline rounded-lg border border-hairline bg-card">
        {sorted.map(({ s, d }) => {
          const free = s.connections.filter((c) => c.availability === "FREE").length;
          return (
            <li key={s.id}>
              <Link
                href={`/${locale}/app/charge/start?p=${s.poolwattPointId}`}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14px]">{s.title}</span>
                  <span className="block text-[12px] text-muted">
                    <span className="num">{(d / 1000).toFixed(1)}</span> km
                    {s.costInfo ? ` · ${s.costInfo}` : ""}
                    {free > 0 ? ` · ${free}` : ""}
                  </span>
                </span>
                <span className="text-muted">›</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
