// The partner's tariffs in one place — ТЗ §52, with §54's version next to
// every number and the whole history below.
//
// Editing stays where it was (the point wizard, the booking terms, the
// cabinet's price form): this page is what §52 asks for — one view of the
// economy a partner has set, and proof of when each number started applying.

import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readPricingOverview } from "@/lib/pricing/pricing-overview";
import { readSubpartners } from "@/lib/pricing/subpartner-service";
import { SubpartnerForm } from "@/components/pricing/subpartner-form";

export const dynamic = "force-dynamic";

/** Minutes from midnight as the partner typed them. */
function window(fromMinute: number, toMinute: number): string {
  const hhmm = (m: number) =>
    `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  if (fromMinute === 0 && toMinute >= 1440) return "24/7";
  return `${hhmm(fromMinute)}–${hhmm(toMinute)}`;
}

function day(at: Date | null): string {
  return at ? at.toISOString().slice(0, 16).replace("T", " ") : "—";
}

export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/charger-operator/${id}/pricing`);
  }

  const operator = await prisma.chargerOperator.findUnique({
    where: { id },
    select: { id: true, displayName: true, claimedById: true },
  });
  if (!operator) notFound();
  if (operator.claimedById !== session.user.id) notFound();

  const t = await getTranslations("pricing");
  const [overview, subpartners, otherNetworks] = await Promise.all([
    readPricingOverview(id),
    readSubpartners(id),
    // §52 — only networks somebody has claimed can be a franchisee: an
    // unclaimed OpenStreetMap operator has nobody to agree with.
    prisma.chargerOperator.findMany({
      where: { claimedById: { not: null }, id: { not: id } },
      orderBy: { displayName: "asc" },
      take: 300,
      select: { id: true, displayName: true },
    }),
  ]);

  return (
    <div className="max-w-4xl">
      <Link
        href={`/${locale}/me/charger-operator/${id}`}
        prefetch={false}
        className="text-[13px] text-muted underline hover:text-foreground"
      >
        ← {operator.displayName}
      </Link>

      <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-muted">{t("eyebrow")}</div>
      <h1 className="mb-2 text-[28px] font-bold">{t("title")}</h1>
      <p className="mb-10 text-sm text-muted">{t("intro")}</p>

      <section className="mb-10">
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">
          {t("networkPrice")}
        </h2>
        <p className="text-sm" data-testid="network-price">
          {overview.network.pricePerKwh == null ? (
            <span className="text-muted">{t("notSet")}</span>
          ) : (
            <>
              <span className="num font-semibold">{overview.network.pricePerKwh}</span>{" "}
              {overview.network.currency}/{t("kwh")}
            </>
          )}
          {overview.network.version != null && (
            <span className="text-[12px] text-muted">
              {" · "}
              {t("version")} <span className="num">{overview.network.version}</span>
              {" · "}
              {day(overview.network.activeFrom)}
            </span>
          )}
        </p>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">
          {t("pointTariffs")}
        </h2>
        {overview.points.length === 0 ? (
          <p className="text-sm text-muted">{t("noPoints")}</p>
        ) : (
          <ul className="divide-y divide-hairline text-sm" data-testid="point-pricing">
            {overview.points.map((p) => (
              <li key={p.pointId} className="space-y-1.5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <Link
                    href={`/${locale}/me/charger-operator/${id}/points/${p.pointId}`}
                    prefetch={false}
                    className="font-medium underline hover:text-accent"
                  >
                    {p.pointName}
                  </Link>
                  <span className="text-[12px] text-muted">
                    {p.version == null ? (
                      t("noVersion")
                    ) : (
                      <>
                        {t("version")} <span className="num">{p.version}</span> ·{" "}
                        {day(p.activeFrom)}
                      </>
                    )}
                  </span>
                </div>

                {p.tariffs.length === 0 ? (
                  <p className="text-[12px] text-muted">{t("noTariff")}</p>
                ) : (
                  <ul className="text-[13px]">
                    {p.tariffs.map((tr, i) => (
                      <li key={i} className="text-muted">
                        <span className="num">{window(tr.fromMinute, tr.toMinute)}</span>
                        {" — "}
                        {tr.priceFiat != null && (
                          <>
                            <span className="num">{tr.priceFiat}</span> {tr.currency}/{t("kwh")}
                          </>
                        )}
                        {tr.priceTokens != null && (
                          <>
                            {tr.priceFiat != null ? " · " : ""}
                            <span className="num">{tr.priceTokens}</span> {t("tokensPerKwh")}
                          </>
                        )}
                        {tr.idleFeePerMin != null && (
                          <>
                            {" · "}
                            {t("idleFee")} <span className="num">{tr.idleFeePerMin}</span>
                          </>
                        )}
                        {tr.coopDiscount > 0 && (
                          <>
                            {" · "}
                            {t("coopDiscount")} <span className="num">{tr.coopDiscount}</span>%
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {p.booking?.enabled && (
                  <p className="text-[12px] text-muted">
                    {t("booking")}: <span className="num">{p.booking.feeFiat}</span> ·{" "}
                    {t("guarantee")} <span className="num">{p.booking.guaranteeFiat}</span> ·{" "}
                    {t("penalty")} <span className="num">{p.booking.noShowPenaltyFiat}</span>
                    {p.booking.version != null && (
                      <>
                        {" · "}
                        {t("version")} <span className="num">{p.booking.version}</span>
                      </>
                    )}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">
          {t("subpartners")}
        </h2>

        {subpartners.asSub.length > 0 && (
          <ul className="mb-4 text-sm" data-testid="subpartner-of">
            {subpartners.asSub.map((a) => (
              <li key={a.id} className="text-muted">
                {t("youPay", { network: a.partnerName })}{" "}
                <span className="num">{a.chargeFeePct}</span>%
                {!a.active && ` · ${t("switchedOff")}`}
              </li>
            ))}
          </ul>
        )}

        {subpartners.asHead.length === 0 ? (
          <p className="mb-4 text-sm text-muted">{t("noSubpartners")}</p>
        ) : (
          <ul className="mb-4 divide-y divide-hairline text-sm" data-testid="subpartner-list">
            {subpartners.asHead.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-3 py-2">
                <span>{a.partnerName}</span>
                <span className="text-[12px] text-muted">
                  <span className="num">{a.chargeFeePct}</span>%
                  {!a.active && ` · ${t("switchedOff")}`}
                  {a.note ? ` · ${a.note}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}

        <SubpartnerForm
          headId={id}
          networks={otherNetworks}
          labels={{
            network: t("field.subpartner"),
            pct: t("field.subpartnerPct"),
            note: t("field.note"),
            save: t("saveSubpartner"),
            help: t("subpartnersHelp"),
            none: "—",
          }}
        />
      </section>

      <section>
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">{t("history")}</h2>
        <p className="mb-3 text-[12px] text-muted">{t("historyHelp")}</p>
        {overview.history.length === 0 ? (
          <p className="text-sm text-muted">{t("noHistory")}</p>
        ) : (
          <ul className="divide-y divide-hairline text-[13px]" data-testid="pricing-history">
            {overview.history.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-3 py-2">
                <span>
                  {t(`scope.${r.scope}`)}
                  {" · "}
                  {t("version")} <span className="num">{r.version}</span>
                </span>
                <span className="text-[12px] text-muted">
                  {day(r.activeFrom)}
                  {r.note ? ` · ${r.note}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
