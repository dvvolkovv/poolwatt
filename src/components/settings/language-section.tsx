"use client";

// Язык в настройках аккаунта. До 2026-11-28 выбор языка стоял в ряду шапки и
// только ставил cookie: колонка `User.preferredLocale` была, её читали письма
// (`emailText(owner.preferredLocale)`), а записать её было нечем — поэтому
// человек, который выбрал в шапке русский, продолжал получать письма
// по-английски.
//
// Здесь выбор делает три вещи за одно нажатие: пишет колонку серверным
// действием, ставит cookie `NEXT_LOCALE` (её предпочитает посредник
// next-intl, иначе следующий заход на «/» вернул бы язык системы) и уводит на
// тот же адрес в новом языке.

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SUPPORTED_LOCALES, LOCALE_LABELS, type Locale } from "@/lib/locales";
import { updatePreferencesAction } from "@/app/[locale]/me/settings/actions";

export function LanguageSection({
  current,
  labels,
}: {
  current: Locale;
  labels: { title: string; help: string; submit: string };
}) {
  const [value, setValue] = useState<Locale>(current);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();

  function save() {
    startTransition(async () => {
      const form = new FormData();
      form.set("locale", value);
      await updatePreferencesAction({}, form);
      document.cookie = `NEXT_LOCALE=${value}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
      const stripped = pathname.replace(/^\/[a-z]{2}(?:-[A-Z]{2})?/, "");
      router.replace(`/${value}${stripped || ""}`);
      router.refresh();
    });
  }

  return (
    <section className="border-t border-hairline pt-8">
      <h2 className="text-[18px] font-semibold mb-1">{labels.title}</h2>
      <p className="text-[13px] text-muted mb-4">{labels.help}</p>
      <div className="max-w-md space-y-3">
        <select
          value={value}
          onChange={(e) => setValue(e.target.value as Locale)}
          data-testid="settings-language"
          aria-label={labels.title}
          className="w-full rounded-md border border-hairline bg-card px-3 py-2 text-[15px] text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
        >
          {SUPPORTED_LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_LABELS[l]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          data-testid="settings-language-save"
          className="border border-hairline hover:border-accent rounded-md px-4 py-2 text-[13px] font-semibold uppercase tracking-[0.12em] disabled:opacity-60 transition-colors"
        >
          {labels.submit}
        </button>
      </div>
    </section>
  );
}
