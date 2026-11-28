import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { AccountPill } from "./cabinet/account-pill";
import { SiteMenu } from "./site-menu";
import { auth } from "@/lib/auth";
import { navHref, primaryItems, visibleNav } from "@/lib/site-nav";

export async function Navbar() {
  const locale = await getLocale();
  const t = await getTranslations("common");
  const tNav = await getTranslations("nav");
  const session = await auth();

  const ctx = {
    signedIn: Boolean(session?.user),
    operator: session?.user?.role === "ADMIN",
  };
  // Ряд в шапке — только первая группа; всё остальное живёт в той же панели,
  // что и на телефоне, чтобы два меню не разошлись (`site-nav.ts`).
  const primary = primaryItems(ctx);
  const groups = visibleNav(ctx);

  // Что убрано 2026-11-28 и почему: жёлтый значок `.energy` рядом со словом
  // `poolwatt` и выбор языка. Торговая марка — само слово, а список из
  // двадцати девяти языков в ряду шапки занимал место, которого на телефоне
  // нет: вместе с никнеймом и гамбургером ряд не влезал в экран, и вся
  // страница ездила вправо-влево. Язык теперь в настройках аккаунта, а гостю
  // — в панели гамбургера.
  return (
    <header className="sticky top-0 z-30 backdrop-blur-md bg-[rgba(12,16,20,0.85)] border-b border-hairline">
      <div className="max-w-[1600px] mx-auto px-4 md:px-12 xl:px-20 h-16 flex items-center gap-2 md:gap-4">
        <Link
          href={`/${locale}`}
          className="shrink-0"
          aria-label={t("appName")}
        >
          <span className="text-[20px] font-bold tracking-[-0.02em] text-foreground">
            poolwatt
          </span>
        </Link>

        <nav
          className="hidden md:flex items-center gap-6 text-sm text-muted"
          aria-label={tNav("groups.energy")}
        >
          {primary.map((item) => (
            <Link
              key={item.href}
              href={navHref(locale, item.href)}
              prefetch={false}
              className="hover:text-foreground transition-colors"
            >
              {tNav(`items.${item.key}`)}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-2">
          {session?.user ? (
            <AccountPill
              username={session.user.username}
              locale={locale}
              label={t("cabinet")}
            />
          ) : (
            // На мониторе «Войти» остаётся на виду; на телефоне она внутри
            // панели, потому что в ряду шапки для неё нет места.
            <Link
              href={`/${locale}/login`}
              prefetch={false}
              className="hidden md:inline-flex min-h-[44px] items-center px-4 rounded-full font-semibold text-xs uppercase tracking-wider bg-blue text-blue-foreground transition-all hover:brightness-110"
            >
              {t("signIn")}
            </Link>
          )}
          <SiteMenu groups={groups} locale={locale} signedIn={ctx.signedIn} />
        </div>
      </div>
    </header>
  );
}
