// The partner's campaigns — ТЗ §42, US-41. The constructor, and what each
// campaign has given away, had spent and watched burn.

import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readCampaigns } from "@/lib/marketing/campaign-service";
import { campaignFiatFundingOpen } from "@/lib/exchange/gates";
import { CampaignForm } from "@/components/marketing/campaign-form";
import { CampaignRowActions } from "@/components/marketing/campaign-row-actions";

export const dynamic = "force-dynamic";

export default async function CampaignsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/charger-operator/${id}/campaigns`);
  }

  const operator = await prisma.chargerOperator.findUnique({
    where: { id },
    select: { id: true, displayName: true, claimedById: true },
  });
  if (!operator) notFound();
  if (operator.claimedById !== session.user.id) notFound();

  const t = await getTranslations("campaigns");

  const [campaigns, points, zones] = await Promise.all([
    readCampaigns(id, session.user.id),
    prisma.acceptancePoint.findMany({
      where: { operatorId: id },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.gridZone.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true } }),
  ]);

  const names = (keys: readonly string[], prefix: string) =>
    Object.fromEntries(keys.map((k) => [k, t(`${prefix}.${k}`)]));

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
      {/* §44, US-44 — the numbers behind the campaigns. */}
      <p className="mb-2 text-[13px]">
        <Link
          href={`/${locale}/me/charger-operator/${id}/campaigns/analytics`}
          prefetch={false}
          data-testid="analytics-link"
          className="underline hover:text-accent"
        >
          {t("analytics.link")} →
        </Link>
      </p>
      <p className="mb-2 text-sm text-muted">{t("intro")}</p>
      {!campaignFiatFundingOpen() && (
        <p className="mb-8 text-[13px] text-muted" data-testid="funding-note">
          {t("fiatClosed")}
        </p>
      )}

      <section className="mb-12">
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">{t("new")}</h2>
        <CampaignForm
          operatorId={id}
          points={points}
          zones={zones}
          labels={{
            name: t("field.name"),
            trigger: t("field.trigger"),
            triggerN: t("field.triggerN"),
            triggerNth: t("field.triggerNth"),
            triggerVolume: t("field.triggerVolume"),
            triggerPeriodDays: t("field.triggerPeriodDays"),
            giftKwh: t("field.giftKwh"),
            cashbackPct: t("field.cashbackPct"),
            scope: t("field.scope"),
            scopeAll: t("field.scopeAll"),
            validityDays: t("field.validityDays"),
            oncePerClient: t("field.oncePerClient"),
            minNextChargeKwh: t("field.minNextChargeKwh"),
            budgetKwh: t("field.budgetKwh"),
            promoCode: t("field.promoCode"),
            discountPct: t("field.discountPct"),
            freeBooking: t("field.freeBooking"),
            budgetGrants: t("field.budgetGrants"),
            exclusive: t("field.exclusive"),
            promoNote: t("promoNote"),
            qrLink: t("qrLink"),
            discountNote: t("discountNote"),
            bookingNote: t("bookingNote"),
            funding: t("field.funding"),
            fundingTokens: t("funding.TOKENS"),
            fundingFiat: t("funding.FIAT"),
            zone: t("field.zone"),
            from: t("field.from"),
            to: t("field.to"),
            create: t("create"),
            triggerNames: names(
              [
                "FIRST_CHARGE",
                "NTH_CHARGE",
                "VOLUME_PERIOD",
                "TOKEN_PAYMENT",
                "PROMO_CODE",
                "BIRTHDAY",
              ],
              "trigger",
            ),
          }}
        />
      </section>

      <section>
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">{t("list")}</h2>
        {campaigns.length === 0 ? (
          <p className="text-sm text-muted">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-hairline text-sm" data-testid="campaign-list">
            {campaigns.map((c) => (
              <li key={c.id} className="space-y-2 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-[12px] text-muted">
                    {t(`status.${c.status}`)} · {t(`trigger.${c.trigger}`)}
                    {c.triggerN != null ? ` (${c.triggerN})` : ""} ·{" "}
                    {/* US-12 — a cashback campaign has a share, not a gift. */}
                    {c.cashbackPct != null ? (
                      <>
                        <span className="num">{c.cashbackPct}</span> %
                      </>
                    ) : c.discountPct != null ? (
                      <>
                        −<span className="num">{c.discountPct}</span> %{" "}
                        <span className="text-muted">
                          (≤ <span className="num">{c.giftKwh}</span> {t("kwh")})
                        </span>
                      </>
                    ) : c.giftKwh > 0 ? (
                      <>
                        <span className="num">{c.giftKwh}</span> {t("kwh")}
                      </>
                    ) : null}
                    {c.freeBooking && <> · {t("field.freeBooking")}</>}
                    {c.exclusive && <> · {t("field.exclusive")}</>}{" "}
                    ·{" "}
                    {c.scopePointIds.length === 0
                      ? t("wholeNetwork")
                      : `${c.scopePointIds.length} ${t("pointCount")}`}
                  </span>
                </div>

                <div className="text-[12px] text-muted">
                  {t("budget")}: <span className="num">{c.issuedKwh}</span> /{" "}
                  <span className="num">{c.budgetKwh}</span> {t("kwh")}
                  {" · "}
                  {t("given")}: <span className="num">{c.issuedToClientsKwh}</span>
                  {" · "}
                  {t("used")}: <span className="num">{c.usedKwh}</span>
                  {" · "}
                  {t("expired")}: <span className="num">{c.expiredKwh}</span>
                  {" · "}
                  <span className="num">{c.grantCount}</span> {t("grants")}
                </div>

                {c.promoCode && (
                  <div className="text-[12px]" data-testid="promo-code-row">
                    <code className="rounded bg-hairline/40 px-1.5 py-0.5">{c.promoCode}</code>
                    {" · "}
                    {t("qrLink")}:{" "}
                    <code className="break-all">
                      https://poolwatt.com/{locale}/promo/{c.promoCode}
                    </code>
                  </div>
                )}

                {c.budgetGrants != null && (
                  <div className="text-[12px] text-muted">
                    {t("giftsUsed")}: <span className="num">{c.issuedGrants}</span> /{" "}
                    <span className="num">{c.budgetGrants}</span> {t("gifts")}
                  </div>
                )}

                {c.pauseReason && (
                  <p className="text-[13px] text-down" data-testid="pause-reason">
                    {c.pauseReason}
                  </p>
                )}

                <CampaignRowActions
                  campaignId={c.id}
                  status={c.status}
                  budgetKwh={c.budgetKwh}
                  labels={{
                    start: t("start"),
                    pause: t("pause"),
                    end: t("end"),
                    topUp: t("topUp"),
                    newBudget: t("field.budgetKwh"),
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
