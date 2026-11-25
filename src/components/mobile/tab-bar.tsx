"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { TAB_HREF, type MobileTab } from "@/lib/mobile/tabs";

/** One glyph per tab. Text fonts only — no icon dependency for a bar of five. */
const GLYPH: Record<MobileTab, string> = {
  home: "⌂",
  wallet: "⚡",
  charge: "⌁",
  more: "⊞",
  profile: "☻",
};

export function TabBar({ tabs, locale }: { tabs: MobileTab[]; locale: string }) {
  const pathname = usePathname() ?? "";
  const t = useTranslations("app.tabs");
  const root = `/${locale}/app`;

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 border-t border-hairline
                 bg-[rgba(12,16,20,0.95)] backdrop-blur-md
                 pb-[env(safe-area-inset-bottom)]"
      aria-label={t("home")}
    >
      <ul className="flex">
        {tabs.map((tab) => {
          const href = `${root}${TAB_HREF[tab]}`;
          const active = tab === "home" ? pathname === root : pathname.startsWith(href);
          return (
            <li key={tab} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                data-tab={tab}
                className={`flex flex-col items-center gap-1 py-2.5 text-[10px]
                            uppercase tracking-[0.12em] transition-colors
                            ${active ? "text-accent" : "text-muted"}`}
              >
                <span aria-hidden className="text-[20px] leading-none">
                  {GLYPH[tab]}
                </span>
                {t(tab)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
