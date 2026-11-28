"use client";

// Страница зарядок: три раздела — станции, операторы, карта.
//
// Что было до 2026-11-28. Страница была картой: `fixed inset-0 flex`, слева
// колонка списка жёсткой ширины 380 точек, справа карта. На экране 360 точек
// колонка занимала весь экран, а карта целиком уезжала за правый край —
// водитель с телефона не видел её вовсе. Область поиска задавала только
// карта, то есть на телефоне её не задавал никто.
//
// Что стало. Открывается список станций во всю ширину, ближние первыми, —
// это и есть первый экран водителя. Карта — отдельный раздел, во весь экран,
// без деления пополам. Операторы — третий. Раздел и фильтры живут в адресе
// (US-23: «вид, который водитель нашёл, — это ссылка»), а область поиска
// задаётся тремя способами: геопозицией, выбором страны и окном карты.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { AlertTriangle, RotateCw, X } from "lucide-react";
import type { ChargerStation } from "@/lib/chargers";
import {
  bboxAround,
  COUNTRY_BOXES,
  DEFAULT_CENTRE,
  DEFAULT_RADIUS_KM,
  distanceKm,
  type BBox,
  type Centre,
} from "@/lib/navigator/areas";
import { ChargerMap, type Viewport } from "./charger-map";
import { StationCard } from "./station-card";
import { StationList, type ListStation } from "./station-list";
import { OperatorList, operatorsOf } from "./operator-list";
import { FilterBar, type Filters, type SortKey } from "./filter-bar";

type View = "list" | "operators" | "map";
type SourceTag = "live" | "cache" | "stale" | "mock" | null;

const FETCH_DEBOUNCE_MS = 400;
const VIEWS: View[] = ["list", "operators", "map"];

export function NavigatorClient({
  labels,
  initialFilters,
  initialView,
}: {
  labels: Record<string, string>;
  /** US-23 — the filters arrive in the address, so a filtered view is a link. */
  initialFilters: Partial<Filters>;
  initialView: View;
}) {
  const locale = useLocale();
  const [view, setView] = useState<View>(initialView);
  const [stations, setStations] = useState<ChargerStation[]>([]);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<SourceTag>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [me, setMe] = useState<Centre | null>(null);
  const [locating, setLocating] = useState(false);
  const [area, setArea] = useState<BBox>(
    () =>
      (initialFilters.country ? COUNTRY_BOXES[initialFilters.country] : null) ??
      bboxAround(DEFAULT_CENTRE, DEFAULT_RADIUS_KM),
  );
  const [filters, setFilters] = useState<Filters>({
    connector: "",
    power: "",
    status: "",
    query: "",
    sort: "distance",
    freeOnly: false,
    country: "",
    operator: "",
    ...initialFilters,
  });

  // Адрес идёт за видом и фильтрами: иначе найденное нельзя ни сохранить, ни
  // переслать, ни открыть заново.
  useEffect(() => {
    const params = new URLSearchParams();
    if (view !== "list") params.set("view", view);
    if (filters.connector) params.set("connector", filters.connector);
    if (filters.power) params.set("power", filters.power);
    if (filters.status) params.set("status", filters.status);
    if (filters.query) params.set("q", filters.query);
    if (filters.country) params.set("country", filters.country);
    if (filters.operator) params.set("operator", filters.operator);
    if (filters.sort !== "distance") params.set("sort", filters.sort);
    if (filters.freeOnly) params.set("free", "1");
    const next = params.toString();
    window.history.replaceState(
      null,
      "",
      next ? `${window.location.pathname}?${next}` : window.location.pathname,
    );
  }, [filters, view]);

  const inflight = useRef<AbortController | null>(null);

  const load = useCallback(
    async (box: BBox, at: Centre | null) => {
      inflight.current?.abort();
      const ac = new AbortController();
      inflight.current = ac;
      setLoading(true);
      setErrorMsg(null);
      setStations([]);
      try {
        const params = new URLSearchParams({
          south: box.south.toFixed(5),
          west: box.west.toFixed(5),
          north: box.north.toFixed(5),
          east: box.east.toFixed(5),
        });
        if (at) {
          params.set("atLat", at.lat.toFixed(5));
          params.set("atLng", at.lng.toFixed(5));
        }

        // Сначала наши пункты — они в нашей базе и приходят мгновенно.
        // Холодный ответ из OpenStreetMap идёт до двадцати шести секунд, и
        // пустой экран всё это время водитель читает как «сайт сломался».
        void fetch(`/api/chargers?${params}&fast=1`, { signal: ac.signal })
          .then((r) => (r.ok ? r.json() : null))
          .then((quick: ChargerStation[] | null) => {
            if (ac.signal.aborted || !quick?.length) return;
            setStations((current) => (current.length === 0 ? quick : current));
          })
          .catch(() => undefined);

        const res = await fetch(`/api/chargers?${params}`, { signal: ac.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setSource((res.headers.get("X-Source") as SourceTag) ?? null);
        setStations((await res.json()) as ChargerStation[]);
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setErrorMsg(labels.errorLoad);
        setSource(null);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    },
    [labels.errorLoad],
  );

  // Один запрос на область: дрожание карты не должно бить по сети.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(area, me), FETCH_DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [area, me, load]);

  const locate = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const centre = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setMe(centre);
        setArea(bboxAround(centre, DEFAULT_RADIUS_KM));
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
    );
  }, []);

  // «Согласно моей локации»: спрашиваем один раз при открытии, и только если
  // человек уже разрешал геопозицию этому сайту. Иначе окно браузера
  // выскакивало бы у каждого, кто зашёл просто посмотреть.
  useEffect(() => {
    if (!navigator.permissions?.query) return;
    let cancelled = false;
    void navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((status) => {
        if (!cancelled && status.state === "granted") locate();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [locate]);

  const onViewport = useCallback((vp: Viewport) => {
    setArea({ south: vp.south, west: vp.west, north: vp.north, east: vp.east });
  }, []);

  const shown: ListStation[] = useMemo(() => {
    let result: ListStation[] = stations.map((s) => ({
      ...s,
      distanceKm: me ? distanceKm(me, { lat: s.lat, lng: s.lng }) : null,
    }));

    if (filters.country) {
      result = result.filter((s) => s.country === filters.country);
    }
    if (filters.operator) {
      result = result.filter((s) => s.operator === filters.operator);
    }
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
    if (filters.freeOnly) {
      result = result.filter((s) =>
        s.connections.some((c) => c.availability === "FREE"),
      );
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

    return sortStations(result, filters.sort);
  }, [stations, filters, me]);

  const operators = useMemo(
    () =>
      operatorsOf(
        filters.operator ? stations : shown.map((s) => s as ChargerStation),
      ),
    [stations, shown, filters.operator],
  );

  const selected = useMemo(
    () => shown.find((s) => s.id === selectedId) ?? null,
    [shown, selectedId],
  );

  const openStation = useCallback((station: ListStation) => {
    setSelectedId(station.id);
  }, []);

  // Выбор страны переносит область поиска в эту страну. Это следствие
  // нажатия, а не состояния: в эффекте оно превратилось бы в лишний проход
  // отрисовки (`react-hooks/set-state-in-effect`).
  const changeFilters = useCallback(
    (next: Filters) => {
      if (next.country !== filters.country) {
        const box = next.country ? COUNTRY_BOXES[next.country] : null;
        if (box) setArea(box);
      }
      setFilters(next);
    },
    [filters.country],
  );

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col">
      <nav
        aria-label={labels.title}
        className="sticky top-16 z-20 border-b border-hairline bg-bg/95 backdrop-blur-md"
      >
        <div className="mx-auto flex max-w-[1200px] gap-1 px-4">
          {VIEWS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              data-testid={`view-${key}`}
              aria-current={view === key}
              className={`min-h-[48px] flex-1 border-b-2 px-2 text-[12px] font-semibold uppercase tracking-[0.12em] transition-colors sm:text-[13px] ${
                view === key
                  ? "border-accent text-accent"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {labels[`tab_${key}`]}
            </button>
          ))}
        </div>
      </nav>

      <FilterBar
        filters={filters}
        onChange={changeFilters}
        labels={labels}
        locale={locale}
        locating={locating}
        located={me != null}
        onLocate={locate}
      />

      <div className="mx-auto w-full max-w-[1200px] px-4 py-2">
        <p className="num text-[12px] text-muted" data-testid="navigator-count">
          {loading
            ? labels.loading
            : `${shown.length} ${labels.stationsFound}`}
        </p>
      </div>

      {errorMsg && (
        <Banner message={errorMsg} labels={labels} onRetry={() => void load(area, me)} onDismiss={() => setErrorMsg(null)} />
      )}
      {!errorMsg && (source === "stale" || source === "mock") && (
        <Banner
          message={source === "stale" ? labels.sourceStale : labels.sourceMock}
          labels={labels}
          onRetry={() => void load(area, me)}
          onDismiss={() => setSource(null)}
        />
      )}

      {view === "list" && (
        <div className="mx-auto flex w-full max-w-[1200px] flex-1 gap-6 px-0 pb-10 lg:px-4">
          <div className="min-w-0 flex-1">
            <StationList
              stations={shown}
              loading={loading}
              selectedId={selectedId}
              onSelect={openStation}
              labels={labels}
            />
          </div>

          {/* Одна карточка, два облика. На телефоне это отдельный экран
              поверх всего, на мониторе — колонка справа от списка. Два узла
              вместо одного стоили бы двух одинаковых кнопок «маршрут» в
              разметке — и это ловил тест §27. */}
          {selected && (
            <aside
              data-testid="station-sheet"
              className="fixed inset-0 z-40 overflow-y-auto bg-bg lg:static lg:z-auto lg:w-[380px] lg:shrink-0 lg:overflow-visible lg:bg-transparent"
            >
              <div className="lg:sticky lg:top-[180px]">
                <StationCard
                  station={selected}
                  onClose={() => setSelectedId(null)}
                  labels={labels}
                />
              </div>
            </aside>
          )}
        </div>
      )}

      {view === "operators" && (
        <div className="mx-auto w-full max-w-[1200px] flex-1 pb-10">
          <OperatorList
            operators={operators}
            labels={labels}
            onSelect={(name) => {
              setFilters((f) => ({ ...f, operator: name }));
              setView("list");
            }}
          />
        </div>
      )}

      {view === "map" && (
        <div className="relative h-[calc(100dvh-4rem-48px-69px)] min-h-[320px] w-full">
          <ChargerMap
            stations={shown}
            selectedId={selectedId}
            onSelect={openStation}
            onViewportChange={onViewport}
          />
          {selected && (
            <div className="absolute inset-x-2 top-2 z-10 max-h-[calc(100%-1rem)] overflow-y-auto sm:inset-x-auto sm:right-4 sm:w-[360px]">
              <StationCard
                station={selected}
                onClose={() => setSelectedId(null)}
                labels={labels}
              />
            </div>
          )}
        </div>
      )}

    </div>
  );
}

function sortStations(list: ListStation[], sort: SortKey): ListStation[] {
  if (sort === "priceAsc") {
    return [...list].sort((a, b) => price(a) - price(b));
  }
  if (sort === "distance") {
    // Без геопозиции расстояния нет — остаётся порядок выдачи, в котором наши
    // пункты идут первыми.
    if (list.every((s) => s.distanceKm == null)) return list;
    return [...list].sort(
      (a, b) =>
        (a.distanceKm ?? Number.POSITIVE_INFINITY) -
        (b.distanceKm ?? Number.POSITIVE_INFINITY),
    );
  }
  return list;
}

const price = (s: ListStation) =>
  s.operatorPrice ? Number(s.operatorPrice.pricePerKwh) : Number.POSITIVE_INFINITY;

function Banner({
  message,
  labels,
  onRetry,
  onDismiss,
}: {
  message: string;
  labels: Record<string, string>;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pb-2">
      <div className="flex items-center gap-3 rounded-lg border border-amber-500/40 bg-card px-3 py-2">
        <AlertTriangle size={16} className="shrink-0 text-amber-500" />
        <span className="min-w-0 flex-1 text-[13px] leading-snug text-foreground">
          {message}
        </span>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-hairline px-2.5 text-[11px] font-medium uppercase tracking-wider text-foreground"
        >
          <RotateCw size={11} />
          {labels.retry}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="p-1 text-muted hover:text-foreground"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
