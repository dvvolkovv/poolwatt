// Poolwatt Phase 1 ships with two locales. The reference project (trientes)
// supports 10 — we'll expand here once the wording stabilises (es, de, fr,
// pt-BR, zh-CN, ja, ko, tr planned). Add a locale by:
//   1) appending it here
//   2) creating messages/<locale>.json
//   3) translating LOCALE_LABELS below

export const SUPPORTED_LOCALES = ["en", "ru"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  ru: "Русский",
};
