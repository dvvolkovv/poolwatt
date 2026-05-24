// kWh / power formatting helpers — analog of price formatters in the reference project.

export function formatKwh(kwh: number, opts: { compact?: boolean } = {}): string {
  if (Number.isNaN(kwh) || !Number.isFinite(kwh)) return "—";
  if (opts.compact) {
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(kwh) + " kWh";
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: kwh < 100 ? 2 : 0,
  }).format(kwh) + " kWh";
}

export function formatKw(kw: number): string {
  if (kw >= 1000) {
    return `${(kw / 1000).toFixed(2)} MW`;
  }
  return `${kw.toFixed(kw < 10 ? 2 : 1)} kW`;
}

export function formatPct(pct: number | null | undefined, opts: { showSign?: boolean } = {}): string {
  if (pct == null || Number.isNaN(pct)) return "—";
  const sign = opts.showSign ? (pct > 0 ? "+" : pct < 0 ? "" : "") : "";
  return `${sign}${pct.toFixed(2)}%`;
}

export function deltaClass(pct: number | null | undefined): string {
  if (pct == null || pct === 0) return "text-muted";
  return pct > 0 ? "text-up" : "text-down";
}

export function formatCo2(kgCo2e: number): string {
  if (kgCo2e >= 1000) {
    return `${(kgCo2e / 1000).toFixed(2)} t CO₂e`;
  }
  return `${kgCo2e.toFixed(1)} kg CO₂e`;
}
