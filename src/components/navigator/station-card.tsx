"use client";

import { useLocale } from "next-intl";
import type { ChargerStation } from "@/lib/chargers";
import { powerLevelLabel } from "@/lib/chargers";
import { OPERATOR_INFO } from "@/lib/charger-operators";
import Link from "next/link";
import { MapsDeepLink } from "@/components/maps-deep-link";
import { X, Zap, MapPin, Clock, Star, ExternalLink, Navigation, Phone, Mail, Globe, Smartphone } from "lucide-react";

const CURRENCY_SYMBOL: Record<string, string> = {
  EUR: "€",
  USD: "$",
  GBP: "£",
  CZK: "Kč",
  PLN: "zł",
  CHF: "₣",
  RUB: "₽",
  UAH: "₴",
};

function formatPrice(value: string, currency: string): string {
  // Trim trailing zeros past 2 decimals while keeping at least 2 sig figures.
  const n = Number(value);
  if (!Number.isFinite(n)) return `${value} ${currency}`;
  const symbol = CURRENCY_SYMBOL[currency] ?? currency;
  return `${n.toFixed(n < 0.1 ? 4 : n < 1 ? 3 : 2)} ${symbol}/kWh`;
}

function relativeTime(iso: string, locale: string): string {
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (diff < 60) return rtf.format(-diff, "second");
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), "minute");
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
  return rtf.format(-Math.round(diff / 86400), "day");
}

// Traffic-light freshness: green within 24h, yellow within 7d, grey older.
// Tells travelers at a glance whether an operator-published price is current.
function freshnessClass(iso: string): string {
  const ageH = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (ageH < 24) return "bg-green/15 text-green";
  if (ageH < 24 * 7) return "bg-accent/15 text-accent";
  return "bg-card-alt text-muted";
}

type Props = {
  station: ChargerStation;
  onClose: () => void;
  labels: Record<string, string>;
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  operational: { label: "Operational", cls: "bg-green/20 text-green" },
  planned: { label: "Planned", cls: "bg-info/20 text-info" },
  temporarily_unavailable: {
    label: "Temp. Unavailable",
    cls: "bg-accent/20 text-accent",
  },
  removed: { label: "Removed", cls: "bg-down/20 text-down" },
};

const CONNECTOR_ICON: Record<string, string> = {
  CCS2: "⚡",
  CHAdeMO: "🔌",
  Type2: "🔋",
  Type1: "🔋",
  Tesla: "⚡",
  "GB/T": "🔌",
  Schuko: "🔌",
};

export function StationCard({ station: s, onClose, labels }: Props) {
  const locale = useLocale();
  const badge = STATUS_BADGE[s.status] ?? STATUS_BADGE.operational;


  return (
    <div data-testid="station-card"
      className="bg-card border border-hairline lg:rounded-lg overflow-hidden">
      {/* §41 — the mini-card has room for the network's banner and nothing
          else. Only our own points have one; an OpenStreetMap pin has no
          partner behind it. */}
      {s.bannerAssetId && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/v1/marketing/media/${s.bannerAssetId}`}
          alt={s.operator}
          data-testid="mini-banner"
          className="h-20 w-full border-b border-hairline object-cover"
        />
      )}

      {/* Header */}
      <div className="p-4 border-b border-hairline">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-foreground truncate">
              {s.title}
            </h3>
            <p className="text-[12px] text-muted mt-0.5">{s.operator}</p>
          </div>
          <button
            onClick={onClose}
            aria-label={labels.back ?? "Back"}
            data-testid="station-card-close"
            className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-card-alt hover:text-foreground"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span className={`text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full ${badge.cls}`}>
            {labels[`status_${s.status}`] ?? badge.label}
          </span>
          <span className="text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full bg-blue/15 text-blue">
            {powerLevelLabel(s.powerLevel)}
          </span>
          {s.renewable && (
            <span className="text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full bg-green/15 text-green">
              🍃 Renewable
            </span>
          )}
        </div>
      </div>

      {/* Address */}
      <div className="px-4 py-3 border-b border-hairline">
        <div className="flex items-start gap-2 text-[13px]">
          <MapPin size={14} className="shrink-0 text-muted mt-0.5" />
          <div>
            <p className="text-foreground">{s.address}</p>
            <p className="text-muted">
              {s.city}{s.country ? `, ${s.country}` : ""}
            </p>
          </div>
        </div>
        {s.openHours && (
          <div className="flex items-start gap-2 text-[13px] mt-2">
            <Clock size={14} className="shrink-0 text-muted mt-0.5" />
            <p className="text-muted">{s.openHours}</p>
          </div>
        )}
      </div>

      {/* Connections — full technical info */}
      <div className="px-4 py-3 border-b border-hairline">
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted mb-2">
          {labels.connections ?? "Connections"}
        </div>
        <div className="space-y-2">
          {s.connections.map((c, i) => (
            <div key={i} className="flex items-center justify-between text-[13px] bg-bg/50 rounded-md px-3 py-2">
              <div className="flex items-center gap-2">
                <span>{CONNECTOR_ICON[c.connectorType] ?? "🔌"}</span>
                <span className="font-medium text-foreground">{c.connectorType}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-card-alt text-muted">
                  {c.currentType}
                </span>
                {/* §27 — free, busy or out of service, when anybody knows. */}
                {c.availability && c.availability !== "UNKNOWN" && (
                  <span
                    data-testid="connector-availability"
                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                      c.availability === "FREE"
                        ? "bg-up/15 text-up"
                        : c.availability === "BUSY"
                          ? "bg-down/15 text-down"
                          : "bg-card-alt text-muted"
                    }`}
                  >
                    {labels[`availability_${c.availability}`] ?? c.availability.toLowerCase()}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 num text-[12px]">
                <span className="text-foreground font-medium">
                  {c.powerKw > 0 ? `${c.powerKw} kW` : "—"}
                </span>
                {c.voltageV && (
                  <span className="text-muted">{c.voltageV} V</span>
                )}
                {c.ampereA && (
                  <span className="text-muted">{c.ampereA} A</span>
                )}
                <span className="text-muted">×{c.quantity}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stats row */}
      <div className="px-4 py-3 border-b border-hairline grid grid-cols-3 gap-2">
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted mb-0.5">
            {labels.points ?? "Points"}
          </div>
          <div className="num text-[15px] font-semibold text-foreground">
            {s.totalPoints}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted mb-0.5">
            {labels.maxPower ?? "Max power"}
          </div>
          <div className="num text-[15px] font-semibold text-accent flex items-center justify-center gap-1">
            <Zap size={13} />
            {s.maxPowerKw} kW
          </div>
        </div>
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted mb-0.5">
            {labels.rating ?? "Rating"}
          </div>
          <div className="num text-[15px] font-semibold text-foreground flex items-center justify-center gap-1">
            <Star size={13} className="text-accent" />
            {s.rating ?? "—"}
          </div>
        </div>
      </div>

      {/* Price per kWh — always rendered. Preference order:
          1. Operator-published price (Step 2, live from cabinet/API)
          2. OCM free-text costInfo (~10% of stations)
          3. Fallback to operator contact link */}
      {(() => {
        const op = s.operatorInfo ?? OPERATOR_INFO[s.operator];
        const operatorHost = op?.website?.replace(/^https?:\/\//, "").split("/")[0];
        return (
          <div className="px-4 py-3 border-b border-hairline">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted mb-1 flex items-center justify-between">
              <span>{labels.priceLabel ?? "Price / kWh"}</span>
              {s.operatorPrice && (
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded-full normal-case tracking-normal ${freshnessClass(s.operatorPrice.updatedAt)}`}
                >
                  ● {labels.priceLive ?? "Live"}
                </span>
              )}
            </div>
            {s.operatorPrice ? (
              <>
                <p className="num text-[15px] font-semibold text-foreground">
                  {formatPrice(s.operatorPrice.pricePerKwh, s.operatorPrice.currency)}
                </p>
                <p className="text-[11px] text-muted mt-0.5">
                  {labels.priceUpdated ?? "Updated"}{" "}
                  <span className="num">{relativeTime(s.operatorPrice.updatedAt, locale)}</span>
                </p>
              </>
            ) : s.costInfo ? (
              <p className="text-[13px] text-foreground">{s.costInfo}</p>
            ) : (
              <p className="text-[12px] text-muted">
                {labels.priceFallback ?? "Tariff varies — contact operator"}
                {op?.website && (
                  <>
                    {" — "}
                    <a
                      href={op.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline"
                    >
                      {operatorHost}
                    </a>
                  </>
                )}
              </p>
            )}
          </div>
        );
      })()}

      {/* Last verified */}
      {s.lastVerified && (
        <div className="px-4 py-2 border-b border-hairline text-[11px] text-muted">
          {labels.lastVerified ?? "Last verified"}:{" "}
          <span className="num">{new Date(s.lastVerified).toLocaleDateString()}</span>
        </div>
      )}

      {/* §28 «Способы оплаты». Водителю это нужно до поездки, а не на месте:
          у чужого пина их нет вовсе, у нашего — список из карточки пункта. */}
      {s.paymentMethods && s.paymentMethods.length > 0 && (
        <div className="px-4 py-3 border-b border-hairline">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted mb-2">
            {labels.payments ?? "Payment"}
          </div>
          <div className="flex flex-wrap gap-1.5" data-testid="station-payments">
            {s.paymentMethods.map((method) => (
              <span
                key={method}
                className="rounded-full border border-hairline px-2 py-0.5 text-[11px] text-foreground"
              >
                {labels[`payment_${method}`] ?? method}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Operator Contact */}
      {(() => {
        const op = s.operatorInfo ?? OPERATOR_INFO[s.operator];
        if (!op) return null;
        return (
          <div className="px-4 py-3 border-b border-hairline">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted mb-2">
              {s.operator} — Contact
            </div>
            <div className="space-y-1.5">
              <a href={op.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-[12px] text-accent hover:underline">
                <Globe size={12} /> {op.website.replace("https://", "")}
              </a>
              <a href={`tel:${op.phone}`} className="flex items-center gap-2 text-[12px] text-foreground hover:text-accent">
                <Phone size={12} /> {op.phone}
              </a>
              <a href={`mailto:${op.email}`} className="flex items-center gap-2 text-[12px] text-foreground hover:text-accent">
                <Mail size={12} /> {op.email}
              </a>
              {op.app && (
                <div className="flex items-center gap-2 text-[12px] text-muted mt-2">
                  <Smartphone size={12} />
                  <span className="font-medium text-foreground">{op.app}</span>
                  {op.appStoreUrl && (
                    <a href={op.appStoreUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] px-1.5 py-0.5 rounded bg-card-alt text-accent hover:underline">iOS</a>
                  )}
                  {op.playStoreUrl && (
                    <a href={op.playStoreUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] px-1.5 py-0.5 rounded bg-card-alt text-accent hover:underline">Android</a>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Actions */}
      <div className="p-4 flex flex-col gap-2">
        {/* US-23 "маршрут в один тап": the device's own maps, no chooser. */}
        <MapsDeepLink
          lat={s.lat}
          lng={s.lng}
          name={s.title}
          label={labels.directions ?? "Start Navigation"}
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-[13px] font-semibold uppercase tracking-wider bg-accent text-accent-foreground hover:brightness-110 transition-all"
        />
        {s.poolwattPointId ? (
          <Link
            href={`/${locale}/c/${s.poolwattPointId}`}
            prefetch={false}
            data-testid="full-card-link"
            className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-[11px] font-medium text-muted border border-hairline hover:text-foreground hover:bg-card-alt transition-colors"
          >
            <ExternalLink size={12} />
            {labels.fullCard ?? "Full card"}
          </Link>
        ) : null}
        <a
          href={`https://openchargemap.org/site/poi/details/${s.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-[11px] font-medium text-muted border border-hairline hover:text-foreground hover:bg-card-alt transition-colors"
        >
          <ExternalLink size={12} />
          Open Charge Map
        </a>
      </div>
    </div>
  );
}
