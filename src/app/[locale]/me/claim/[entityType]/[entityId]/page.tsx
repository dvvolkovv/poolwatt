import { redirect, notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ClaimForm } from "./claim-form";

type Props = {
  params: Promise<{ locale: string; entityType: string; entityId: string }>;
};

export default async function ClaimPage({ params }: Props) {
  const { locale, entityType, entityId } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/claim/${entityType}/${entityId}`);
  }

  if (entityType !== "PRODUCER") notFound();

  const producer = await prisma.producer.findUnique({
    where: { id: entityId },
    include: { profile: true },
  });
  if (!producer) notFound();
  if (producer.claimedById) {
    redirect(`/${locale}/p/${producer.handle}`);
  }

  const t = await getTranslations("claim");

  return (
    <div className="max-w-[560px] mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold mb-2">{t("title", { name: producer.displayName })}</h1>
      <p className="text-sm text-muted mb-6">{t("instructions")}</p>
      {producer.profile?.website ? (
        <ClaimForm
          entityType="PRODUCER"
          entityId={producer.id}
          locale={locale}
          website={producer.profile.website}
          labels={{
            email: t("emailLabel"),
            submit: t("submitLabel"),
            domainHint: t("domainHint", { website: producer.profile.website }),
          }}
        />
      ) : (
        <p className="text-sm text-down">{t("noWebsiteFallback")}</p>
      )}
    </div>
  );
}
