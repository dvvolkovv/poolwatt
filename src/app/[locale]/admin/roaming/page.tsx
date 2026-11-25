// §8 "Роуминг" for the operator: the corridors, what each of them owes right
// now, and the period closed against it. Before this page nothing could
// create a corridor outside the seed — `upsertRoamingAgreement` had no caller.

import { getTranslations, setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { readRoamingPositions } from "@/lib/exchange/roaming-service";
import { CorridorForm, NetPeriodForm } from "@/components/admin/roaming-forms";

export const dynamic = "force-dynamic";

export default async function AdminRoamingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("adminRoaming");

  const [positions, zones] = await Promise.all([
    readRoamingPositions(),
    prisma.gridZone.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true } }),
  ]);

  const stamp = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : "—");

  return (
    <div>
      <h1 className="text-[22px] font-semibold">{t("title")}</h1>
      <p className="mb-6 mt-1 max-w-[90ch] text-[13px] text-muted">{t("intro")}</p>

      <section className="mb-10">
        <h2 className="mb-3 text-[16px] font-semibold">{t("positions")}</h2>
        {positions.length === 0 ? (
          <p className="text-[13px] text-muted">{t("noCorridors")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem] text-[13px]" data-testid="roaming-positions">
              <thead>
                <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-[0.14em] text-muted">
                  <th className="py-2 pr-4">{t("corridor")}</th>
                  <th className="py-2 pr-4">{t("partner")}</th>
                  <th className="py-2 pr-4">{t("fee")}</th>
                  <th className="py-2 pr-4">{t("dailyLimit")}</th>
                  <th className="py-2 pr-4">{t("openSessions")}</th>
                  <th className="py-2 pr-4">{t("delivered")}</th>
                  <th className="py-2 pr-4">{t("debited")}</th>
                  <th className="py-2 pr-4">{t("feeKwh")}</th>
                  <th className="py-2 pr-4">{t("oldest")}</th>
                  <th className="py-2">{t("lastNetted")}</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.agreementId} className="border-b border-hairline align-top">
                    <td className="py-2 pr-4">
                      {p.homeZoneCode} → {p.visitedZoneCode}
                      {!p.enabled && (
                        <span className="ml-2 text-[11px] text-amber-400">{t("disabled")}</span>
                      )}
                      <div className="mt-2">
                        <NetPeriodForm
                          agreementId={p.agreementId}
                          labels={{
                            upTo: t("upTo"),
                            reference: t("reference"),
                            close: t("close"),
                            closed: t("closed"),
                          }}
                        />
                      </div>
                    </td>
                    <td className="py-2 pr-4">{p.partnerName}</td>
                    <td className="num py-2 pr-4">{p.feePct} %</td>
                    <td className="num py-2 pr-4">
                      {p.dailyLimitKwh == null ? t("noLimit") : p.dailyLimitKwh.toFixed(3)}
                    </td>
                    <td className="num py-2 pr-4">{p.openSessions}</td>
                    <td className="num py-2 pr-4">{p.deliveredKwh.toFixed(3)}</td>
                    <td className="num py-2 pr-4">{p.debitedKwh.toFixed(3)}</td>
                    <td className="num py-2 pr-4">{p.feeKwh.toFixed(3)}</td>
                    <td className="num py-2 pr-4">{stamp(p.oldestAt)}</td>
                    <td className="py-2">
                      <span className="num">{stamp(p.lastNettedAt)}</span>
                      {p.lastNettedRef && (
                        <span className="block text-[12px] text-muted">{p.lastNettedRef}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-[16px] font-semibold">{t("corridorTitle")}</h2>
        <p className="mb-4 max-w-[90ch] text-[13px] text-muted">{t("corridorHelp")}</p>
        <CorridorForm
          zones={zones}
          labels={{
            homeZone: t("homeZone"),
            visitedZone: t("visitedZone"),
            partner: t("partner"),
            feePct: t("fee"),
            dailyLimit: t("dailyLimit"),
            noLimit: t("noLimit"),
            enabled: t("enabledField"),
            save: t("save"),
            saved: t("saved"),
          }}
        />
      </section>
    </div>
  );
}
