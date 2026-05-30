import Link from "next/link";
import type { ProducerRow as ProducerRowT } from "@/lib/producers";
import type { Currency, ExchangeRates } from "@/lib/currency";
import { formatInCurrency } from "@/lib/currency";
import { formatKwh, formatPct, deltaClass } from "@/lib/format";
import { SourceBadge } from "./source-badge";
import { StateOfCharge } from "./state-of-charge";
import { Sparkline } from "./sparkline";
import { FavoriteButton } from "./favorite-button";

export function ProducerCardMobile({
  row,
  currency,
  rates,
  locale,
  isFavorite,
  signedIn,
}: {
  row: ProducerRowT;
  currency: Currency;
  rates: ExchangeRates | null;
  locale: string;
  isFavorite: boolean;
  signedIn: boolean;
}) {
  const r = rates ?? { USD: 1 };
  const price = formatInCurrency(row.pricePerKwhUsd, currency, r, {
    maximumFractionDigits: 4,
  });
  return (
    <div className="relative bg-card border border-hairline rounded-[16px] p-4 hover:border-accent/60 transition-colors">
      <div className="absolute top-3 right-3">
        <FavoriteButton
          kind="producer"
          id={row.handle}
          initial={isFavorite}
          signedIn={signedIn}
          size="sm"
        />
      </div>
      <Link
        href={`/${locale}/p/${row.handle}`}
        className="block"
      >
      <div className="flex items-start justify-between gap-3 pr-10">
        <div className="min-w-0">
          <div className="text-muted num text-[11px]">#{row.rank}</div>
          <div className="text-foreground font-semibold truncate">{row.displayName}</div>
          <div className="text-muted text-[12px] mt-0.5 truncate">
            @{row.handle} · {row.city}, {row.country}
          </div>
        </div>
        <SourceBadge source={row.primarySource} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
        <div>
          <div className="text-muted uppercase tracking-[0.16em] text-[10px]">Charge</div>
          <div className="mt-1"><StateOfCharge pct={row.stateOfChargePct} /></div>
        </div>
        <div className="text-right">
          <div className="text-muted uppercase tracking-[0.16em] text-[10px]">Price / kWh</div>
          <div className="num text-foreground mt-1">{price}</div>
        </div>
        <div>
          <div className="text-muted uppercase tracking-[0.16em] text-[10px]">Available</div>
          <div className="num text-foreground mt-1">{formatKwh(row.availableKwh)}</div>
        </div>
        <div className="text-right">
          <div className="text-muted uppercase tracking-[0.16em] text-[10px]">24h</div>
          <div className={`num mt-1 ${deltaClass(row.pctChange24h)}`}>
            {formatPct(row.pctChange24h, { showSign: true })}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-muted text-[11px]">{formatKwh(row.delivered24hKwh)} / 24h</span>
        <Sparkline data={row.weeklyOutput} width={96} height={24} />
      </div>
      </Link>
    </div>
  );
}
