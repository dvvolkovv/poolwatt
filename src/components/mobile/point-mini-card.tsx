"use client";

// §27 «Мини-карточка по тапу: название, расстояние, цена, свободные разъёмы,
// кнопки „Маршрут“ и „Зарядиться“». Чужой пин получает только название,
// адрес и маршрут: ни цены, ни занятости мы о нём не знаем, и придумывать
// их нельзя.

import Link from "next/link";
import type { ChargerStation } from "@/lib/chargers";
import { RouteSheet, type RouteLabels } from "@/components/route-sheet";

export type MiniLabels = {
  charge: string;
  details: string;
  freeOf: string;
  priceTokens: string;
  priceUtc: string;
  foreignPin: string;
  pointType: Record<string, string>;
  availability: Record<string, string>;
};

const AVAILABILITY_CLASS: Record<string, string> = {
  FREE: "text-up",
  BUSY: "text-amber-500",
  BOOKED: "text-accent",
  OUT_OF_SERVICE: "text-down",
  UNKNOWN: "text-muted",
};

/** Доступность пункта — лучшее из его разъёмов: есть свободный — свободен. */
export function rollUpAvailability(station: ChargerStation): string {
  const order = ["FREE", "BOOKED", "BUSY", "OUT_OF_SERVICE", "UNKNOWN"];
  const seen = new Set(
    station.connections.map((c) => c.availability ?? "UNKNOWN") as string[],
  );
  return order.find((s) => seen.has(s)) ?? "UNKNOWN";
}

export function PointMiniCard({
  locale,
  station,
  labels,
  routeLabels,
  onClose,
}: {
  locale: string;
  station: ChargerStation;
  labels: MiniLabels;
  routeLabels: RouteLabels;
  onClose: () => void;
}) {
  const ours = !!station.poolwattPointId;
  const availability = rollUpAvailability(station);
  const free = station.connections
    .filter((c) => c.availability === "FREE")
    .reduce((n, c) => n + c.quantity, 0);
  const total = station.connections.reduce((n, c) => n + c.quantity, 0);

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-30 rounded-t-2xl border-t border-hairline bg-card p-4 pb-5"
      data-testid="mini-card"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={station.title}
        data-testid="mini-close"
        className="absolute right-3 top-3 px-2 text-[18px] leading-none text-muted"
      >
        ×
      </button>

      <div className="pr-8">
        <div className="text-[11px] uppercase tracking-[0.16em] text-muted">
          {ours && station.pointType
            ? (labels.pointType[station.pointType] ?? station.pointType)
            : station.operator}
          {ours && (
            <>
              {" · "}
              <span className={AVAILABILITY_CLASS[availability]}>
                {labels.availability[availability] ?? availability}
              </span>
            </>
          )}
        </div>
        <h2 className="mt-1 text-[18px] font-semibold leading-tight">{station.title}</h2>
        <p className="mt-0.5 text-[13px] text-muted">
          {[station.address, station.city].filter(Boolean).join(", ")}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[13px]">
        {station.distanceM != null && (
          <span className="text-muted">
            <span className="num text-foreground">{(station.distanceM / 1000).toFixed(1)}</span> km
          </span>
        )}
        {station.operatorPrice && (
          <span className="num text-foreground">
            {Number(station.operatorPrice.pricePerKwh).toFixed(3)}{" "}
            {station.operatorPrice.currency}/kWh
          </span>
        )}
        {station.priceTokens != null && (
          <span className="text-muted">
            <span className="num text-foreground">{station.priceTokens.toFixed(3)}</span>{" "}
            {labels.priceTokens}
          </span>
        )}
        {ours && total > 0 && (
          <span className="text-muted">
            <span className="num text-foreground">{free}</span> {labels.freeOf}{" "}
            <span className="num">{total}</span>
          </span>
        )}
      </div>

      {ours && station.priceZoneKnown === false && (
        <p className="mt-2 text-[12px] leading-snug text-muted">{labels.priceUtc}</p>
      )}
      {!ours && <p className="mt-2 text-[12px] leading-snug text-muted">{labels.foreignPin}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <RouteSheet
          lat={station.lat}
          lng={station.lng}
          name={station.title}
          labels={routeLabels}
          className="rounded-full bg-accent px-5 py-3 text-[13px] font-semibold uppercase tracking-[0.18em] text-accent-foreground"
        />
        {ours && (
          <Link
            href={`/${locale}/app/charge/start?p=${station.poolwattPointId}`}
            prefetch={false}
            data-testid="mini-charge"
            className="rounded-full border border-hairline px-5 py-3 text-[13px] font-semibold uppercase tracking-[0.18em]"
          >
            {labels.charge}
          </Link>
        )}
        <Link
          href={
            ours ? `/${locale}/app/c/${station.poolwattPointId}` : `/${locale}/c/${station.id}`
          }
          prefetch={false}
          data-testid="mini-details"
          className="rounded-full border border-hairline px-5 py-3 text-[13px] uppercase tracking-[0.18em] text-muted"
        >
          {labels.details}
        </Link>
      </div>
    </div>
  );
}
