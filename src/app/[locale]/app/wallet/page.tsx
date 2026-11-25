import { setRequestLocale, getTranslations } from "next-intl/server";
import { Screen } from "@/components/mobile/screen";
import { Soon } from "@/components/mobile/soon";

export default async function WalletScreen({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.tabs");
  return (
    <Screen title={t("wallet")}>
      <Soon stage="M2" />
    </Screen>
  );
}
