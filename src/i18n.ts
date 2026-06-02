import { getRequestConfig } from "next-intl/server";
import { notFound } from "next/navigation";
import { SUPPORTED_LOCALES, type Locale } from "@/lib/locales";
import enMessages from "../messages/en.json";

// 26 of our 29 locales are intentionally partial — translators backfill
// new namespaces (cabinet.*, claim.*, …) lazily, and the en/ru/sk trio
// is the only one guaranteed-complete. Surface English text for any key
// the user's locale hasn't translated yet, and stop logging it as an
// error so PM2 logs don't drown in MISSING_MESSAGE during gradual rollout.
function lookupEnglish(path: string): string | undefined {
  const value = path.split(".").reduce<unknown>(
    (acc, seg) =>
      typeof acc === "object" && acc !== null
        ? (acc as Record<string, unknown>)[seg]
        : undefined,
    enMessages as unknown,
  );
  return typeof value === "string" ? value : undefined;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = (await requestLocale) as Locale | undefined;
  if (!locale || !SUPPORTED_LOCALES.includes(locale)) notFound();
  const messages = (await import(`../messages/${locale}.json`)).default;
  return {
    locale,
    messages,
    onError(error) {
      if (error.code === "MISSING_MESSAGE") return;
      console.error(error);
    },
    getMessageFallback({ namespace, key }) {
      const path = namespace ? `${namespace}.${key}` : key;
      return lookupEnglish(path) ?? path;
    },
  };
});
