import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

export async function Footer() {
  const t = await getTranslations("common");
  const tf = await getTranslations("footer");
  const tb = await getTranslations("bot");
  const locale = await getLocale();
  const year = new Date().getFullYear();

  return (
    <footer className="mt-20 bg-bg-tint border-t border-hairline">
      <div className="max-w-[1600px] mx-auto px-6 md:px-12 xl:px-20 py-10 md:py-16">
        <div className="grid grid-cols-12 gap-8">
          {/* Brand + tagline */}
          <div className="col-span-12 md:col-span-5">
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
          </div>

          {/* Grid links */}
          <div className="col-span-6 md:col-span-2">
            <div className="text-[10px] uppercase tracking-[0.18em] mb-3 text-muted">
              {tf("section.grid")}
            </div>
            <ul className="space-y-2 text-[14px]">
              <li>
                <Link href={`/${locale}`} className="text-muted hover:text-foreground transition-colors">
                  {t("producers")}
                </Link>
              </li>
              <li>
                <Link href={`/${locale}/hubs`} className="text-muted hover:text-foreground transition-colors">
                  {t("hubs")}
                </Link>
              </li>
              <li>
                <Link href={`/${locale}/offers`} className="text-muted hover:text-foreground transition-colors">
                  {t("offers")}
                </Link>
              </li>
            </ul>
          </div>

          {/* Account */}
          <div className="col-span-6 md:col-span-2">
            <div className="text-[10px] uppercase tracking-[0.18em] mb-3 text-muted">
              {tf("section.account")}
            </div>
            <ul className="space-y-2 text-[14px]">
              <li>
                <Link href={`/${locale}/login`} className="text-muted hover:text-foreground transition-colors">
                  {t("signIn")}
                </Link>
              </li>
              <li>
                <Link href={`/${locale}/settings`} className="text-muted hover:text-foreground transition-colors">
                  {t("settings")}
                </Link>
              </li>
              <li>
                <Link href={`/${locale}/request`} className="text-muted hover:text-foreground transition-colors">
                  {t("request")}
                </Link>
              </li>
            </ul>
          </div>

          {/* Data */}
          <div className="col-span-12 md:col-span-3">
            <div className="text-[10px] uppercase tracking-[0.18em] mb-3 text-muted">
              {tf("section.data")}
            </div>
            <p className="text-[12px] leading-[1.6] text-muted">
              {tf("dataNote")}
            </p>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-hairline flex flex-col md:flex-row md:justify-between gap-6">
          <div className="text-[11px] leading-[1.7] text-muted/70 max-w-[420px]">
            <span className="font-medium text-muted">Elektrárenská a.s.</span>
            <br />
            Mlynské nivy&nbsp;II. 18884/52B, 821&nbsp;05 Bratislava
            <br />
            IČO:&nbsp;<span className="num">35806842</span> &middot;
            DIČ:&nbsp;<span className="num">2020258867</span> &middot;
            IČ&nbsp;DPH:&nbsp;<span className="num">SK2020258867</span>
            <br />
            Obch. register OS&nbsp;BA&nbsp;III, Sa, vl.&nbsp;č.&nbsp;<span className="num">2664</span>/B
          </div>

          <div className="flex flex-col items-start md:items-end justify-end gap-1 num text-[11px] uppercase tracking-[0.18em] text-muted">
            <div>&copy; {year} {t("appName")}</div>
            <div>v0.1.0 &middot; MMXXVI</div>
          </div>
        </div>
      </div>
    </footer>
  );
}
