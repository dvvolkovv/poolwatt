import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import {
  readTopProducers,
  readGridStats,
  readExchangeRates,
  readGreenIndex,
  readNews,
} from "@/lib/snapshot";
import { GridStatsHero } from "@/components/grid-stats-hero";
import { ProducerListClient } from "@/components/producer-list-client";
import { NewsRail } from "@/components/news-rail";
import { getCurrency } from "@/lib/get-currency";
import type { NewsTheme } from "@/lib/news";
import { auth } from "@/lib/auth";
import { readFavoriteProducerHandles } from "@/lib/favorites";
import { ContractorsBlock } from "@/components/contractor/contractors-block";

export const revalidate = 60;

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tl = await getTranslations("listing");
  const th = await getTranslations("home");
  const tNav = await getTranslations("nav");

  const session = await auth();
  const [rows, stats, rates, currency, greenIndex, news, favoriteHandles] =
    await Promise.all([
      readTopProducers(),
      readGridStats(),
      readExchangeRates(),
      getCurrency(),
      readGreenIndex(),
      readNews(),
      session?.user
        ? readFavoriteProducerHandles(session.user.id)
        : Promise.resolve(new Set<string>()),
    ]);
  const signedIn = !!session?.user;

  const newsLabels: Record<NewsTheme, string> = {
    solar: th("newsflow.categories.solar"),
    wind: th("newsflow.categories.wind"),
    storage: th("newsflow.categories.storage"),
    grid: th("newsflow.categories.grid"),
    policy: th("newsflow.categories.policy"),
    general: th("newsflow.categories.general"),
  };

  return (
    <main className="bg-bg">
      <div className="max-w-[1600px] mx-auto px-4 md:px-12 xl:px-20">
        {/* HERO */}
        <section className="py-12 md:py-28">
          <div className="grid grid-cols-12 gap-8 items-end">
            <div className="col-span-12 lg:col-span-8">
              <div className="num text-[11px] uppercase tracking-[0.3em] text-up mb-6 inline-flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full bg-up animate-pulse"
                  aria-hidden
                />
                {th("heroEyebrow")}
              </div>
              <h1 className="text-[42px] sm:text-[60px] md:text-[88px] lg:text-[112px] leading-[0.92] tracking-[-0.045em] font-black">
                {th("heroLine1")}
                <br />
                {th("heroLine2Before")}
                <span className="italic font-extrabold text-accent">
                  {th("heroLine2Accent")}
                </span>
                {th("heroLine2After")}
              </h1>
              <p className="mt-8 max-w-[640px] text-[15px] md:text-[18px] lg:text-[20px] leading-[1.5] font-light text-muted">
                {th("heroSubtitle")}
              </p>
              {/* Одно главное действие и два ровных второстепенных. На
                  телефоне главная кнопка во всю ширину, остальные пополам:
                  до этого три кнопки одного веса переносились в три строки.
                  Высота не меньше 44 пикселей на всех ширинах. */}
              <div className="mt-10 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
                <Link
                  href={`/${locale}/navigator`}
                  className="inline-flex min-h-[48px] w-full sm:w-auto items-center justify-center gap-2 px-6 rounded-full font-semibold text-[13px] uppercase tracking-[0.18em] bg-accent text-accent-foreground glow-accent transition-all hover:brightness-110"
                >
                  <span aria-hidden>⚡</span> {tNav("items.chargers")}
                </Link>
                <div className="flex gap-3">
                  <Link
                    href="#producers"
                    className="inline-flex min-h-[44px] flex-1 sm:flex-none items-center justify-center px-5 rounded-full font-semibold text-[12px] sm:text-[13px] uppercase tracking-[0.14em] border border-hairline text-muted-strong hover:text-foreground hover:border-accent/60 transition-all"
                  >
                    {th("ctaPrimary")}
                  </Link>
                  <Link
                    href={`/${locale}/me/build-requests/new`}
                    prefetch={false}
                    className="inline-flex min-h-[44px] flex-1 sm:flex-none items-center justify-center px-5 rounded-full font-semibold text-[12px] sm:text-[13px] uppercase tracking-[0.14em] border border-hairline text-muted-strong hover:text-foreground hover:border-accent/60 transition-all"
                  >
                    {th("ctaSecondary")}
                  </Link>
                </div>
              </div>
            </div>
            <div className="col-span-12 lg:col-span-4">
              <GridStatsHero
                stats={stats}
                currency={currency}
                rates={rates}
                greenIndex={greenIndex}
              />
            </div>
          </div>
        </section>

        {/* NEWSFLOW BANNER */}
        {news.length > 0 && (
          <section className="pb-12">
            <div className="flex items-baseline justify-between mb-5">
              <div className="num text-[11px] uppercase tracking-[0.3em] text-accent inline-flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-accent" aria-hidden />
                {th("newsflow.eyebrow")}
              </div>
              <span className="hidden sm:inline text-muted text-[12px] font-light">
                {th("newsflow.subtitle")}
              </span>
            </div>
            <NewsRail items={news} locale={locale} labels={newsLabels} />
          </section>
        )}

        {/* PRODUCER TABLE */}
        <section id="producers" className="py-12 scroll-mt-24">
          <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-2">
            Section · I
          </div>
          <h2 className="text-[32px] md:text-[40px] font-bold tracking-[-0.03em] mb-8">
            Top producers.
          </h2>
          {rows.length > 0 ? (
            <ProducerListClient
              rows={rows}
              currency={currency}
              rates={rates}
              locale={locale}
              favoriteHandles={favoriteHandles}
              signedIn={signedIn}
            />
          ) : (
            <p className="text-muted">{tl("loadingFallback")}</p>
          )}
        </section>

        <ContractorsBlock locale={locale} />
      </div>
    </main>
  );
}
