// §44 "Аналитика кампаний" — US-44. One row of numbers per campaign, one per
// piece of content, and the CSV the partner's marketing person asks for.

import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  readCampaignAnalytics,
  readContentAnalytics,
} from "@/lib/marketing/campaign-analytics";

export const dynamic = "force-dynamic";

export default async function CampaignAnalyticsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(
      `/${locale}/login?callbackUrl=/${locale}/me/charger-operator/${id}/campaigns/analytics`,
    );
  }

  const operator = await prisma.chargerOperator.findUnique({
    where: { id },
    select: { id: true, displayName: true, claimedById: true },
  });
  if (!operator) notFound();
  if (operator.claimedById !== session.user.id) notFound();

  const t = await getTranslations("campaigns");
  const [campaigns, contents] = await Promise.all([
    readCampaignAnalytics(id, session.user.id),
    readContentAnalytics(id, session.user.id),
  ]);

  const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)} %`);

  return (
    <div className="max-w-5xl">
      <Link
        href={`/${locale}/me/charger-operator/${id}/campaigns`}
        prefetch={false}
        className="text-[13px] text-muted underline hover:text-foreground"
      >
        ← {t("title")}
      </Link>

      <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-muted">
        {t("analytics.eyebrow")}
      </div>
      <h1 className="mb-2 text-[28px] font-bold">{t("analytics.title")}</h1>
      <p className="mb-8 max-w-[80ch] text-sm text-muted">{t("analytics.intro")}</p>

      <section className="mb-12">
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">
          {t("analytics.campaigns")}
        </h2>
        {campaigns.length === 0 ? (
          <p className="text-sm text-muted">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[60rem] text-[13px]" data-testid="analytics-campaigns">
              <thead>
                <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-[0.14em] text-muted">
                  <th className="py-2 pr-4">{t("analytics.campaign")}</th>
                  <th className="py-2 pr-4">{t("analytics.clients")}</th>
                  <th className="py-2 pr-4">{t("analytics.newClients")}</th>
                  <th className="py-2 pr-4">{t("analytics.returning")}</th>
                  <th className="py-2 pr-4">{t("given")}</th>
                  <th className="py-2 pr-4">{t("used")}</th>
                  <th className="py-2 pr-4">{t("expired")}</th>
                  <th className="py-2 pr-4">{t("analytics.cost")}</th>
                  <th className="py-2 pr-4">{t("analytics.revenue30")}</th>
                  <th className="py-2 pr-4">{t("analytics.revenue90")}</th>
                  <th className="py-2">{t("analytics.csv")}</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.campaignId} className="border-b border-hairline">
                    <td className="py-2 pr-4">
                      {c.name}
                      <span className="block text-[11px] text-muted">
                        {t(`status.${c.status}`)} · {t(`trigger.${c.trigger}`)}
                      </span>
                    </td>
                    <td className="num py-2 pr-4" data-testid={`clients-${c.campaignId}`}>
                      {c.clients}
                    </td>
                    <td className="num py-2 pr-4">{c.newClients}</td>
                    <td className="num py-2 pr-4">{pct(c.returningShare)}</td>
                    <td className="num py-2 pr-4">{c.issuedKwh.toFixed(3)}</td>
                    <td className="num py-2 pr-4">{c.usedKwh.toFixed(3)}</td>
                    <td className="num py-2 pr-4">{c.expiredKwh.toFixed(3)}</td>
                    <td className="num py-2 pr-4">
                      {c.costPerClientKwh == null ? "—" : c.costPerClientKwh.toFixed(3)}
                    </td>
                    <td className="num py-2 pr-4">
                      {c.revenue30.fiat.toFixed(2)}
                      <span className="block text-[11px] text-muted">
                        {c.revenue30.kwh.toFixed(3)} kWh
                      </span>
                    </td>
                    <td className="num py-2 pr-4">
                      {c.revenue90.fiat.toFixed(2)}
                      <span className="block text-[11px] text-muted">
                        {c.revenue90.kwh.toFixed(3)} kWh
                      </span>
                    </td>
                    <td className="py-2">
                      <a
                        href={`/api/v1/campaigns/${c.campaignId}/stats?format=csv`}
                        data-testid={`csv-${c.campaignId}`}
                        className="underline hover:text-accent"
                      >
                        CSV
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-[13px] uppercase tracking-[0.14em] text-muted">
          {t("analytics.content")}
        </h2>
        <p className="mb-3 max-w-[80ch] text-[12px] text-muted">{t("analytics.contentNote")}</p>
        {contents.length === 0 ? (
          <p className="text-sm text-muted">{t("analytics.noContent")}</p>
        ) : (
          <table className="w-full max-w-[44rem] text-[13px]" data-testid="analytics-content">
            <thead>
              <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-[0.14em] text-muted">
                <th className="py-2 pr-4">{t("analytics.contentTitle")}</th>
                <th className="py-2 pr-4">{t("analytics.impressions")}</th>
                <th className="py-2 pr-4">{t("analytics.clicks")}</th>
                <th className="py-2 pr-4">{t("analytics.videoViews")}</th>
                <th className="py-2">{t("analytics.ctr")}</th>
              </tr>
            </thead>
            <tbody>
              {contents.map((c) => (
                <tr key={c.contentId} className="border-b border-hairline">
                  <td className="py-2 pr-4">
                    {c.title}
                    <span className="block text-[11px] text-muted">{c.type}</span>
                  </td>
                  <td className="num py-2 pr-4" data-testid={`impressions-${c.contentId}`}>
                    {c.impressions}
                  </td>
                  <td className="num py-2 pr-4" data-testid={`clicks-${c.contentId}`}>
                    {c.clicks}
                  </td>
                  <td className="num py-2 pr-4">{c.videoViews}</td>
                  <td className="num py-2">{pct(c.ctr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
