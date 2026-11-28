import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { navHref, visibleNav } from "@/lib/site-nav";

export async function Footer() {
  const t = await getTranslations("common");
  const tf = await getTranslations("footer");
  const tb = await getTranslations("bot");
  const tNav = await getTranslations("nav");
  const locale = await getLocale();
  const year = new Date().getFullYear();
  const session = await auth();

  // Подвал читает те же разделы, что шапка и гамбургер (`site-nav.ts`). До
  // этого у него был свой список, и в нём жили `/hubs`, `/offers` и
  // `/settings` — все три отдавали 404.
  const groups = visibleNav({
    signedIn: Boolean(session?.user),
    operator: session?.user?.role === "ADMIN",
  });

  return (
    <footer className="mt-20 bg-bg-tint border-t border-hairline">
      <div className="max-w-[1600px] mx-auto px-6 md:px-12 xl:px-20 py-10 md:py-16">
        {/* Двенадцать колонок — только с планшета. На телефоне одиннадцать
            промежутков по 32 точки (352) сами по себе шире экрана, и подвал
            растягивал страницу на каждой странице сайта: именно от этого
            кабинет ездил вправо-влево. */}
        <div className="grid gap-8 md:grid-cols-12">
          {/* Brand + tagline */}
          <div className="md:col-span-4">
            <div className="flex items-baseline gap-2 mb-3">
              <span className="text-[18px] font-bold tracking-[-0.02em] text-foreground">
                poolwatt
              </span>
              <span className="num text-[10px] font-medium uppercase tracking-[0.25em] px-1.5 py-0.5 rounded-sm text-accent border border-accent/40">
                .energy
              </span>
            </div>
            <p className="text-[14px] leading-[1.6] max-w-[440px] text-muted">
              {t("tagline")}
            </p>
            <p className="mt-4 text-[12px] leading-[1.6] max-w-[440px] text-muted">
              {tb("siblingNote")}
            </p>
            <div className="mt-6">
              <div className="text-[10px] uppercase tracking-[0.18em] mb-2 text-muted">
                {tf("section.data")}
              </div>
              <p className="text-[12px] leading-[1.6] max-w-[440px] text-muted">
                {tf("dataNote")}
              </p>
            </div>
            {!session?.user && (
              <Link
                href={`/${locale}/login`}
                prefetch={false}
                className="mt-6 inline-flex min-h-[44px] items-center text-[14px] font-semibold text-accent hover:brightness-110"
              >
                {t("signIn")}
              </Link>
            )}
          </div>

          {/* Разделы — своей сеткой внутри, чтобы их число могло меняться
              вместе с правами человека и не ломало внешние 12 колонок. */}
          <div className="grid grid-cols-2 gap-8 md:col-span-8 lg:grid-cols-4">
            {groups.map((group) => (
              <div key={group.key}>
                <div className="text-[10px] uppercase tracking-[0.18em] mb-3 text-muted">
                  {tNav(`groups.${group.key}`)}
                </div>
                <ul className="space-y-2 text-[14px]">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={navHref(locale, item.href)}
                        prefetch={false}
                        className="inline-flex min-h-[32px] items-center text-muted hover:text-foreground transition-colors"
                      >
                        {tNav(`items.${item.key}`)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-hairline flex flex-col md:flex-row md:justify-between gap-6">
          <div className="text-[11px] leading-[1.7] text-muted/70 max-w-[420px]">
            <span className="font-medium text-muted">Elektrárenská a.s.</span>
            <br />
            Mlynské nivy&nbsp;II. 18884/52B, 821&nbsp;05 Bratislava
            <br />
            IČO:&nbsp;<span className="num">35806842</span> &middot; DIČ:&nbsp;
            <span className="num">2020258867</span> &middot; IČ&nbsp;DPH:&nbsp;
            <span className="num">SK2020258867</span>
            <br />
            Obch. register OS&nbsp;BA&nbsp;III, Sa, vl.&nbsp;č.&nbsp;
            <span className="num">2664</span>/B
          </div>

          <div className="flex flex-col items-start md:items-end justify-end gap-1 num text-[11px] uppercase tracking-[0.18em] text-muted">
            <div>
              &copy; {year} {t("appName")}
            </div>
            <div>v0.1.0 &middot; MMXXVI</div>
          </div>
        </div>
      </div>
    </footer>
  );
}
