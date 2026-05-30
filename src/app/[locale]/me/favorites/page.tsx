import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import {
  readFavoriteProducers,
  readFavoriteChargers,
} from "@/lib/favorites";
import { ProducerListClient } from "@/components/producer-list-client";
import { getCurrency } from "@/lib/get-currency";
import { readExchangeRates } from "@/lib/snapshot";
import { ChargerFavoriteCard } from "@/components/cabinet/charger-favorite-card";

type Tab = "producers" | "chargers";

export default async function FavoritesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale } = await params;
  const { tab: tabParam } = await searchParams;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/favorites`);

  const tab: Tab = tabParam === "chargers" ? "chargers" : "producers";
  const t = await getTranslations("cabinet.favorites");

  const [producers, chargers, currency, rates] = await Promise.all([
    readFavoriteProducers(session.user.id),
    readFavoriteChargers(session.user.id),
    getCurrency(),
    readExchangeRates(),
  ]);

  return (
    <div>
      <h1 className="text-[28px] md:text-[32px] font-bold tracking-[-0.02em] mb-6">
        {t("title")}
      </h1>

      <div className="flex gap-1 border-b border-hairline mb-8">
        <TabLink
          locale={locale}
          target="producers"
          active={tab === "producers"}
          count={producers.length}
        >
          {t("tabProducers")}
        </TabLink>
        <TabLink
          locale={locale}
          target="chargers"
          active={tab === "chargers"}
          count={chargers.length}
        >
          {t("tabChargers")}
        </TabLink>
      </div>

      {tab === "producers" &&
        (producers.length === 0 ? (
          <EmptyState
            title={t("emptyProducersTitle")}
            body={t("emptyProducersBody")}
            locale={locale}
            ctaHref={`/${locale}#producers`}
          />
        ) : (
          <ProducerListClient
            rows={producers}
            currency={currency}
            rates={rates}
            locale={locale}
            favoriteHandles={new Set(producers.map((p) => p.handle))}
            signedIn={true}
          />
        ))}

      {tab === "chargers" &&
        (chargers.length === 0 ? (
          <EmptyState
            title={t("emptyChargersTitle")}
            body={t("emptyChargersBody")}
            locale={locale}
            ctaHref={`/${locale}/navigator`}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {chargers.map((c) => (
              <ChargerFavoriteCard key={c.id} charger={c} locale={locale} />
            ))}
          </div>
        ))}
    </div>
  );
}

function TabLink({
  locale,
  target,
  active,
  count,
  children,
}: {
  locale: string;
  target: Tab;
  active: boolean;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={`/${locale}/me/favorites?tab=${target}`}
      className={
        "px-4 py-3 text-[13px] uppercase tracking-[0.16em] font-semibold border-b-2 -mb-px transition-colors " +
        (active
          ? "border-accent text-foreground"
          : "border-transparent text-muted hover:text-foreground")
      }
    >
      {children}
      <span className="ml-2 num text-[11px] text-muted">{count}</span>
    </Link>
  );
}

function EmptyState({
  title,
  body,
  ctaHref,
}: {
  title: string;
  body: string;
  locale: string;
  ctaHref: string;
}) {
  // Body has [bracketed text] placeholders we turn into the CTA link.
  const parts = body.split(/(\[[^\]]+\])/g);
  return (
    <div className="border border-dashed border-hairline rounded-2xl py-16 px-8 text-center">
      <div className="text-[24px] mb-3">☆</div>
      <h2 className="text-[18px] font-semibold mb-3 text-muted-strong">{title}</h2>
      <p className="text-[14px] text-muted max-w-sm mx-auto leading-relaxed">
        {parts.map((seg, i) =>
          seg.startsWith("[") && seg.endsWith("]") ? (
            <Link key={i} href={ctaHref} className="text-accent hover:underline">
              {seg.slice(1, -1)}
            </Link>
          ) : (
            <span key={i}>{seg}</span>
          ),
        )}
      </p>
    </div>
  );
}
