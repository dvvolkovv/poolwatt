import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CancelBuildRequestButton } from "@/components/cabinet/cancel-build-request-button";

export default async function BuildRequestDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/build-requests/${id}`);

  const r = await prisma.buildRequest.findUnique({ where: { id } });
  if (!r || r.userId !== session.user.id) notFound();

  const t = await getTranslations("cabinet.buildRequest");

  return (
    <div className="max-w-2xl">
      <Link href={`/${locale}/me/build-requests`} className="text-sm text-muted">← {t("action.back")}</Link>
      <h1 className="text-[28px] font-bold mt-2 mb-6">
        {t(`field.source.${r.source}`)} · <span className="num">{r.peakKw.toString()}</span> kW
      </h1>

      <div className="flex items-center gap-4 mb-8">
        <span className={`text-xs px-2 py-1 rounded ${statusClass(r.status)}`}>
          {t(`status.${r.status}`)}
        </span>
        {r.status === "OPEN" && (
          <Link
            href={`/${locale}/me/build-requests/${id}/edit`}
            className="text-sm underline"
          >
            {t("action.edit")}
          </Link>
        )}
        {r.status !== "FULFILLED" && r.status !== "CANCELLED" && (
          <CancelBuildRequestButton id={id} label={t("action.cancel")} locale={locale} />
        )}
      </div>

      <dl className="grid grid-cols-[200px_1fr] gap-y-2 text-sm">
        <dt className="text-muted">{t("field.country.label")}</dt><dd>{r.country}, {r.city}</dd>
        <dt className="text-muted">{t("field.addressLine.label")}</dt><dd>{r.addressLine}</dd>
        <dt className="text-muted">{t("field.siteType.label")}</dt><dd>{t(`field.siteType.${r.siteType}`)}</dd>
        {r.roofOrientation && <><dt className="text-muted">{t("field.roofOrientation.label")}</dt><dd>{t(`field.roofOrientation.${r.roofOrientation}`)}</dd></>}
        {r.availableAreaM2 != null && <><dt className="text-muted">{t("field.availableAreaM2.label")}</dt><dd>{r.availableAreaM2} m²</dd></>}
        <dt className="text-muted">{t("field.budget.label")}</dt><dd>{t(`field.budget.${r.budget}`)}</dd>
        <dt className="text-muted">{t("field.timeline.label")}</dt><dd>{t(`field.timeline.${r.timeline}`)}</dd>
        {r.wantPowerbank && <><dt className="text-muted">{t("field.powerbankKwh.label")}</dt><dd>{r.powerbankKwh?.toString()} kWh</dd></>}
        {r.wantEvCharger && <><dt className="text-muted">{t("field.evChargerPorts.label")}</dt><dd>{r.evChargerPorts}</dd></>}
        {r.notes && <><dt className="text-muted">{t("field.notes.label")}</dt><dd className="whitespace-pre-wrap">{r.notes}</dd></>}
      </dl>
    </div>
  );
}

function statusClass(s: string) {
  switch (s) {
    case "OPEN": return "bg-blue-100 text-blue-700";
    case "MATCHED": return "bg-yellow-100 text-yellow-700";
    case "FULFILLED": return "bg-green-100 text-green-700";
    case "CANCELLED": return "bg-gray-100 text-gray-700";
    default: return "bg-gray-100 text-gray-700";
  }
}
