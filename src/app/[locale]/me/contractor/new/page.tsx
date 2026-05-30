import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { ContractorForm } from "@/components/cabinet/contractor-form";
import { getContractorFormLabels } from "@/lib/contractor-form-labels";

export default async function NewContractorPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/contractor/new`);

  const [t, labels] = await Promise.all([
    getTranslations("cabinet.contractor"),
    getContractorFormLabels(),
  ]);

  return (
    <div>
      <Link href={`/${locale}/me/contractor`} className="text-sm text-muted">← {t("action.back")}</Link>
      <h1 className="text-[28px] font-bold mt-2 mb-6">{t("new.title")}</h1>
      <ContractorForm mode={{ kind: "create" }} locale={locale} labels={labels} />
    </div>
  );
}
