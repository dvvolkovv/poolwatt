import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ContractorForm } from "@/components/cabinet/contractor-form";
import { getContractorFormLabels } from "@/lib/contractor-form-labels";

export default async function EditContractorPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login`);

  const member = await prisma.contractorMember.findUnique({
    where: { contractorId_userId: { contractorId: id, userId: session.user.id } },
  });
  if (!member || member.role !== "OWNER") notFound();

  const c = await prisma.contractor.findUnique({ where: { id } });
  if (!c) notFound();

  if (c.status !== "PENDING") {
    redirect(`/${locale}/me/contractor/${id}?notEditable=1`);
  }

  const [t, labels] = await Promise.all([
    getTranslations("cabinet.contractor"),
    getContractorFormLabels(),
  ]);

  return (
    <div>
      <Link href={`/${locale}/me/contractor/${id}`} className="text-sm text-muted">← {t("action.back")}</Link>
      <h1 className="text-[28px] font-bold mt-2 mb-6">{t("action.edit")}</h1>
      <ContractorForm
        mode={{ kind: "edit", id }}
        locale={locale}
        labels={labels}
        initial={{
          entityType: c.entityType,
          displayName: c.displayName,
          legalName: c.legalName ?? undefined,
          registrationNumber: c.registrationNumber ?? undefined,
          country: c.country,
          city: c.city,
          foundedYear: c.foundedYear ?? undefined,
          workCategories: c.workCategories,
          renewableTypes: c.renewableTypes,
          countriesServed: c.countriesServed,
          bio: c.bio,
          websiteUrl: c.websiteUrl ?? undefined,
          logoUrl: c.logoUrl ?? undefined,
          contactEmail: c.contactEmail,
          contactPhone: c.contactPhone,
        }}
      />
    </div>
  );
}
