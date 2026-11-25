// §53 "Что настраивает оператор Poolwatt" — the plans, who is on them, and the
// individual terms written over them.

import { getTranslations, setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { cardTariffsOpen } from "@/lib/exchange/gates";
import { readPartnerPlans, readPlans } from "@/lib/pricing/fee-plan-service";
import { AssignForm, PlanForm } from "@/components/pricing/fee-plan-forms";

export const dynamic = "force-dynamic";

export default async function FeePlansPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("feePlans");

  const [plans, partnerPlans, companies, operators] = await Promise.all([
    readPlans(),
    readPartnerPlans(),
    prisma.company.findMany({
      where: { kybStatus: "APPROVED" },
      orderBy: { legalName: "asc" },
      take: 300,
      select: { id: true, legalName: true },
    }),
    prisma.chargerOperator.findMany({
      where: { claimedById: { not: null } },
      orderBy: { displayName: "asc" },
      take: 300,
      select: { id: true, displayName: true },
    }),
  ]);

  const names = (keys: readonly string[], prefix: string) =>
    Object.fromEntries(keys.map((k) => [k, t(`${prefix}.${k}`)]));

  const planLabels = {
    name: t("field.name"),
    tier: t("field.tier"),
    participantType: t("field.participantType"),
    anyType: t("field.anyType"),
    tradeFeePct: t("field.tradeFeePct"),
    chargeFeePct: t("field.chargeFeePct"),
    bookingFeePct: t("field.bookingFeePct"),
    subscriptionFiat: t("field.subscriptionFiat"),
    subscriptionPeriod: t("field.subscriptionPeriod"),
    currency: t("field.currency"),
    includedInvoices: t("field.includedInvoices"),
    includedCampaigns: t("field.includedCampaigns"),
    isDefault: t("field.isDefault"),
    active: t("field.active"),
    save: t("save"),
    tierNames: names(["BASIC", "EXTENDED", "CORPORATE"], "tier"),
    typeNames: names(["PRODUCER", "WHOLESALE", "COOPERATIVE", "OPERATOR"], "type"),
    periodNames: names(["month", "quarter", "year"], "period"),
  };

  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{t("eyebrow")}</div>
      <h1 className="mb-2 text-[28px] font-bold">{t("title")}</h1>
      <p className="mb-2 text-sm text-muted">{t("intro")}</p>
      {!cardTariffsOpen() && (
        <p className="mb-8 text-[13px] text-muted" data-testid="card-tariffs-note">
          {t("cardsClosed")}
        </p>
      )}

      <section className="mb-12">
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">{t("plans")}</h2>
        {plans.length === 0 ? (
          <p className="mb-6 text-sm text-muted">{t("noPlans")}</p>
        ) : (
          <ul className="mb-8 divide-y divide-hairline" data-testid="plan-list">
            {plans.map((p) => (
              <li key={p.id} className="space-y-2 py-5">
                <div className="flex flex-wrap items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">
                    {p.name}
                    {p.isDefault && (
                      <span className="ml-2 rounded border border-accent px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-accent">
                        {t("field.isDefault")}
                      </span>
                    )}
                    {!p.active && (
                      <span className="ml-2 text-[11px] uppercase tracking-wider text-muted">
                        {t("inactive")}
                      </span>
                    )}
                  </span>
                  <span className="text-[12px] text-muted">
                    {t(`tier.${p.tier}`)} ·{" "}
                    {p.participantType ? t(`type.${p.participantType}`) : t("field.anyType")} ·{" "}
                    <span className="num">{p.partnerCount}</span> {t("partners")}
                  </span>
                </div>
                <PlanForm
                  initial={{
                    name: p.name,
                    tier: p.tier,
                    participantType: p.participantType,
                    tradeFeePct: p.tradeFeePct,
                    chargeFeePct: p.chargeFeePct,
                    bookingFeePct: p.bookingFeePct,
                    subscriptionFiat: p.subscriptionFiat,
                    subscriptionPeriod: p.subscriptionPeriod,
                    currency: p.currency,
                    includedInvoices: p.includedInvoices,
                    includedCampaigns: p.includedCampaigns,
                    isDefault: p.isDefault,
                    active: p.active,
                  }}
                  labels={planLabels}
                />
              </li>
            ))}
          </ul>
        )}

        <h3 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">{t("newPlan")}</h3>
        <PlanForm labels={planLabels} />
      </section>

      <section>
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">
          {t("assignments")}
        </h2>
        {partnerPlans.length === 0 ? (
          <p className="mb-6 text-sm text-muted">{t("noAssignments")}</p>
        ) : (
          <ul className="mb-8 divide-y divide-hairline text-sm" data-testid="assignment-list">
            {partnerPlans.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-3 py-3">
                <span>{a.partner}</span>
                <span className="text-[12px] text-muted">
                  {a.planName} · {t(`tier.${a.tier}`)}
                  {Object.keys(a.overrides).length > 0 && (
                    <>
                      {" · "}
                      {t("overridden")}:{" "}
                      {Object.entries(a.overrides)
                        .map(([k, v]) => `${k} ${String(v)}`)
                        .join(", ")}
                    </>
                  )}
                  {a.note ? ` · ${a.note}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}

        {plans.length > 0 && (
          <AssignForm
            plans={plans.map((p) => ({ id: p.id, name: p.name }))}
            companies={companies}
            operators={operators}
            labels={{
              plan: t("field.plan"),
              company: t("field.company"),
              network: t("field.network"),
              none: t("field.none"),
              overrideTrade: t("field.overrideTrade"),
              overrideCharge: t("field.overrideCharge"),
              overrideBooking: t("field.overrideBooking"),
              note: t("field.note"),
              assign: t("assign"),
              help: t("assignHelp"),
            }}
          />
        )}
      </section>
    </div>
  );
}
