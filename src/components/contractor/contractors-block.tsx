import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { readNewestApprovedContractors } from "@/lib/contractor-queries";
import { ContractorCard } from "./contractor-card";

export async function ContractorsBlock({ locale }: { locale: string }) {
  const rows = await readNewestApprovedContractors(6);
  if (rows.length === 0) return null;

  const t = await getTranslations("public.contractor.homepage");

  return (
    <section className="py-12 md:py-20">
      <header className="mb-8 max-w-3xl">
        <h2 className="text-[28px] md:text-[40px] font-bold tracking-[-0.02em]">{t("title")}</h2>
        <p className="text-muted mt-2 text-[15px] md:text-[17px]">{t("subtitle")}</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map((c) => (
          <ContractorCard key={c.id} locale={locale} contractor={c} />
        ))}
      </div>

      <div className="mt-6">
        <Link href={`/${locale}/contractors`} className="text-accent text-sm font-semibold underline">
          {t("viewAll")}
        </Link>
      </div>
    </section>
  );
}
