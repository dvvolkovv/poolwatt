"use client";

import type { ChargerStation } from "@/lib/chargers";
import { powerLevelLabel } from "@/lib/chargers";
import { OPERATOR_INFO } from "@/lib/charger-operators";
import { X, Zap, MapPin, Clock, Star, ExternalLink, Navigation, Phone, Mail, Globe, Smartphone } from "lucide-react";

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
  const badge = STATUS_BADGE[s.status] ?? STATUS_BADGE.operational;

  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`;

  return (
    <div className="bg-card border border-hairline rounded-lg overflow-hidden animate-in slide-in-from-right-4 duration-300">
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
            className="shrink-0 p-1 rounded-md hover:bg-card-alt transition-colors text-muted hover:text-foreground"
          >
            <X size={16} />
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

      {/* Cost */}
      {s.costInfo && (
        <div className="px-4 py-3 border-b border-hairline">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted mb-1">
            {labels.cost ?? "Cost"}
          </div>
          <p className="text-[13px] text-foreground">{s.costInfo}</p>
        </div>
      )}

      {/* Last verified */}
      {s.lastVerified && (
        <div className="px-4 py-2 border-b border-hairline text-[11px] text-muted">
          {labels.lastVerified ?? "Last verified"}:{" "}
          <span className="num">{new Date(s.lastVerified).toLocaleDateString()}</span>
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
        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-[13px] font-semibold uppercase tracking-wider bg-accent text-accent-foreground hover:brightness-110 transition-all"
        >
          <Navigation size={16} />
          {labels.directions ?? "Start Navigation"}
        </a>
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
