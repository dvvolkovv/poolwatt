"use client";

import { usePathname, useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { SUPPORTED_LOCALES, LOCALE_LABELS, type Locale } from "@/lib/locales";

/**
 * Выбор языка. С 2026-11-28 его нет в ряду шапки: он занимал место, которого
 * на телефоне нет. Подписанный меняет язык в настройках аккаунта, где выбор
 * ещё и запоминается; гостю запоминать некуда, поэтому у него выбор живёт
 * внизу панели гамбургера — то есть тоже спрятан, а не брошен.
 */
export function LocaleSwitcher({
  testId,
  className,
}: {
  testId?: string;
  className?: string;
} = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const current = useLocale() as Locale;

  function onChange(next: Locale) {
    if (next === current) return;
    // Persist the explicit choice. next-intl's middleware prefers the
    // NEXT_LOCALE cookie over Accept-Language, so subsequent visits to "/"
    // honour the user's pick instead of bouncing back to their system locale.
    // Without this cookie, a Russian-system user who picks English would land
    // on /ru the next time they hit poolwatt.com.
    document.cookie = `NEXT_LOCALE=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    // Replace the leading /<locale> segment.
    const stripped = pathname.replace(/^\/[a-z]{2}(?:-[A-Z]{2})?/, "");
    router.push(`/${next}${stripped || ""}`);
  }

  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value as Locale)}
      data-testid={testId}
      className={
        className ??
        "bg-card border border-hairline rounded-md text-xs px-2 py-1 text-muted-strong hover:text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
      }
      aria-label="Language"
    >
      {SUPPORTED_LOCALES.map((l) => (
        <option key={l} value={l} className="bg-card text-foreground">
          {LOCALE_LABELS[l]}
        </option>
      ))}
    </select>
  );
}
