import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { readContractorBySlug } from "@/lib/contractor-queries";

type RouteParams = { locale: string; slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { slug } = await params;
  const c = await readContractorBySlug(slug);
  if (!c) return { title: "Contractor not found — Poolwatt" };
  const desc = (c.bio ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  return {
    title: `${c.displayName} — Poolwatt`,
    description: desc,
    openGraph: c.logoUrl
      ? { images: [{ url: c.logoUrl }] }
      : undefined,
  };
}

export default async function ContractorDetailPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const c = await readContractorBySlug(slug);
  if (!c) notFound();

  const [tDetail, tField] = await Promise.all([
    getTranslations("public.contractor.detail"),
    getTranslations("cabinet.contractor.field"),
  ]);

  const initial = c.displayName.charAt(0).toUpperCase();

  return (
    <main className="bg-bg min-h-[calc(100vh-4rem)]">
      <div className="max-w-3xl mx-auto px-4 md:px-12 py-12 md:py-20">
        <Link href={`/${locale}/contractors`} className="text-sm text-muted">← {tDetail("back")}</Link>

        <header className="flex items-start gap-4 mt-6 mb-10">
          {c.logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={c.logoUrl}
              alt={`${c.displayName} logo`}
              className="w-20 h-20 rounded-lg object-cover border border-hairline"
            />
          ) : (
            <div className="w-20 h-20 rounded-lg bg-foreground/10 flex items-center justify-center font-bold text-3xl text-muted">
              {initial}
            </div>
          )}
          <div>
            <h1 className="text-[32px] md:text-[40px] font-bold tracking-[-0.02em]">{c.displayName}</h1>
            <p className="text-muted mt-1">
              {tField(`entityType.${c.entityType}`)} · {c.city}, {c.country}
            </p>
          </div>
        </header>

        <section className="mb-8">
          <h2 className="text-sm uppercase tracking-wider text-muted mb-2">{tDetail("about")}</h2>
          <p className="whitespace-pre-wrap leading-relaxed">{c.bio}</p>
        </section>

        <section className="mb-8 grid sm:grid-cols-2 gap-6">
          <div>
            <h3 className="text-xs uppercase tracking-wider text-muted mb-2">{tDetail("workCategories")}</h3>
            <ul className="text-sm space-y-1">
              {c.workCategories.map((w) => (
                <li key={w}>· {tField(`workCategories.${w}`)}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-xs uppercase tracking-wider text-muted mb-2">{tDetail("renewableTypes")}</h3>
            <ul className="text-sm space-y-1">
              {c.renewableTypes.map((r) => (
                <li key={r}>· {tField(`renewableTypes.${r}`)}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mb-8">
          <h3 className="text-xs uppercase tracking-wider text-muted mb-2">{tDetail("countriesServed")}</h3>
          <p className="text-sm">{c.countriesServed.join(", ")}</p>
        </section>

        <section className="border border-hairline rounded-lg p-5 mb-8">
          <h2 className="text-sm uppercase tracking-wider text-muted mb-3">{tDetail("contact")}</h2>
          <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
            <dt className="text-muted">{tDetail("contactEmail")}</dt>
            <dd><a href={`mailto:${c.contactEmail}`} className="text-accent underline">{c.contactEmail}</a></dd>
            <dt className="text-muted">{tDetail("contactPhone")}</dt>
            <dd><a href={`tel:${c.contactPhone}`} className="text-accent underline">{c.contactPhone}</a></dd>
            {c.websiteUrl && (
              <>
                <dt className="text-muted">{tDetail("website")}</dt>
                <dd>
                  <a href={c.websiteUrl} target="_blank" rel="noreferrer" className="text-accent underline">
                    {c.websiteUrl}
                  </a>
                </dd>
              </>
            )}
          </dl>
        </section>

        {c.providesEvCharging && (
          <section className="border border-hairline rounded-lg p-5 mb-8">
            <h2 className="text-sm uppercase tracking-wider text-muted mb-3">
              ⚡ {tDetail("ev")}
            </h2>
            <dl className="grid grid-cols-[180px_1fr] gap-y-2 text-sm">
              <dt className="text-muted">{tField("evPowerSource.label")}</dt>
              <dd>{c.evPowerSource ? tField(`evPowerSource.${c.evPowerSource}`) : "—"}</dd>
              <dt className="text-muted">{tField("evStationCount.label")}</dt>
              <dd className="num">{c.evStationCount}</dd>
              <dt className="text-muted">{tField("evConnectorTypes.label")}</dt>
              <dd>{c.evConnectorTypes.map(k => tField(`evConnectorTypes.${k}`)).join(", ")}</dd>
              <dt className="text-muted">{tField("evPowerLevels.label")}</dt>
              <dd>{c.evPowerLevels.map(k => tField(`evPowerLevels.${k}`)).join(", ")}</dd>
              <dt className="text-muted">{tField("evUsageType.label")}</dt>
              <dd>{c.evUsageType ? tField(`evUsageType.${c.evUsageType}`) : "—"}</dd>
              <dt className="text-muted">{tField("evMaxPowerKw.label")}</dt>
              <dd><span className="num">{c.evMaxPowerKw?.toString()}</span> kW</dd>
            </dl>
            {c.evDescription && (
              <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{c.evDescription}</p>
            )}
          </section>
        )}

        {(c.legalName || c.registrationNumber || c.foundedYear) && (
          <section className="border border-hairline rounded-lg p-5">
            <h2 className="text-sm uppercase tracking-wider text-muted mb-3">{tDetail("companyInfo")}</h2>
            <dl className="grid grid-cols-[160px_1fr] gap-y-2 text-sm">
              {c.legalName && (<><dt className="text-muted">{tDetail("legalName")}</dt><dd>{c.legalName}</dd></>)}
              {c.registrationNumber && (<><dt className="text-muted">{tDetail("registrationNumber")}</dt><dd>{c.registrationNumber}</dd></>)}
              {c.foundedYear != null && (<><dt className="text-muted">{tDetail("foundedYear")}</dt><dd>{c.foundedYear}</dd></>)}
            </dl>
          </section>
        )}
      </div>
    </main>
  );
}
