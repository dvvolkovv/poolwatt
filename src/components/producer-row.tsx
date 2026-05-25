import Link from "next/link";
import type { ProducerRow as ProducerRowT } from "@/lib/producers";
import type { Currency, ExchangeRates } from "@/lib/currency";
import { formatInCurrency } from "@/lib/currency";
import { formatKwh, formatPct, deltaClass } from "@/lib/format";
import { SourceBadge } from "./source-badge";
import { StateOfCharge } from "./state-of-charge";
import { Sparkline } from "./sparkline";

export function ProducerRow({
  row,
  currency,
  rates,
  locale,
}: {
  row: ProducerRowT;
  currency: Currency;
  rates: ExchangeRates | null;
  locale: string;
}) {
  const r = rates ?? { USD: 1 };
  const price = formatInCurrency(row.pricePerKwhUsd, currency, r, {
    maximumFractionDigits: 4,
  });
  return (
    <tr className="border-b border-hairline last:border-0 hover:bg-card-alt/30 transition-colors">
      <td className="px-5 py-4 text-muted num text-sm">{row.rank}</td>
      <td className="px-5 py-4">
        <Link
          href={`/${locale}/p/${row.handle}`}
          className="block group"
        >
          <div className="text-foreground font-medium group-hover:text-accent transition-colors flex items-center gap-2">
            {row.displayName}
            {row.category === "EQUIPMENT_MANUFACTURER" && (
              <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/30">OEM</span>
            )}
          </div>
          <div className="text-muted text-[12px] mt-0.5">
            @{row.handle} · {row.city}, {row.country}
          </div>
          {row.equipment && row.equipment.length > 0 && (
            <div className="text-[11px] text-muted/70 mt-1 leading-tight">
              <span className="text-muted/50">⚙</span> {row.equipment.join(" · ")}
            </div>
          )}
          {row.manufactures && row.manufactures.length > 0 && (
            <div className="text-[11px] text-accent/70 mt-1 leading-tight">
              <span className="text-accent/50">MFG:</span> {row.manufactures.join(" · ")}
            </div>
          )}
        </Link>
      </td>
      <td className="px-5 py-4">
        <SourceBadge source={row.primarySource} />
      </td>
      <td className="px-5 py-4">
        <StateOfCharge pct={row.stateOfChargePct} />
      </td>
      <td className="px-5 py-4 text-right num">{formatKwh(row.availableKwh)}</td>
      <td className="px-5 py-4 text-right num">{price}</td>
      <td className="px-5 py-4 text-right num">{formatKwh(row.delivered24hKwh)}</td>
      <td className={`px-5 py-4 text-right num ${deltaClass(row.pctChange24h)}`}>
        {formatPct(row.pctChange24h, { showSign: true })}
      </td>
      <td className="px-5 py-4">
        <Sparkline data={row.weeklyOutput} />
      </td>
    </tr>
  );
}
