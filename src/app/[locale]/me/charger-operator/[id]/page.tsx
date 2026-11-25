import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CardForm } from "./card-form";
import { PriceForm } from "./price-form";
import { ApiKeysSection } from "./api-keys-section";
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

  const apiKeys = await prisma.chargerOperatorApiKey.findMany({
    where: { operatorId: op.id },
    orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }],
    select: { id: true, label: true, createdAt: true, lastUsedAt: true, revokedAt: true },
  });

  const t = await getTranslations("cabinet.chargerOperator");
  const tPoints = await getTranslations("points");
  const tStaff = await getTranslations("staff");
  const tTickets = await getTranslations("tickets");
  const tAccounting = await getTranslations("accounting");
  const tMarketing = await getTranslations("marketing");
  const tCampaigns = await getTranslations("campaigns");
  const tPricing = await getTranslations("pricing");
  const tBookings = await getTranslations("bookingsReport");
  const tTemplates = await getTranslations("templates");
  const tPipeline = await getTranslations("pipeline");

  return (
    <div className="max-w-3xl space-y-10">
      <div>
        <Link href={`/${locale}/me/charger-operator`} className="text-sm text-muted hover:text-foreground">← {t("backToList")}</Link>
        <h1 className="text-[28px] font-bold mt-2 mb-2">{op.displayName}</h1>
        <p className="text-sm text-muted">
          <Link href={`/${locale}/navigator`} className="hover:underline">{t("viewOnMap")} →</Link>
          {" · "}
          <Link
            href={`/${locale}/me/charger-operator/${op.id}/points`}
            prefetch={false}
            className="hover:underline"
          >
            {tPoints("title")} →
          </Link>
          {" · "}
          <Link
            href={`/${locale}/me/charger-operator/${op.id}/staff`}
            prefetch={false}
            className="hover:underline"
          >
            {tStaff("title")} →
          </Link>
          {" · "}
          <Link
            href={`/${locale}/me/charger-operator/${op.id}/tickets`}
            prefetch={false}
            className="hover:underline"
          >
              {tTickets("title")} →
          </Link>
          {" · "}
          <Link
            href={`/${locale}/me/charger-operator/${op.id}/accounting`}
            prefetch={false}
            className="hover:underline"
          >
            {tAccounting("title")} →
          </Link>
          {" · "}
          <Link
            href={`/${locale}/me/charger-operator/${op.id}/marketing`}
            prefetch={false}
            className="hover:underline"
          >
            {tMarketing("cabinetLink")} →
          </Link>
          {" · "}
          <Link
            href={`/${locale}/me/charger-operator/${op.id}/campaigns`}
            prefetch={false}
            className="hover:underline"
          >
            {tCampaigns("title")} →
          </Link>
          {" · "}
          <Link
            href={`/${locale}/me/charger-operator/${op.id}/pricing`}
            prefetch={false}
            className="hover:underline"
          >
            {tPricing("cabinetLink")} →
          </Link>
          {" · "}
          <Link
            href={`/${locale}/me/charger-operator/${op.id}/bookings-report`}
            prefetch={false}
            className="hover:underline"
          >
            {tBookings("cabinetLink")} →
          </Link>
          {" · "}
          <Link
            href={`/${locale}/me/charger-operator/${op.id}/templates`}
            prefetch={false}
            className="hover:underline"
          >
            {tTemplates("cabinetLink")} →
          </Link>
          {" · "}
          <Link
            href={`/${locale}/me/charger-operator/${op.id}/pipeline`}
            prefetch={false}
            className="hover:underline"
          >
            {tPipeline("cabinetLink")} →
          </Link>
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
        <PriceForm
          operatorId={op.id}
          initial={{
            pricePerKwh: op.pricePerKwh ? op.pricePerKwh.toString() : null,
            priceCurrency: op.priceCurrency,
            priceUpdatedAt: op.priceUpdatedAt ? op.priceUpdatedAt.toISOString() : null,
          }}
          labels={{
            sectionTitle: t("priceSection"),
            help: t("priceHelp"),
            pricePerKwh: t("pricePerKwhLabel"),
            pricePerKwhPlaceholder: t("pricePerKwhPlaceholder"),
            currency: t("priceCurrencyLabel"),
            save: t("priceSave"),
            clear: t("priceClear"),
            cleared: t("priceCleared"),
            saved: t("saved"),
            notSet: t("priceNotSet"),
            updatedAtPrefix: t("priceUpdatedAtPrefix"),
          }}
        />
      </div>

      <div className="pt-6 border-t border-hairline">
        <ApiKeysSection
          operatorId={op.id}
          keys={apiKeys.map((k) => ({
            id: k.id,
            label: k.label,
            createdAt: k.createdAt.toISOString(),
            lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
            revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
          }))}
          labels={{
            sectionTitle: t("apiSection"),
            help: t("apiHelp"),
            labelField: t("apiKeyLabel"),
            labelPlaceholder: t("apiKeyLabelPlaceholder"),
            generate: t("apiGenerate"),
            revoke: t("apiRevoke"),
            revokeConfirm: t("apiRevokeConfirm"),
            revoked: t("apiRevoked"),
            active: t("apiActive"),
            neverUsed: t("apiNeverUsed"),
            lastUsedPrefix: t("apiLastUsedPrefix"),
            plaintextHeading: t("apiPlaintextHeading"),
            plaintextSubtitle: t("apiPlaintextSubtitle"),
            copy: t("apiCopy"),
            copied: t("apiCopied"),
            dismiss: t("apiDismiss"),
            empty: t("apiEmpty"),
            createdPrefix: t("apiCreatedPrefix"),
            endpointHint: t("apiEndpointHint"),
          }}
        />
      </div>

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
