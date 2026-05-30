import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { WithdrawContractorButton } from "@/components/cabinet/withdraw-contractor-button";

export default async function ContractorDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/contractor/${id}`);

  const member = await prisma.contractorMember.findUnique({
    where: { contractorId_userId: { contractorId: id, userId: session.user.id } },
  });
  if (!member) notFound();

  const c = await prisma.contractor.findUnique({ where: { id } });
  if (!c) notFound();

  const t = await getTranslations("cabinet.contractor");

  return (
    <div className="max-w-2xl">
      <Link href={`/${locale}/me/contractor`} className="text-sm text-muted">← {t("action.back")}</Link>
      <h1 className="text-[28px] font-bold mt-2 mb-6">{c.displayName}</h1>

      <div className="flex items-center gap-4 mb-8">
        <span className={`text-xs px-2 py-1 rounded ${statusClass(c.status)}`}>
          {t(`status.${c.status}`)}
        </span>
        {c.status === "PENDING" && member.role === "OWNER" && (
          <>
            <Link
              href={`/${locale}/me/contractor/${id}/edit`}
              className="text-sm underline"
            >
              {t("action.edit")}
            </Link>
            <WithdrawContractorButton
              id={id}
              locale={locale}
              label={t("action.withdraw")}
              confirmText={t("action.confirmWithdraw")}
            />
          </>
        )}
      </div>

      <dl className="grid grid-cols-[180px_1fr] gap-y-2 text-sm">
        <dt className="text-muted">{t("field.entityType.label")}</dt><dd>{t(`field.entityType.${c.entityType}`)}</dd>
        {c.legalName && <><dt className="text-muted">{t("field.legalName.label")}</dt><dd>{c.legalName}</dd></>}
        {c.registrationNumber && <><dt className="text-muted">{t("field.registrationNumber.label")}</dt><dd>{c.registrationNumber}</dd></>}
        <dt className="text-muted">{t("field.country.label")}</dt><dd>{c.country}, {c.city}</dd>
        {c.foundedYear != null && <><dt className="text-muted">{t("field.foundedYear.label")}</dt><dd>{c.foundedYear}</dd></>}
        <dt className="text-muted">{t("field.workCategories.label")}</dt>
        <dd>{c.workCategories.map(w => t(`field.workCategories.${w}`)).join(", ")}</dd>
        <dt className="text-muted">{t("field.renewableTypes.label")}</dt>
        <dd>{c.renewableTypes.map(r => t(`field.renewableTypes.${r}`)).join(", ")}</dd>
        <dt className="text-muted">{t("field.countriesServed.label")}</dt><dd>{c.countriesServed.join(", ")}</dd>
        <dt className="text-muted">{t("field.contactEmail.label")}</dt><dd>{c.contactEmail}</dd>
        <dt className="text-muted">{t("field.contactPhone.label")}</dt><dd>{c.contactPhone}</dd>
        {c.websiteUrl && <><dt className="text-muted">{t("field.websiteUrl.label")}</dt><dd><a href={c.websiteUrl} className="underline" target="_blank" rel="noreferrer">{c.websiteUrl}</a></dd></>}
        <dt className="text-muted">{t("field.bio.label")}</dt><dd className="whitespace-pre-wrap">{c.bio}</dd>
      </dl>

      {c.providesEvCharging && (
        <section className="mt-10 border border-hairline rounded-lg p-5">
          <h2 className="text-sm uppercase tracking-wider text-muted mb-3">
            ⚡ {t("field.providesEvCharging.label").replace(/^This company /, "")}
          </h2>
          <dl className="grid grid-cols-[180px_1fr] gap-y-2 text-sm">
            <dt className="text-muted">{t("field.evPowerSource.label")}</dt>
            <dd>{c.evPowerSource ? t(`field.evPowerSource.${c.evPowerSource}`) : "—"}</dd>
            <dt className="text-muted">{t("field.evStationCount.label")}</dt>
            <dd>{c.evStationCount ?? "—"}</dd>
            <dt className="text-muted">{t("field.evConnectorTypes.label")}</dt>
            <dd>{c.evConnectorTypes.map(k => t(`field.evConnectorTypes.${k}`)).join(", ")}</dd>
            <dt className="text-muted">{t("field.evPowerLevels.label")}</dt>
            <dd>{c.evPowerLevels.map(k => t(`field.evPowerLevels.${k}`)).join(", ")}</dd>
            <dt className="text-muted">{t("field.evUsageType.label")}</dt>
            <dd>{c.evUsageType ? t(`field.evUsageType.${c.evUsageType}`) : "—"}</dd>
            <dt className="text-muted">{t("field.evMaxPowerKw.label")}</dt>
            <dd>{c.evMaxPowerKw ? `${c.evMaxPowerKw.toString()} kW` : "—"}</dd>
            <dt className="text-muted">{t("field.evDescription.label")}</dt>
            <dd className="whitespace-pre-wrap">{c.evDescription}</dd>
          </dl>
        </section>
      )}
    </div>
  );
}

function statusClass(s: string) {
  switch (s) {
    case "PENDING": return "bg-yellow-100 text-yellow-700";
    case "APPROVED": return "bg-green-100 text-green-700";
    case "REJECTED": return "bg-gray-100 text-gray-700";
    case "SUSPENDED": return "bg-red-100 text-red-700";
    default: return "bg-gray-100 text-gray-700";
  }
}
