import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ContractorRenewableType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readApprovedContractors } from "@/lib/contractor-queries";
import { ContractorCard } from "@/components/contractor/contractor-card";
import { ContractorFilters } from "@/components/contractor/contractor-filters";

const RENEWABLES: ContractorRenewableType[] = ["SOLAR", "WIND", "HYDRO", "BIOMASS", "GEOTHERMAL", "HYBRID"];

export const metadata = {
  title: "Contractors — Poolwatt",
  description: "Find renewable energy contractors who can build your solar, wind, or hybrid power station.",
};

export default async function ContractorsListPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ country?: string; renewable?: string; ev?: string; page?: string }>;
}) {
  const { locale } = await params;
  const { country: rc, renewable: rr, ev: re, page: rp } = await searchParams;
  setRequestLocale(locale);

  const country = rc?.match(/^[A-Z]{2}$/) ? rc : undefined;
  const renewable = RENEWABLES.includes(rr as ContractorRenewableType)
    ? (rr as ContractorRenewableType)
    : undefined;
  const ev = re === "true" ? true : undefined;
  const page = Math.max(1, Number(rp) || 1);
  const pageSize = 24;

  const [{ rows, total }, distinctCountries, tListing, tFilter, tField] = await Promise.all([
    readApprovedContractors({ country, renewable, ev, page, pageSize }),
    prisma.contractor.findMany({
      where: { status: "APPROVED" },
      select: { country: true },
      distinct: ["country"],
      orderBy: { country: "asc" },
    }),
    getTranslations("public.contractor.listing"),
    getTranslations("public.contractor.filter"),
    getTranslations("cabinet.contractor.field.renewableTypes"),
  ]);

  const countryOptions = distinctCountries.map((c) => c.country);
  const renewableLabels = Object.fromEntries(
    RENEWABLES.map((r) => [r, tField(r)]),
  );

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="bg-bg min-h-[calc(100vh-4rem)]">
      <div className="max-w-[1400px] mx-auto px-4 md:px-12 xl:px-20 py-12 md:py-20">
        <header className="mb-8">
          <h1 className="text-[32px] md:text-[48px] font-bold tracking-[-0.02em]">{tListing("title")}</h1>
          <p className="text-muted mt-2 max-w-2xl">{tListing("subtitle")}</p>
        </header>

        <ContractorFilters
          locale={locale}
          initialCountry={country ?? ""}
          initialRenewable={renewable ?? ""}
          initialEv={ev === true}
          countryOptions={countryOptions}
          labels={{
            country: tFilter("country"),
            renewable: tFilter("renewable"),
            all: tFilter("all"),
            apply: tFilter("apply"),
            clear: tFilter("clear"),
            evOnly: tFilter("evOnly"),
            renewableLabels,
          }}
        />

        {rows.length === 0 ? (
          <div className="border border-hairline rounded-lg p-8 text-center">
            <p className="text-muted mb-4">{tListing("empty")}</p>
            <Link href={`/${locale}/me/contractor/new`} className="text-accent underline">
              {tListing("emptyCta")}
            </Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {rows.map((c) => (
                <ContractorCard key={c.id} locale={locale} contractor={c} />
              ))}
            </div>

            <div className="flex items-center justify-between mt-8 text-sm text-muted">
              <p>{tListing("total", { count: total })}</p>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link
                    href={`/${locale}/contractors?${new URLSearchParams({
                      ...(country ? { country } : {}),
                      ...(renewable ? { renewable } : {}),
                      ...(ev ? { ev: "true" } : {}),
                      page: String(page - 1),
                    })}`}
                    className="px-3 py-1 border border-hairline rounded"
                  >
                    ←
                  </Link>
                )}
                <span className="px-3 py-1">{tListing("page", { page, total: totalPages })}</span>
                {page < totalPages && (
                  <Link
                    href={`/${locale}/contractors?${new URLSearchParams({
                      ...(country ? { country } : {}),
                      ...(renewable ? { renewable } : {}),
                      ...(ev ? { ev: "true" } : {}),
                      page: String(page + 1),
                    })}`}
                    className="px-3 py-1 border border-hairline rounded"
                  >
                    →
                  </Link>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
