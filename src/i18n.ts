import { getRequestConfig } from "next-intl/server";
import { notFound } from "next/navigation";
import { SUPPORTED_LOCALES, type Locale } from "@/lib/locales";
import enMessages from "../messages/en.json";
import { mergeMessages, type Messages } from "@/lib/messages";

// 26 of our 29 locales are intentionally partial — translators backfill
// new namespaces (cabinet.*, claim.*, …) lazily, and the en/ru/sk trio
// is the only one guaranteed-complete. English is therefore laid under
// every locale as a base (`mergeMessages`), which matters most for client
// components: they get their messages from NextIntlClientProvider, not
// from the server, so a whole missing namespace threw MISSING_MESSAGE in
// the browser and the menu drew raw keys. `getMessageFallback` below is
// the second line — it only ever sees a key English does not have either.
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
  const own = (await import(`../messages/${locale}.json`)).default;
  const messages = mergeMessages(enMessages as Messages, own as Messages);
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
