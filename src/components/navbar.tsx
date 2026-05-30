import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "./locale-switcher";

export async function Navbar() {
  const locale = await getLocale();
  const t = await getTranslations("common");

  return (
    <header className="sticky top-0 z-30 backdrop-blur-md bg-[rgba(12,16,20,0.85)] border-b border-hairline">
      <div className="max-w-[1600px] mx-auto px-6 md:px-12 xl:px-20 h-16 flex items-center gap-4">
        <Link
          href={`/${locale}`}
          className="flex items-baseline gap-2"
          aria-label={t("appName")}
        >
          <span className="text-[20px] font-bold tracking-[-0.02em] text-foreground">
            poolwatt
          </span>
          <span className="num text-[10px] font-medium uppercase tracking-[0.25em] px-1.5 py-0.5 rounded-sm text-accent border border-accent/40">
            .energy
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-6 text-sm text-muted">
          <Link href={`/${locale}`} className="hover:text-foreground transition-colors">
            {t("producers")}
          </Link>
          {/* Phase-2 routes — prefetch disabled until /hubs, /offers, /watchlist
              and /request actually exist; otherwise every landing visit fires
              a stream of 404 RSC prefetches into the browser console. */}
          <Link href={`/${locale}/hubs`} prefetch={false} className="hover:text-foreground transition-colors">
            {t("hubs")}
          </Link>
          <Link href={`/${locale}/offers`} prefetch={false} className="hover:text-foreground transition-colors">
            {t("offers")}
          </Link>
          <Link href={`/${locale}/navigator`} className="hover:text-foreground transition-colors">
            {t("navigator")}
          </Link>
          <Link href={`/${locale}/watchlist`} prefetch={false} className="hover:text-foreground transition-colors">
            {t("watchlist")}
          </Link>
          <Link href={`/${locale}/request`} prefetch={false} className="hover:text-foreground transition-colors">
            {t("request")}
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <LocaleSwitcher />
          <Link
            href={`/${locale}/login`}
            prefetch={false}
            className="hidden md:inline-block ml-2 text-xs px-4 py-1.5 rounded-full font-semibold uppercase tracking-wider bg-blue text-blue-foreground transition-all hover:brightness-110"
          >
            {t("signIn")}
          </Link>
        </div>
      </div>
    </header>
  );
}
