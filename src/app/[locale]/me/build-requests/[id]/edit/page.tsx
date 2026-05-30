import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BuildRequestForm } from "@/components/cabinet/build-request-form";
import { getBuildRequestFormLabels } from "@/lib/build-request-form-labels";

export default async function EditBuildRequestPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login`);

  const r = await prisma.buildRequest.findUnique({ where: { id } });
  if (!r || r.userId !== session.user.id) notFound();

  if (r.status !== "OPEN") {
    redirect(`/${locale}/me/build-requests/${id}?notEditable=1`);
  }

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
      <Link href={`/${locale}/me/build-requests/${id}`} className="text-sm text-muted">← {t("action.back")}</Link>
      <h1 className="text-[28px] font-bold mt-2 mb-6">{t("action.edit")}</h1>
      <BuildRequestForm
        mode={{ kind: "edit", id }}
        locale={locale}
        hasPhone={user.phone != null}
        hasName={user.name != null}
        initial={{
          source: r.source,
          peakKw: r.peakKw.toNumber(),
          wantPowerbank: r.wantPowerbank,
          powerbankKwh: r.powerbankKwh?.toNumber(),
          wantEvCharger: r.wantEvCharger,
          evChargerPorts: r.evChargerPorts ?? undefined,
          evPublicForSale: r.evPublicForSale,
          country: r.country,
          city: r.city,
          addressLine: r.addressLine,
          siteType: r.siteType,
          availableAreaM2: r.availableAreaM2 ?? undefined,
          roofOrientation: r.roofOrientation ?? undefined,
          budget: r.budget,
          timeline: r.timeline,
          notes: r.notes ?? undefined,
        }}
        labels={labels}
      />
    </div>
  );
}
