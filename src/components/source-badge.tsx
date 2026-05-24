import { useTranslations } from "next-intl";
import type { RenewableSource } from "@/lib/producers";

const SOURCE_GLYPH: Record<RenewableSource, string> = {
  SOLAR: "☀",
  WIND: "🜂",
  HYDRO: "🜄",
  BIOMASS: "🌿",
  GEOTHERMAL: "♨",
  HYBRID: "⚡",
};

const SOURCE_TINT: Record<RenewableSource, string> = {
  SOLAR: "text-accent border-accent/40 bg-accent/5",
  WIND: "text-blue border-blue/40 bg-blue/5",
  HYDRO: "text-info border-info/40 bg-info/5",
  BIOMASS: "text-green border-green/40 bg-green/5",
  GEOTHERMAL: "text-down border-down/40 bg-down/5",
  HYBRID: "text-muted-strong border-hairline bg-card-alt/40",
};

export function SourceBadge({ source }: { source: RenewableSource }) {
  const t = useTranslations("source");
  const tint = SOURCE_TINT[source] ?? SOURCE_TINT.HYBRID;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-[0.18em] border ${tint}`}
    >
      <span aria-hidden className="text-[12px] leading-none">
        {SOURCE_GLYPH[source]}
      </span>
      {t(source)}
    </span>
  );
}
