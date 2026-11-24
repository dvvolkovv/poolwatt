// Localized text for outgoing mail. Strings live in messages/<locale>.json
// under "emails". This reads the JSON directly instead of using next-intl:
// most mails go to someone other than the person making the request, so the
// request locale is the wrong one.

import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from "@/lib/locales";
import en from "../../messages/en.json";

const RTL: ReadonlySet<Locale> = new Set<Locale>(["ar", "he", "fa", "ps", "ur"]);

type Vars = Record<string, string | number>;

export function toLocale(value: string | null | undefined): Locale {
  return SUPPORTED_LOCALES.includes(value as Locale) ? (value as Locale) : DEFAULT_LOCALE;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function lookup(messages: unknown, path: string): string | undefined {
  const value = path
    .split(".")
    .reduce<unknown>((acc, seg) => (acc as Record<string, unknown> | undefined)?.[seg], messages);
  return typeof value === "string" ? value : undefined;
}

function interpolate(template: string, vars: Vars, map: (v: string) => string): string {
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? map(String(vars[name])) : match));
}

export type EmailText = {
  locale: Locale;
  /** Plain text — subjects. */
  text: (key: string, vars?: Vars) => string;
  /** Same string with variables HTML-escaped — bodies. */
  html: (key: string, vars?: Vars) => string;
  /** Wraps paragraphs, setting language and text direction. */
  layout: (...paragraphs: string[]) => string;
};

// Partial locales fall back to English per key, as the site itself does.
export async function emailText(value: string | null | undefined): Promise<EmailText> {
  const locale = toLocale(value);
  const messages = (await import(`../../messages/${locale}.json`)).default;
  const raw = (key: string) => lookup(messages, `emails.${key}`) ?? lookup(en, `emails.${key}`) ?? key;
  return {
    locale,
    // Header injection guard: a subject must stay on one line.
    text: (key, vars = {}) => interpolate(raw(key), vars, (v) => v.replace(/[\r\n]+/g, " ")),
    html: (key, vars = {}) => interpolate(raw(key), vars, escapeHtml),
    layout: (...paragraphs) =>
      `<div lang="${locale}" dir="${RTL.has(locale) ? "rtl" : "ltr"}">\n${paragraphs
        .map((p) => `<p>${p}</p>`)
        .join("\n")}\n</div>`,
  };
}

/** A link followed by its bare URL, so the plain-text part keeps the address. */
export function emailLink(url: string, label: string): string[] {
  const href = escapeHtml(url);
  return [`<a href="${href}">${label}</a>`, `<a href="${href}" dir="ltr">${href}</a>`];
}
