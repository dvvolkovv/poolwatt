import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BuildRequestForm } from "@/components/cabinet/build-request-form";
import { getBuildRequestFormLabels } from "@/lib/build-request-form-labels";

export default async function NewBuildRequestPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/build-requests/new`);

  const [user, t, labels] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { name: true, phone: true },
    }),
    getTranslations("cabinet.buildRequest"),
    getBuildRequestFormLabels(locale),
  ]);

  return (
    <div>
      <Link href={`/${locale}/me/build-requests`} className="text-sm text-muted">← {t("action.back")}</Link>
      <h1 className="text-[28px] font-bold mt-2 mb-6">{t("new.title")}</h1>
      <BuildRequestForm
        mode={{ kind: "create" }}
        locale={locale}
        hasPhone={user.phone != null}
        hasName={user.name != null}
        labels={labels}
      />
    </div>
  );
}
