// The mini-card of ТЗ §27 — what a driver sees when they tap a pin, and what
// the §29.2 wizard previews. One component for both: a preview drawn by
// different code is a preview of something else.

import Link from "next/link";
import { MapsDeepLink } from "@/components/maps-deep-link";

export type MiniConnector = {
  type: string;
  powerKw: number;
  quantity: number;
  status: "FREE" | "BUSY" | "OUT_OF_SERVICE" | "UNKNOWN";
};

export type MiniPoint = {
  id: string;
  name: string;
  operatorName: string | null;
  type: string;
  city: string | null;
  country: string | null;
  addressLine: string | null;
  latitude: number | null;
  longitude: number | null;
  energySource: string | null;
  open24: boolean;
  priceFiat: number | null;
  currency: string;
  priceTokens: number | null;
  connectors: MiniConnector[];
  /** Metres from the driver, when the browser shared a position. */
  distanceM?: number | null;
};

export type MiniCardLabels = {
  freeNow: string;
  busy: string;
  unknown: string;
  outOfService: string;
  open24: string;
  route: string;
  details: string;
  noPrice: string;
  connectors: string;
  perKwh: string;
};

export function PointMiniCard({
  point,
  locale,
  labels,
  preview = false,
}: {
  point: MiniPoint;
  locale: string;
  labels: MiniCardLabels;
  preview?: boolean;
}) {
  const free = point.connectors.filter((c) => c.status === "FREE");
  const known = point.connectors.some((c) => c.status !== "UNKNOWN");

  return (
    <div
      className="rounded-lg border border-hairline bg-card p-4"
      data-testid={preview ? "point-preview" : "point-mini-card"}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[16px] font-semibold">{point.name || "—"}</h3>
        {point.energySource && (
          <span className="text-[11px] uppercase tracking-[0.12em] text-accent">
            🍃 {point.energySource}
          </span>
        )}
      </div>

      <p className="mt-0.5 text-[12px] text-muted">
        {[point.operatorName, point.addressLine, point.city, point.country]
          .filter(Boolean)
          .join(" · ") || "—"}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
        <span
          data-testid="point-availability"
          className={
            free.length > 0 ? "text-up" : known ? "text-down" : "text-muted"
          }
        >
          {free.length > 0
            ? `${labels.freeNow}: ${free.reduce((n, c) => n + c.quantity, 0)}`
            : known
              ? labels.busy
              : labels.unknown}
        </span>
        {point.open24 && <span className="text-muted">· {labels.open24}</span>}
        {point.distanceM != null && (
          <span className="num text-muted">· {formatDistance(point.distanceM)}</span>
        )}
      </div>

      <div className="mt-3 text-[12px]">
        <div className="text-muted">{labels.connectors}</div>
        <ul className="mt-1 space-y-0.5">
          {point.connectors.length === 0 && <li className="text-muted">—</li>}
          {point.connectors.map((c, i) => (
            <li key={`${c.type}-${i}`} className="flex justify-between">
              <span>
                {c.type} <span className="num text-muted">×{c.quantity}</span>
              </span>
              <span className="num text-muted">
                {c.powerKw} kW · {statusLabel(c.status, labels)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 text-[13px]">
        {point.priceFiat == null && point.priceTokens == null ? (
          <span className="text-muted">{labels.noPrice}</span>
        ) : (
          <span className="num">
            {point.priceFiat != null && `${point.priceFiat.toFixed(2)} ${point.currency}`}
            {point.priceFiat != null && point.priceTokens != null && " · "}
            {point.priceTokens != null && `${point.priceTokens.toFixed(3)} kWh`}
            <span className="ml-1 text-[11px] text-muted">{labels.perKwh}</span>
          </span>
        )}
      </div>

      {!preview && (
        <div className="mt-4 flex gap-2">
          {point.latitude != null && point.longitude != null && (
            // US-23 "маршрут в один тап" — one tap, the device's own maps.
            <MapsDeepLink
              lat={point.latitude}
              lng={point.longitude}
              name={point.name}
              label={labels.route}
              className="flex-1 rounded border border-hairline px-3 py-2 text-center text-[13px] hover:border-accent"
            />
          )}
          <Link
            href={`/${locale}/c/${point.id}`}
            prefetch={false}
            className="flex-1 rounded border border-hairline px-3 py-2 text-center text-[13px] hover:border-accent"
          >
            {labels.details}
          </Link>
        </div>
      )}
    </div>
  );
}

function statusLabel(status: MiniConnector["status"], labels: MiniCardLabels): string {
  switch (status) {
    case "FREE":
      return labels.freeNow;
    case "BUSY":
      return labels.busy;
    case "OUT_OF_SERVICE":
      return labels.outOfService;
    default:
      return labels.unknown;
  }
}

function formatDistance(metres: number): string {
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
}
