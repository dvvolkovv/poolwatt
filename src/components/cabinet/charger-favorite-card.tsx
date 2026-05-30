import Link from "next/link";
import type { ChargerStation } from "@/lib/chargers";

// Compact card for a single favorited charger. Clicking opens the full
// /c/[id] detail page. Status dot uses --color-up for operational and
// --color-down for anything else.

const STATUS_COLOR: Record<string, string> = {
  operational: "bg-up",
  planned: "bg-muted",
  temporarily_unavailable: "bg-down",
  removed: "bg-down",
};

export function ChargerFavoriteCard({
  charger,
  locale,
}: {
  charger: ChargerStation;
  locale: string;
}) {
  const maxPower = charger.maxPowerKw;
  return (
    <Link
      href={`/${locale}/c/${charger.id}`}
      prefetch={false}
      className="group block border border-hairline rounded-xl p-5 bg-card hover:border-accent/40 hover:bg-bg-tint transition-colors"
    >
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h3 className="text-[15px] font-semibold leading-tight group-hover:text-accent transition-colors line-clamp-2">
          {charger.title}
        </h3>
        <span
          className={
            "w-2 h-2 rounded-full shrink-0 mt-1 " +
            (STATUS_COLOR[charger.status] ?? "bg-muted")
          }
          aria-label={charger.status}
        />
      </div>
      <div className="text-[12px] text-muted mb-3 line-clamp-1">{charger.address}</div>
      <div className="flex items-center justify-between text-[11px] num">
        <span className="text-muted uppercase tracking-[0.14em]">{charger.operator}</span>
        <span className="text-foreground">{maxPower} kW</span>
      </div>
    </Link>
  );
}
