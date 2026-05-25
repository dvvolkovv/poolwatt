// Poolwatt Phase 1 ships with two locales. The reference project (trientes)
// supports 10 — we'll expand here once the wording stabilises (es, de, fr,
// pt-BR, zh-CN, ja, ko, tr planned). Add a locale by:
//   1) appending it here
//   2) creating messages/<locale>.json
//   3) translating LOCALE_LABELS below

export const SUPPORTED_LOCALES = [
  "en", "ru", "de", "sk", "pl", "es", "it", "fr", "uk", "ja", "zh", "ar",
  "ro", "ka", "uz", "tg", "tk", "tr", "az", "kk", "ce", "he", "fa",
  "vi", "ko", "th", "hi", "ps", "ur",
] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  ru: "Русский",
  de: "Deutsch",
  sk: "Slovenčina",
  pl: "Polski",
  es: "Español",
  it: "Italiano",
  fr: "Français",
  uk: "Українська",
  ja: "日本語",
  zh: "中文",
  ar: "العربية",
  ro: "Română",
  ka: "ქართული",
  uz: "Oʻzbekcha",
  tg: "Тоҷикӣ",
  tk: "Türkmen",
  tr: "Türkçe",
  az: "Azərbaycanca",
  kk: "Қазақша",
  ce: "Нохчийн",
  he: "עברית",
  fa: "فارسی",
  vi: "Tiếng Việt",
  ko: "한국어",
  th: "ไทย",
  hi: "हिन्दी",
  ps: "پښتو",
  ur: "اردو",
};
