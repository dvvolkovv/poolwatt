// The producer's listing cabinet — ТЗ §9 "Веб-кабинет производителя", US-01.

import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { CompanyForm } from "@/components/listing/company-form";
import { prisma } from "@/lib/prisma";

export default async function ListingCabinetPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/listing`);

  const t = await getTranslations("cabinet.listing");

  const companies = await prisma.company.findMany({
    where: { ownerUserId: session.user.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      legalName: true,
      country: true,
      type: true,
      kybStatus: true,
      regNumber: true,
      _count: { select: { assets: true } },
      applications: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, submittedAt: true, documents: true },
      },
    },
  });

  return (
    <div>
      <h1 className="mb-2 text-[28px] font-bold">{t("title")}</h1>
      <p className="mb-8 max-w-[70ch] text-sm text-muted">{t("intro")}</p>

      <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">
        {t("companies")}
      </h2>

      {companies.length === 0 ? (
        <p className="mb-6 text-sm text-muted">{t("empty")}</p>
      ) : (
        <ul className="mb-8">
          {companies.map((c) => {
            const application = c.applications[0];
            const documents = Array.isArray(application?.documents)
              ? application.documents.length
              : 0;
            return (
              <li key={c.id} className="border-b border-hairline py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <Link
                    href={`/${locale}/me/listing/${c.id}`}
                    prefetch={false}
                    className="text-[15px] font-semibold underline"
                  >
                    {c.legalName}
                  </Link>
                  <span className="num text-[12px] text-muted">
                    {c.country} · {c.regNumber}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted">
                  <span>{t(`type.${c.type}`)}</span>
                  <span>
                    {t("applicationStatus")}:{" "}
                    <b className="text-foreground">
                      {application ? t(`status.${application.status}`) : t("noApplication")}
                    </b>
                  </span>
                  <span>
                    KYB: <b className="text-foreground">{t(`kyb.${c.kybStatus}`)}</b>
                  </span>
                  <span className="num">
                    {t("assetsCount")}: {c._count.assets}
                  </span>
                  <span className="num">{documents} PDF/JPG</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CompanyForm
        locale={locale}
        defaultCountry={locale === "sk" ? "SK" : ""}
        labels={{
          title: t("form.title"),
          newCompany: t("newCompany"),
          legalName: t("form.legalName"),
          country: t("form.country"),
          regNumber: t("form.regNumber"),
          vatNumber: t("form.vatNumber"),
          type: t("form.type"),
          website: t("form.website"),
          contactName: t("form.contactName"),
          contactEmail: t("form.contactEmail"),
          contactPhone: t("form.contactPhone"),
          submit: t("form.submit"),
          cancel: t("form.cancel"),
          saving: t("form.saving"),
          typeNames: {
            PRODUCER: t("type.PRODUCER"),
            WHOLESALE: t("type.WHOLESALE"),
            COOPERATIVE: t("type.COOPERATIVE"),
            OPERATOR: t("type.OPERATOR"),
          },
        }}
      />
    </div>
  );
}
