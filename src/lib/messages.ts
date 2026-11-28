// Английский как основание под каждым языком.
//
// 26 переводов из 29 неполны нарочно — переводчики добирают разделы по мере
// появления. На сервере недостающую **строку** подменял `getMessageFallback`
// в `src/i18n.ts`, и этого хватало ровно до тех пор, пока у языка нет целого
// раздела: клиентский компонент получает свои переводы не от сервера, а от
// `NextIntlClientProvider`, и `useTranslations("nav")` на языке без раздела
// `nav` бросает `MISSING_MESSAGE` прямо в браузере. Гамбургер после этого
// рисует служебные ключи вместо названий разделов.
//
// Поэтому словарь языка кладётся поверх английского, а не вместо него.

export type Messages = Record<string, unknown>;

const isObject = (value: unknown): value is Messages =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Словарь `override` поверх `base`, вглубь. Исходные объекты не меняются:
 * `base` — это общий для всех запросов английский словарь.
 */
export function mergeMessages(base: Messages, override: Messages): Messages {
  const out: Messages = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = out[key];
    out[key] =
      isObject(current) && isObject(value)
        ? mergeMessages(current, value)
        : value;
  }
  return out;
}
