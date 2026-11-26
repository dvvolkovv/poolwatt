import { setRequestLocale, getTranslations } from "next-intl/server";
import { Screen } from "@/components/mobile/screen";
import { OfflineBalance } from "@/components/mobile/offline-balance";
import { ReceiveQr } from "@/components/mobile/receive-qr";

// The service worker serves this page from its cache, so nothing on it may
// touch the session or the database.
export const dynamic = "force-static";

export default async function OfflinePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.offline");
  const tTransfer = await getTranslations("app.transfer");

  return (
    <Screen title={t("title")}>
      <OfflineBalance
        bodyTemplate={t.raw("body") as string}
        staleLabel={t("stale")}
        retryLabel={t("retry")}
      />
      {/* §25 — «последний известный баланс и QR». Ник лежит в localStorage,
          поэтому код рисуется и без сети; секрета в нём нет. */}
      <ReceiveQr
        username={null}
        labels={{ myQr: tTransfer("myQr"), myQrHint: tTransfer("myQrHint") }}
      />
    </Screen>
  );
}
