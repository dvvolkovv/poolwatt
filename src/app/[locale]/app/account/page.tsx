import { setRequestLocale, getTranslations } from "next-intl/server";
import { Screen } from "@/components/mobile/screen";
import { Soon } from "@/components/mobile/soon";

export default async function AccountScreen({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.sections");
  return (
    <Screen title={t("account")}>
      <Soon stage="M6" />
    </Screen>
  );
}
