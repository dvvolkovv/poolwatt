// US-18 — "график за день, неделю, месяц". Bars, server-rendered: a chart of
// a few dozen points needs no JavaScript, and this one has to render inside a
// cabinet page that is already a server component.

import type { GenerationSeries } from "@/lib/exchange/station-service";

export function GenerationChart({
  series,
  emptyLabel,
}: {
  series: GenerationSeries;
  emptyLabel: string;
}) {
  if (series.points.length === 0) {
    return <p className="text-sm text-muted">{emptyLabel}</p>;
  }

  const max = Math.max(...series.points.map((p) => p.kwh));
  const label = (at: Date) =>
    series.bucket === "interval" ? at.toISOString().slice(11, 16) : at.toISOString().slice(5, 10);

  return (
    <div data-testid="generation-chart">
      <div className="flex h-[140px] items-end gap-[3px]">
        {series.points.map((p) => (
          <div
            key={p.at.toISOString()}
            title={`${label(p.at)} · ${p.kwh.toFixed(3)} kWh`}
            className="min-w-[4px] flex-1 rounded-t bg-accent/70"
            style={{ height: `${max > 0 ? Math.max(2, (p.kwh / max) * 100) : 2}%` }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted num">
        <span>{label(series.points[0].at)}</span>
        <span>{max.toFixed(3)} kWh</span>
        <span>{label(series.points[series.points.length - 1].at)}</span>
      </div>
    </div>
  );
}
