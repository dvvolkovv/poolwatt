import { useTranslations } from "next-intl";
import type { GridSnap } from "@/lib/producers";
import type { GreenIndex } from "@/lib/green-index";
import { greenIndexColor } from "@/lib/green-index";
import {
  formatCompactInCurrency,
  type Currency,
  type ExchangeRates,
} from "@/lib/currency";
import { formatKwh, formatCo2 } from "@/lib/format";

export function GridStatsHero({
  stats,
  currency,
  rates,
  greenIndex,
}: {
  stats: GridSnap | null;
  currency: Currency;
  rates: ExchangeRates | null;
  greenIndex: GreenIndex | null;
}) {
  const t = useTranslations("stats");
  const tg = useTranslations("greenIndex");
  if (!stats) return null;

  const r = rates ?? {};
  const fmtMoney = (n: number) =>
    rates ? formatCompactInCurrency(n, currency, r) : `$${(n / 1e3).toFixed(1)}K`;

  const items = [
    { label: t("totalCapacity"), value: formatKwh(stats.totalCapacityKwh, { compact: true }) },
    { label: t("delivered24h"), value: formatKwh(stats.totalDelivered24hKwh, { compact: true }) },
    { label: t("activeProducers"), value: stats.activeProducers.toLocaleString() },
    { label: t("carbonOffset"), value: formatCo2(stats.carbonOffset24hKgCo2e) },
  ];

  return (
    <div className="space-y-5">
      {items.map((s) => (
        <div
          key={s.label}
          className="flex items-baseline justify-between border-b border-hairline pb-3"
        >
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted">
            {s.label}
          </div>
          <div className="num text-[22px] font-medium">{s.value}</div>
        </div>
      ))}
      {greenIndex && (
        <div className="flex items-baseline justify-between border-b border-hairline pb-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted">
            {t("greenIndex")}
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`num text-[22px] font-medium ${greenIndexColor(greenIndex.classification)}`}>
              {greenIndex.value}
            </span>
            <span className={`text-[11px] uppercase tracking-[0.12em] ${greenIndexColor(greenIndex.classification)}`}>
              {tg(greenIndex.classification)}
            </span>
          </div>
        </div>
      )}
      {/* Footnote: source mix breakdown */}
      <div className="pt-2 grid grid-cols-3 gap-3 text-[11px]">
        <SourceShare label={t("solarShare")} pct={stats.solarSharePct} tone="text-accent" />
        <SourceShare label={t("windShare")} pct={stats.windSharePct} tone="text-blue" />
        <SourceShare label={t("hydroShare")} pct={stats.hydroSharePct} tone="text-info" />
      </div>
    </div>
  );
}

function SourceShare({ label, pct, tone }: { label: string; pct: number; tone: string }) {
  return (
    <div className="border border-hairline rounded-md p-2">
      <div className="uppercase tracking-[0.16em] text-[10px] text-muted">{label}</div>
      <div className={`num text-[15px] font-medium mt-0.5 ${tone}`}>{pct.toFixed(1)}%</div>
    </div>
  );
}
