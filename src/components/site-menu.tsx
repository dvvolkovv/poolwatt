"use client";

// Гамбургер сайта. До него на экране телефона у сайта не было навигации
// вовсе: весь ряд ссылок в шапке стоял под `hidden md:flex`, и кнопка «Войти»
// тоже, то есть с телефона нельзя было ни дойти до зарядок, ни зайти.
//
// Одна панель на все ширины: на мониторе её открывает тот же гамбургер рядом
// с коротким рядом ссылок, на телефоне она — вся навигация. Разделы приходят
// из `site-nav.ts`, поэтому меню не может разойтись с подвалом.
//
// Доступность здесь не украшение: панель — это диалог, и она ведёт себя как
// диалог. Escape закрывает, фокус уходит внутрь и возвращается на кнопку,
// страница под панелью не ездит, у кнопки есть `aria-expanded` и
// `aria-controls`, площадь нажатия не меньше 44×44.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { signOut } from "next-auth/react";
import { navHref, type NavGroup } from "@/lib/site-nav";
import { LocaleSwitcher } from "./locale-switcher";

const PANEL_ID = "site-menu-panel";

export function SiteMenu({
  groups,
  locale,
  signedIn,
}: {
  groups: NavGroup[];
  locale: string;
  signedIn: boolean;
}) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Открытость хранится как адрес, на котором панель открыли, а не как флаг.
  // Тогда смена адреса закрывает панель сама, выводом при отрисовке: человек
  // нажал ссылку и уже уехал. Флаг пришлось бы гасить эффектом, а setState
  // внутри эффекта — это лишний проход отрисовки (`react-hooks`).
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt !== null && openedAt === pathname;
  const setOpen = (next: boolean) => setOpenedAt(next ? pathname : null);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenedAt(null);
    };
    document.addEventListener("keydown", onKey);

    // Страница под открытой панелью не скроллится.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Фокус внутрь: первая ссылка панели.
    const first = panelRef.current?.querySelector<HTMLElement>(
      "a[href], button:not([disabled])",
    );
    first?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Закрыли — фокус возвращается туда, откуда его взяли. Это работа с DOM,
  // а не состояние, поэтому эффекту здесь место.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      buttonRef.current?.focus();
    }
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={PANEL_ID}
        aria-label={open ? t("close") : t("open")}
        data-testid="site-menu-button"
        className="inline-flex min-w-[44px] min-h-[44px] items-center justify-center gap-2 rounded-full border border-hairline text-foreground px-3 hover:border-accent/60 transition-colors"
      >
        <span aria-hidden className="flex flex-col gap-[4px]">
          <span className="block w-[18px] h-[2px] bg-current" />
          <span className="block w-[18px] h-[2px] bg-current" />
          <span className="block w-[18px] h-[2px] bg-current" />
        </span>
        <span className="hidden lg:inline text-[11px] font-semibold uppercase tracking-[0.18em]">
          {t("menu")}
        </span>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            ref={panelRef}
            id={PANEL_ID}
            role="dialog"
            aria-modal="true"
            aria-label={t("title")}
            data-testid="site-menu-panel"
            className="fixed right-0 top-0 z-50 h-dvh w-[min(92vw,380px)] overflow-y-auto bg-card border-l border-hairline px-5 py-4"
          >
            <div className="flex items-center justify-between">
              <span className="num text-[11px] uppercase tracking-[0.25em] text-muted">
                {t("title")}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("close")}
                className="inline-flex min-w-[44px] min-h-[44px] items-center justify-center rounded-full text-muted hover:text-foreground transition-colors text-[22px] leading-none"
              >
                <span aria-hidden>×</span>
              </button>
            </div>

            <nav className="mt-4 pb-6">
              {groups.map((group) => (
                <div key={group.key} className="mb-6">
                  <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent mb-2">
                    {t(`groups.${group.key}`)}
                  </h2>
                  <ul>
                    {group.items.map((item) => (
                      <li key={item.href}>
                        <Link
                          href={navHref(locale, item.href)}
                          prefetch={false}
                          onClick={() => setOpen(false)}
                          className="flex min-h-[44px] items-center text-[16px] text-foreground border-b border-hairline hover:text-accent transition-colors"
                        >
                          {t(`items.${item.key}`)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              <div className="pt-2">
                {signedIn ? (
                  <button
                    type="button"
                    onClick={() => void signOut({ callbackUrl: `/${locale}` })}
                    className="flex w-full min-h-[44px] items-center text-[15px] font-semibold text-down"
                  >
                    {tc("signOut")}
                  </button>
                ) : (
                  <Link
                    href={`/${locale}/login`}
                    prefetch={false}
                    onClick={() => setOpen(false)}
                    data-testid="site-menu-signin"
                    className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-blue text-blue-foreground font-semibold text-[13px] uppercase tracking-[0.16em]"
                  >
                    {tc("signIn")}
                  </Link>
                )}
              </div>

              {/* Гостю настроек негде взять, а язык ему нужен: выбор остаётся
                  внизу панели. Подписанный меняет язык в настройках аккаунта,
                  где он ещё и запоминается. */}
              {!signedIn && (
                <div className="mt-6 border-t border-hairline pt-4">
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-muted mb-2">
                    {tc("languageLabel")}
                  </label>
                  <LocaleSwitcher
                    testId="site-menu-language"
                    className="w-full rounded-md border border-hairline bg-bg px-3 py-2 text-[15px] text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              )}
            </nav>
          </div>
        </>
      )}
    </>
  );
}
