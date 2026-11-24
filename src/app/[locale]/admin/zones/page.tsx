// Operator view of the spot reference — ТЗ §6 ("Ориентир цены: спотовая цена
// внешнего рынка зоны"), §16.5. Without a page the operator cannot tell a
// working feed from a silent one, and a stale reference quietly widens the
// corridor around yesterday's price.

import { setRequestLocale, getTranslations } from "next-intl/server";
import { ZoneRefreshButton } from "@/components/admin/zone-refresh-button";
import { numOrNull } from "@/lib/exchange/decimal";
import { spotFeedOpen } from "@/lib/exchange/gates";
import { ENTSOE_SOURCE, readSpotHistory } from "@/lib/exchange/spot-service";
import { prisma } from "@/lib/prisma";

export default async function AdminZonesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ zone?: string }>;
}) {
  const { locale } = await params;
  const { zone: selectedCode } = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations("admin.zones");

  const zones = await prisma.gridZone.findMany({ orderBy: { code: "asc" } });
  const selected = zones.find((z) => z.code === selectedCode) ?? zones[0] ?? null;
  const history = selected ? await readSpotHistory(selected.id, 48) : [];
  const feedOpen = spotFeedOpen();

  const stamp = (iso: string) => iso.replace("T", " ").replace(".000Z", "Z");

  return (
    <div>
      <h1 className="text-[22px] font-semibold">{t("title")}</h1>
      <p className="mb-4 mt-1 max-w-[90ch] text-[13px] text-muted">{t("intro")}</p>
      <p className={`mb-6 text-[13px] ${feedOpen ? "text-muted" : "text-amber-400"}`}>
        {feedOpen ? t("feedOpen") : t("feedClosed")}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-[13px]">
          <thead>
            <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-[0.14em] text-muted">
              <th className="py-2 pr-4">{t("zone")}</th>
              <th className="py-2 pr-4">{t("currency")}</th>
              <th className="py-2 pr-4">{t("interval")}</th>
              <th className="py-2 pr-4">{t("source")}</th>
              <th className="py-2 pr-4">{t("areaCode")}</th>
              <th className="py-2 pr-4">{t("corridor")}</th>
              <th className="py-2 pr-4">{t("spotPrice")}</th>
              <th className="py-2 pr-4">{t("spotPriceAt")}</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {zones.map((z) => {
              const onFeed = (z.spotSource ?? "manual").toLowerCase() === ENTSOE_SOURCE;
              const spot = numOrNull(z.spotPrice);
              return (
                <tr key={z.id} className="border-b border-hairline align-top">
                  <td className="py-2 pr-4">
                    <a href={`?zone=${z.code}`} className="underline hover:text-accent">
                      {z.code}
                    </a>
                    <span className="block text-[12px] text-muted">{z.name}</span>
                  </td>
                  <td className="num py-2 pr-4">{z.currency}</td>
                  <td className="num py-2 pr-4">{z.intervalMinutes}</td>
                  <td className="py-2 pr-4">{onFeed ? ENTSOE_SOURCE : t("manual")}</td>
                  <td className="num py-2 pr-4">{z.spotAreaCode ?? t("none")}</td>
                  <td className="num py-2 pr-4">{numOrNull(z.corridorPct) ?? t("none")}</td>
                  <td className="num py-2 pr-4">{spot ?? t("none")}</td>
                  <td className="num py-2 pr-4">
                    {z.spotPriceAt ? stamp(z.spotPriceAt.toISOString()) : t("none")}
                  </td>
                  <td className="py-2">
                    {onFeed && feedOpen && (
                      <ZoneRefreshButton
                        zoneId={z.id}
                        labels={{
                          refresh: t("refresh"),
                          refreshing: t("refreshing"),
                          refreshed: t("refreshed", { stored: "{stored}" }),
                          failed: t("refreshFailed", { error: "{error}" }),
                        }}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="mt-10">
          <h2 className="text-[16px] font-semibold">{t("history")}</h2>
          <p className="mb-3 mt-1 text-[13px] text-muted">
            {t("historyFor")} {selected.code}
          </p>
          {history.length === 0 ? (
            <p className="text-[13px] text-muted">{t("noHistory")}</p>
          ) : (
            <table className="w-full max-w-[40rem] text-[13px]">
              <thead>
                <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-[0.14em] text-muted">
                  <th className="py-2 pr-4">{t("spotPriceAt")}</th>
                  <th className="py-2 pr-4">{t("price")}</th>
                  <th className="py-2 pr-4">{t("source")}</th>
                  <th className="py-2">{t("fetchedAt")}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={`${row.intervalStart}-${row.source}`} className="border-b border-hairline">
                    <td className="num py-1.5 pr-4">{stamp(row.intervalStart)}</td>
                    <td className="num py-1.5 pr-4">
                      {row.price} {row.currency}
                    </td>
                    <td className="py-1.5 pr-4">{row.source}</td>
                    <td className="num py-1.5">{stamp(row.fetchedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
