// US-05 "Хочу видеть выпущенные, проданные и непроданные токены" — дашборд по
// объекту и периоду, экспорт CSV. ТЗ §12, §15.

import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { readAssetTokens } from "@/lib/exchange/telemetry-service";
import { prisma } from "@/lib/prisma";

const PERIODS = [7, 30, 90] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

const stamp = (iso: string) => iso.slice(0, 16).replace("T", " ");

/** A date from the query string, or null if it is not one. */
function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default async function TokensPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; companyId: string }>;
  searchParams: Promise<{ asset?: string; days?: string; from?: string; to?: string }>;
}) {
  const { locale, companyId } = await params;
  const query = await searchParams;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/listing/${companyId}/tokens`);
  }

  const t = await getTranslations("cabinet.listing");

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, legalName: true, ownerUserId: true },
  });
  if (!company) notFound();
  if (company.ownerUserId !== session.user.id && session.user.role !== "ADMIN") notFound();

  const assets = await prisma.asset.findMany({
    where: { companyId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, kind: true, gridZone: { select: { currency: true } } },
  });

  if (assets.length === 0) {
    return (
      <div>
        <Back locale={locale} companyId={companyId} name={company.legalName} />
        <h1 className="mb-2 mt-3 text-[28px] font-bold">{t("tokens.title")}</h1>
        <p className="text-sm text-muted">{t("tokens.noAssets")}</p>
      </div>
    );
  }

  const asset = assets.find((a) => a.id === query.asset) ?? assets[0];
  const days = PERIODS.includes(Number(query.days) as (typeof PERIODS)[number])
    ? Number(query.days)
    : 7;

  const to = parseDate(query.to) ?? new Date();
  const from = parseDate(query.from) ?? new Date(to.getTime() - days * DAY_MS);
  const custom = Boolean(parseDate(query.from) || parseDate(query.to));

  const summary = await readAssetTokens({ assetId: asset.id, from, to });

  const href = (over: Record<string, string>) => {
    const sp = new URLSearchParams({ asset: asset.id, days: String(days) });
    if (query.from) sp.set("from", query.from);
    if (query.to) sp.set("to", query.to);
    for (const [k, v] of Object.entries(over)) {
      if (v === "") sp.delete(k);
      else sp.set(k, v);
    }
    return `/${locale}/me/listing/${companyId}/tokens?${sp.toString()}`;
  };

  const csvHref = `/api/v1/assets/${asset.id}/tokens?format=csv&from=${from.toISOString()}&to=${to.toISOString()}`;

  const totals: [string, number][] = [
    [t("tokens.minted"), summary.mintedKwh],
    [t("tokens.available"), summary.availableKwh],
    [t("tokens.sold"), summary.soldKwh],
    [t("tokens.stored"), summary.storedKwh],
    [t("tokens.routed"), summary.routedKwh],
    [t("tokens.burned"), summary.burnedKwh],
  ];

  return (
    <div>
      <Back locale={locale} companyId={companyId} name={company.legalName} />

      <h1 className="mb-2 mt-3 text-[28px] font-bold">{t("tokens.title")}</h1>
      <p className="mb-6 max-w-[70ch] text-sm text-muted">{t("tokens.intro")}</p>

      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 text-[13px]">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-muted">{t("tokens.asset")}:</span>
          {assets.map((a) => (
            <Link
              key={a.id}
              href={href({ asset: a.id })}
              prefetch={false}
              className={`rounded border px-2.5 py-1 ${
                a.id === asset.id ? "border-accent text-accent" : "border-hairline text-muted"
              }`}
            >
              {a.name}
            </Link>
          ))}
        </span>

        <span className="flex flex-wrap items-center gap-2">
          <span className="text-muted">{t("tokens.period")}:</span>
          {PERIODS.map((d) => (
            <Link
              key={d}
              href={href({ days: String(d), from: "", to: "" })}
              prefetch={false}
              className={`num rounded border px-2.5 py-1 ${
                d === days && !custom ? "border-accent text-accent" : "border-hairline text-muted"
              }`}
            >
              {t("tokens.days", { days: d })}
            </Link>
          ))}
        </span>

        <a
          href={csvHref}
          className="rounded border border-hairline px-2.5 py-1 hover:border-accent"
        >
          ↓ {t("tokens.csv")}
        </a>
      </div>

      <form method="get" className="mb-8 flex flex-wrap items-end gap-3 text-[13px]">
        <input type="hidden" name="asset" value={asset.id} />
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
            {t("tokens.from")}
          </span>
          <input
            type="date"
            name="from"
            defaultValue={from.toISOString().slice(0, 10)}
            className="num rounded border border-hairline bg-bg px-3 py-1.5"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
            {t("tokens.to")}
          </span>
          <input
            type="date"
            name="to"
            defaultValue={to.toISOString().slice(0, 10)}
            className="num rounded border border-hairline bg-bg px-3 py-1.5"
          />
        </label>
        <button
          type="submit"
          className="rounded border border-hairline px-3 py-1.5 hover:border-accent"
        >
          {t("tokens.apply")}
        </button>
      </form>

      <dl className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {totals.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] uppercase tracking-[0.14em] text-muted">{label}</dt>
            <dd className="num mt-0.5 text-[20px] font-semibold">{value.toFixed(3)}</dd>
          </div>
        ))}
      </dl>

      <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">
        {t("tokens.batches")}
      </h2>
      {summary.batches.length === 0 ? (
        <p className="text-sm text-muted">{t("tokens.noBatches")}</p>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-hairline text-left text-muted">
              <th className="py-1.5 font-normal">{t("tokens.interval")}</th>
              <th className="text-right font-normal">{t("tokens.amount")}</th>
              <th className="font-normal">{t("tokens.status")}</th>
              <th className="font-normal">{t("tokens.certificate")}</th>
            </tr>
          </thead>
          <tbody>
            {summary.batches.map((b) => (
              <tr key={b.id} className="border-b border-hairline">
                <td className="num py-1.5">{stamp(b.intervalStart)}</td>
                <td className="num text-right">{b.amountKwh.toFixed(3)}</td>
                <td>{t(`tokens.tokenStatus.${b.status}`)}</td>
                <td className="num text-muted">{b.goCertificateRef ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Back({
  locale,
  companyId,
  name,
}: {
  locale: string;
  companyId: string;
  name: string;
}) {
  return (
    <Link
      href={`/${locale}/me/listing/${companyId}`}
      prefetch={false}
      className="text-[13px] text-muted underline hover:text-foreground"
    >
      ← {name}
    </Link>
  );
}
