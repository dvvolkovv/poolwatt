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

  let entity:
    | { id: string; displayName: string; website: string | null; claimedById: string | null; publicPath: string }
    | null = null;

  if (entityType === "PRODUCER") {
    const producer = await prisma.producer.findUnique({
      where: { id: entityId },
      include: { profile: true },
    });
    if (producer) {
      entity = {
        id: producer.id,
        displayName: producer.displayName,
        website: producer.profile?.website ?? null,
        claimedById: producer.claimedById,
        publicPath: `/${locale}/p/${producer.handle}`,
      };
    }
  } else if (entityType === "CHARGER_OPERATOR") {
    const op = await prisma.chargerOperator.findUnique({
      where: { id: entityId },
      select: { id: true, displayName: true, websiteUrl: true, claimedById: true },
    });
    if (op) {
      entity = {
        id: op.id,
        displayName: op.displayName,
        website: op.websiteUrl,
        claimedById: op.claimedById,
        publicPath: `/${locale}/navigator`,
      };
    }
  } else {
    notFound();
  }

  if (!entity) notFound();
  if (entity.claimedById) redirect(entity.publicPath);

  const t = await getTranslations("claim");

  return (
    <div className="max-w-[560px] mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold mb-2">{t("title", { name: entity.displayName })}</h1>
      <p className="text-sm text-muted mb-6">{t("instructions")}</p>
      {entity.website ? (
        <ClaimForm
          entityType={entityType as "PRODUCER" | "CHARGER_OPERATOR"}
          entityId={entity.id}
          locale={locale}
          website={entity.website}
          labels={{
            email: t("emailLabel"),
            submit: t("submitLabel"),
            domainHint: t("domainHint", { website: entity.website }),
          }}
        />
      ) : (
        <p className="text-sm text-down">{t("noWebsiteFallback")}</p>
      )}
    </div>
  );
}
