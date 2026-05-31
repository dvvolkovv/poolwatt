import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CardForm } from "./card-form";
import { ProfileForm } from "./profile-form";
import { UnlinkButton } from "./unlink-button";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ claimed?: string }>;
};

export default async function ProducerCabinetPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const { claimed } = await searchParams;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/producer/${id}`);

  const producer = await prisma.producer.findUnique({
    where: { id },
    include: { profile: true },
  });
  if (!producer) notFound();
  if (producer.claimedById !== session.user.id) notFound();

  const t = await getTranslations("cabinet.producer");

  return (
    <div className="max-w-3xl space-y-10">
      <div>
        <Link href={`/${locale}/me/producer`} className="text-sm text-muted hover:text-foreground">← {t("backToList")}</Link>
        <h1 className="text-[28px] font-bold mt-2 mb-2">{producer.displayName}</h1>
        <p className="text-sm text-muted flex flex-wrap gap-x-4 gap-y-1">
          <Link href={`/${locale}/p/${producer.handle}`} className="hover:underline">{t("viewPublic")} →</Link>
          <Link href={`/${locale}/me/producer/${producer.id}/requests`} className="hover:underline text-accent">{t("availableRequests")} →</Link>
        </p>
        {claimed === "1" && (
          <div className="mt-4 p-3 rounded-xl bg-up/10 border border-up/30 text-sm">
            ✓ {t("justClaimedBanner")}
          </div>
        )}
      </div>

      <CardForm
        producerId={producer.id}
        initial={{
          displayName: producer.displayName,
          bio: producer.bio,
          logoUrl: producer.logoUrl,
          websiteUrl: producer.websiteUrl,
          twitterUrl: producer.twitterUrl,
        }}
        labels={{
          sectionTitle: t("cardSection"),
          displayName: t("displayName"),
          bio: t("bio"),
          logoUrl: t("logoUrl"),
          websiteUrl: t("websiteUrl"),
          twitterUrl: t("twitterUrl"),
          submit: t("save"),
          saved: t("saved"),
        }}
      />

      <ProfileForm
        producerId={producer.id}
        initial={{
          description: producer.profile?.description ?? null,
          founded: producer.profile?.founded ?? null,
          employees: producer.profile?.employees ?? null,
          website: producer.profile?.website ?? null,
          email: producer.profile?.email ?? null,
          phone: producer.profile?.phone ?? null,
          address: producer.profile?.address ?? null,
          ceo: producer.profile?.ceo ?? null,
          stockTicker: producer.profile?.stockTicker ?? null,
        }}
        labels={{
          sectionTitle: t("profileSection"),
          description: t("description"),
          founded: t("founded"),
          employees: t("employees"),
          website: t("website"),
          email: t("email"),
          phone: t("phone"),
          address: t("address"),
          ceo: t("ceo"),
          stockTicker: t("stockTicker"),
          submit: t("save"),
          saved: t("saved"),
        }}
      />

      <div className="pt-6 border-t border-hairline">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">{t("dangerSection")}</h2>
        <p className="text-xs text-muted mb-3">{t("unlinkHint")}</p>
        <UnlinkButton
          producerId={producer.id}
          locale={locale}
          labels={{ button: t("unlinkButton"), confirm: t("unlinkConfirm") }}
        />
      </div>
    </div>
  );
}
