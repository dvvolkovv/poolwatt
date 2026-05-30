import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { PublicContractor } from "@/lib/contractor-queries";

type Props = {
  locale: string;
  contractor: Pick<
    PublicContractor,
    "slug" | "displayName" | "entityType" | "country" | "city" |
    "workCategories" | "renewableTypes" | "logoUrl" | "providesEvCharging"
  >;
};

export async function ContractorCard({ locale, contractor: c }: Props) {
  const t = await getTranslations("cabinet.contractor");
  const tPublic = await getTranslations("public.contractor.detail");

  const initial = c.displayName.charAt(0).toUpperCase();
  const topWorks = c.workCategories.slice(0, 2);
  const topRenewables = c.renewableTypes.slice(0, 2);

  return (
    <Link
      href={`/${locale}/contractors/${c.slug}`}
      prefetch={false}
      className="block border border-hairline rounded-lg p-5 hover:border-accent transition-colors bg-card"
    >
      <div className="flex items-start gap-3 mb-3">
        {c.logoUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={c.logoUrl}
            alt={`${c.displayName} logo`}
            className="w-12 h-12 rounded object-cover border border-hairline"
          />
        ) : (
          <div className="w-12 h-12 rounded bg-foreground/10 flex items-center justify-center font-bold text-lg text-muted">
            {initial}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-[15px] truncate">{c.displayName}</h3>
          <p className="text-xs text-muted truncate">
            {t(`field.entityType.${c.entityType}`)} · {c.city}, {c.country}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 mt-3">
        {topWorks.map((w) => (
          <span key={w} className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-foreground/5 text-muted">
            {t(`field.workCategories.${w}`)}
          </span>
        ))}
        {topRenewables.map((r) => (
          <span key={r} className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-accent/10 text-accent">
            {t(`field.renewableTypes.${r}`)}
          </span>
        ))}
        {c.providesEvCharging && (
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-700 dark:text-yellow-300">
            ⚡ {tPublic("evBadge")}
          </span>
        )}
      </div>
    </Link>
  );
}
