import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CardForm } from "./card-form";
import { UnlinkButton } from "./unlink-button";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ claimed?: string }>;
};

export default async function ChargerOperatorCabinetPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const { claimed } = await searchParams;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/charger-operator/${id}`);

  const op = await prisma.chargerOperator.findUnique({ where: { id } });
  if (!op) notFound();
  if (op.claimedById !== session.user.id) notFound();

  const t = await getTranslations("cabinet.chargerOperator");

  return (
    <div className="max-w-3xl space-y-10">
      <div>
        <Link href={`/${locale}/me/charger-operator`} className="text-sm text-muted hover:text-foreground">← {t("backToList")}</Link>
        <h1 className="text-[28px] font-bold mt-2 mb-2">{op.displayName}</h1>
        <p className="text-sm text-muted">
          <Link href={`/${locale}/navigator`} className="hover:underline">{t("viewOnMap")} →</Link>
        </p>
        {claimed === "1" && (
          <div className="mt-4 p-3 rounded-xl bg-up/10 border border-up/30 text-sm">
            ✓ {t("justClaimedBanner")}
          </div>
        )}
      </div>

      <CardForm
        operatorId={op.id}
        initial={{
          displayName: op.displayName,
          description: op.description,
          websiteUrl: op.websiteUrl,
          logoUrl: op.logoUrl,
          email: op.email,
          phone: op.phone,
        }}
        labels={{
          sectionTitle: t("cardSection"),
          displayName: t("displayName"),
          description: t("description"),
          websiteUrl: t("websiteUrl"),
          logoUrl: t("logoUrl"),
          email: t("email"),
          phone: t("phone"),
          submit: t("save"),
          saved: t("saved"),
        }}
      />

      <div className="pt-6 border-t border-hairline">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">{t("dangerSection")}</h2>
        <p className="text-xs text-muted mb-3">{t("unlinkHint")}</p>
        <UnlinkButton
          operatorId={op.id}
          locale={locale}
          labels={{ button: t("unlinkButton"), confirm: t("unlinkConfirm") }}
        />
      </div>
    </div>
  );
}
