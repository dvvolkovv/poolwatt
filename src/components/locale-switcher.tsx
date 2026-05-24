"use client";

import { usePathname, useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { SUPPORTED_LOCALES, LOCALE_LABELS, type Locale } from "@/lib/locales";

export function LocaleSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const current = useLocale() as Locale;

  function onChange(next: Locale) {
    if (next === current) return;
    // Replace the leading /<locale> segment.
    const stripped = pathname.replace(/^\/[a-z]{2}(?:-[A-Z]{2})?/, "");
    router.push(`/${next}${stripped || ""}`);
  }

  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value as Locale)}
      className="bg-card border border-hairline rounded-md text-xs px-2 py-1 text-muted-strong hover:text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
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
