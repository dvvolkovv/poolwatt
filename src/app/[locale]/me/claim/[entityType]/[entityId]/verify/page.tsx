import { redirect, notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { VerifyForm } from "./verify-form";

type Props = {
  params: Promise<{ locale: string; entityType: string; entityId: string }>;
};

export default async function VerifyClaimPage({ params }: Props) {
  const { locale, entityType, entityId } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/claim/${entityType}/${entityId}/verify`);
  }

  if (entityType !== "PRODUCER") notFound();

  const producer = await prisma.producer.findUnique({
    where: { id: entityId },
    select: { id: true, handle: true, displayName: true, claimedById: true },
  });
  if (!producer) notFound();
  if (producer.claimedById) redirect(`/${locale}/p/${producer.handle}`);

  const t = await getTranslations("claim");

  return (
    <div className="max-w-[480px] mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold mb-2">{t("verifyTitle", { name: producer.displayName })}</h1>
      <p className="text-sm text-muted mb-6">{t("verifyInstructions")}</p>
      <VerifyForm
        entityType="PRODUCER"
        entityId={producer.id}
        handle={producer.handle}
        locale={locale}
        labels={{
          code: t("codeLabel"),
          submit: t("verifySubmitLabel"),
        }}
      />
    </div>
  );
}
