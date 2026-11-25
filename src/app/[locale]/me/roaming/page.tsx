// §8 "Роуминг", §9.10 "при зарядке в другой стране показывается пересчёт до
// подтверждения", US-11. The corridors the driver may use, and the session
// they confirm at a rate they have seen.

import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/exchange/decimal";
import { readMyRoamingCorridors } from "@/lib/exchange/roaming-service";
import { RoamingSessionForm } from "@/components/exchange/roaming-session-form";

export const dynamic = "force-dynamic";

export default async function RoamingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/roaming`);
  const userId = session.user.id;

  const t = await getTranslations("roaming");

  const [corridors, wallets] = await Promise.all([
    readMyRoamingCorridors(userId),
    prisma.wallet.findMany({
      where: { ownerUserId: userId },
      include: { zone: { select: { code: true } } },
      orderBy: { kwhBalance: "desc" },
    }),
  ]);

  // Only zones a corridor actually leads to can be charged in abroad.
  const visitedZoneIds = [...new Set(corridors.map((c) => c.visitedZoneId))];
  const zones = visitedZoneIds.length
    ? await prisma.gridZone.findMany({
        where: { id: { in: visitedZoneIds } },
        orderBy: { code: "asc" },
        select: { id: true, code: true, currency: true },
      })
    : [];

  const labels = {
    zone: t("zone"),
    amount: t("amount"),
    calculate: t("calculate"),
    confirm: t("confirm"),
    noCorridor: t("noCorridor"),
    rate: t("rate"),
    partner: t("partner"),
    fromHome: t("fromHome"),
    debit: t("debit"),
    clearingFee: t("clearingFee"),
    fromLocal: t("fromLocal"),
    toBuy: t("toBuy"),
    money: t("money"),
    unserved: t("unserved"),
    allowance: t("allowance"),
    done: t("done"),
    receipt: t("receipt"),
    recalculate: t("calculate"),
  };

  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{t("eyebrow")}</div>
      <h1 className="mb-2 text-[28px] font-bold">{t("title")}</h1>
      <p className="mb-8 max-w-[80ch] text-[13px] text-muted">{t("intro")}</p>

      <section className="mb-10">
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">
          {t("myBalances")}
        </h2>
        {wallets.length === 0 ? (
          <p className="text-sm text-muted">{t("noWallet")}</p>
        ) : (
          <ul className="divide-y divide-hairline text-sm">
            {wallets.map((w) => (
              <li key={w.id} className="flex justify-between py-2">
                <span>{w.zone.code}</span>
                <span className="num">
                  {num(w.kwhBalance).toFixed(3)} {t("kwh")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">
          {t("corridors")}
        </h2>
        {corridors.length === 0 ? (
          <p className="text-sm text-muted">{t("noCorridors")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-[13px]" data-testid="roaming-corridors">
              <thead>
                <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-[0.14em] text-muted">
                  <th className="py-2 pr-4">{t("corridor")}</th>
                  <th className="py-2 pr-4">{t("partner")}</th>
                  <th className="py-2 pr-4">{t("rate")}</th>
                  <th className="py-2 pr-4">{t("fee")}</th>
                  <th className="py-2 pr-4">{t("allowance")}</th>
                  <th className="py-2">{t("servable")}</th>
                </tr>
              </thead>
              <tbody>
                {corridors.map((c) => (
                  <tr key={c.agreementId} className="border-b border-hairline">
                    <td className="py-2 pr-4">
                      {c.homeZoneCode} → {c.visitedZoneCode}
                    </td>
                    <td className="py-2 pr-4">{c.partnerName}</td>
                    <td className="num py-2 pr-4">{c.conversionRate ?? t("noRate")}</td>
                    <td className="num py-2 pr-4">{c.feePct} %</td>
                    <td className="num py-2 pr-4">
                      {c.allowanceKwh == null ? t("noLimit") : c.allowanceKwh.toFixed(3)}
                    </td>
                    <td className="num py-2">{c.maxKwh.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">
          {t("sessionTitle")}
        </h2>
        <p className="mb-3 max-w-[80ch] text-[12px] text-muted">{t("sessionHelp")}</p>
        {zones.length === 0 ? (
          <p className="text-sm text-muted">{t("noCorridors")}</p>
        ) : (
          <RoamingSessionForm
            locale={locale}
            zones={zones}
            defaultZoneId={zones[0].id}
            labels={labels}
          />
        )}
      </section>

      <p className="mt-10 text-[12px] text-muted">
        <Link href={`/${locale}/me/wallet`} prefetch={false} className="underline hover:text-accent">
          {t("backToWallet")} →
        </Link>
      </p>
    </div>
  );
}
