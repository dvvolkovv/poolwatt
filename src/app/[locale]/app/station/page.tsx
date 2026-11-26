// §22.6 «Моя станция» — пульт §30 под телефон (US-18, US-26, US-27).
//
// Читатели те же, что у пульта на мониторе, и числа плиток те же
// (`figureValues`): экран телефона не считает ничего сам. Разметка своя —
// одна колонка вместо двух и крупная цифра первой.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/exchange/decimal";
import { telemetryChannel } from "@/lib/exchange/realtime";
import {
  generationSeries,
  readStationOverview,
  type SeriesRange,
} from "@/lib/exchange/station-service";
import { readAssetTokens } from "@/lib/exchange/telemetry-service";
import { readSpotForecast } from "@/lib/exchange/spot-service";
import { readActiveLayout, readLayouts } from "@/lib/dashboard/dashboard-service";
import { figureValues } from "@/lib/dashboard/widget-values";
import { WIDGET_KEYS, isStorageWidget } from "@/lib/dashboard/widgets";
import { AssetAlerts } from "@/components/listing/asset-alerts";
import { GenerationChart } from "@/components/listing/generation-chart";
import { SaleRulesForm } from "@/components/listing/sale-rules-form";
import { StationLive } from "@/components/listing/station-live";
import { Screen } from "@/components/mobile/screen";
import { StationPanel } from "@/components/mobile/station-panel";

export const dynamic = "force-dynamic";

const RANGES: SeriesRange[] = ["day", "week", "month"];

export default async function MobileStation({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ asset?: string; range?: string; layout?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/app/station`);

  const t = await getTranslations("app.station");

  // §30 «несколько объектов на одной панели и переключение между ними».
  // Выбор живёт в адресе, чтобы ссылка на объект работала.
  const assets = await prisma.asset.findMany({
    where: { company: { ownerUserId: session.user.id } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  if (assets.length === 0) {
    return (
      <Screen title={t("title")} back={`/${locale}/app/more`}>
        <p className="mt-4 text-[15px]" data-testid="station-none">
          {t("none")}
        </p>
        <p className="mt-2 text-[13px] text-muted">{t("noneHint")}</p>
      </Screen>
    );
  }

  const chosen = assets.find((a) => a.id === sp.asset) ?? assets[0];
  const asset = await prisma.asset.findUnique({
    where: { id: chosen.id },
    include: {
      company: { select: { id: true, ownerUserId: true } },
      gridZone: {
        select: { id: true, code: true, currency: true, spotPrice: true },
      },
      apiKeys: {
        orderBy: { createdAt: "desc" },
        select: { id: true, label: true, prefix: true, lastUsedAt: true, revokedAt: true },
      },
    },
  });
  // Объект чужой компании здесь не существует.
  if (!asset || asset.company.ownerUserId !== session.user.id) notFound();

  const range: SeriesRange = RANGES.includes(sp.range as SeriesRange)
    ? (sp.range as SeriesRange)
    : "day";

  const now = new Date();
  const [overview, series, tokens, alerts, forecast, layouts, active] = await Promise.all([
    readStationOverview(asset.id, now),
    generationSeries(asset.id, range, now),
    readAssetTokens({
      assetId: asset.id,
      from: new Date(now.getTime() - 30 * 24 * 3_600_000),
      to: now,
    }),
    prisma.assetAlert.findMany({
      where: { assetId: asset.id, resolvedAt: null },
      orderBy: { occurredAt: "desc" },
    }),
    readSpotForecast(asset.gridZoneId, 24, now),
    readLayouts(session.user.id),
    readActiveLayout(session.user.id, sp.layout ?? null),
  ]);

  const currency = asset.gridZone.currency;
  const hasStorage = asset.storageKwh != null && num(asset.storageKwh) > 0;
  const socPct =
    hasStorage && asset.storageKwh != null
      ? Math.min(100, (num(asset.storedKwh) / num(asset.storageKwh)) * 100)
      : null;
  const spot = asset.gridZone.spotPrice == null ? null : num(asset.gridZone.spotPrice);

  const figures = figureValues({
    overview,
    tokens: {
      mintedKwh: tokens.mintedKwh,
      soldKwh: tokens.soldKwh,
      availableKwh: tokens.availableKwh,
      storedKwh: tokens.storedKwh,
      routedKwh: tokens.routedKwh,
    },
    currency,
    socPct,
    spotPrice: spot,
  });

  // Виджет без накопителя не рисуется пустым, а просто выпадает.
  const catalogue = WIDGET_KEYS.filter((key) => hasStorage || !isStorageWidget(key));
  const layout = active.widgets.filter((w) => catalogue.includes(w.key));
  const names = Object.fromEntries(catalogue.map((k) => [k, t(`widget.${k}`)]));

  const href = (next: { asset?: string; range?: string; layout?: string }) => {
    const query = new URLSearchParams({
      asset: next.asset ?? asset.id,
      range: next.range ?? range,
      ...(next.layout ?? active.name ? { layout: next.layout ?? active.name! } : {}),
    });
    return `/${locale}/app/station?${query}`;
  };

  const chart = (
    <div className="rounded-lg border border-hairline bg-card px-3 py-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[10px] uppercase tracking-[0.16em] text-muted">{t("chart")}</h2>
        <nav className="flex gap-1.5">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={href({ range: r })}
              prefetch={false}
              data-testid={`station-range-${r}`}
              className={`rounded-full border px-2.5 py-1 text-[11px] ${
                r === range ? "border-accent text-accent" : "border-hairline text-muted"
              }`}
            >
              {t(`range.${r}`)}
            </Link>
          ))}
        </nav>
      </div>
      <div className="mt-2">
        <GenerationChart series={series} emptyLabel={t("chartEmpty")} />
      </div>
    </div>
  );

  return (
    <Screen title={t("title")} back={`/${locale}/app/more`}>
      {assets.length > 1 && (
        <nav className="mt-2 flex flex-wrap gap-1.5" data-testid="station-assets">
          {assets.map((a) => (
            <Link
              key={a.id}
              href={href({ asset: a.id })}
              prefetch={false}
              className={`rounded-full border px-3 py-1.5 text-[12px] ${
                a.id === asset.id ? "border-accent text-accent" : "border-hairline text-muted"
              }`}
            >
              {a.name}
            </Link>
          ))}
        </nav>
      )}

      <div className="mt-3">
        <StationLive
          channel={telemetryChannel(asset.id)}
          labels={{ live: t("live"), offline: t("offline") }}
        />
      </div>

      {/* US-18 — замолчавший объект не держит старую цифру за свежую. */}
      {overview.stale && overview.lastReadingAt && (
        <p className="mt-2 text-[13px] text-amber-500" data-testid="station-stale">
          {t("stale")}{" "}
          <span className="num">{overview.lastReadingAt.toLocaleString(locale)}</span>
        </p>
      )}
      {overview.lastReadingAt == null && (
        <p className="mt-2 text-[13px] text-muted" data-testid="station-never">
          {t("never")}
        </p>
      )}

      <StationPanel
        layout={layout}
        figures={figures}
        names={names}
        complex={{
          generationChart: chart,
          priceForecast: (
            <div
              className="rounded-lg border border-hairline bg-card px-3 py-3"
              data-testid="station-forecast"
            >
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted">
                {t("widget.priceForecast")}
              </div>
              {forecast.length === 0 ? (
                <p className="mt-1 text-[13px] text-muted">{t("noForecast")}</p>
              ) : (
                <ul className="mt-1 text-[12px]">
                  {forecast.slice(0, 8).map((f) => (
                    <li key={f.intervalStart} className="flex justify-between py-0.5">
                      <span className="num text-muted">{f.intervalStart.slice(11, 16)}</span>
                      <span className="num">
                        {f.price.toFixed(4)} {currency}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ),
          alerts: (
            <div className="rounded-lg border border-hairline bg-card px-3 py-3">
              <AssetAlerts
                alerts={alerts.map((a) => ({
                  id: a.id,
                  kind: a.kind,
                  note: a.note,
                  occurredAt: a.occurredAt.toISOString(),
                  notified: a.notifiedAt != null,
                }))}
                labels={{
                  title: t("alerts.title"),
                  none: t("alerts.none"),
                  notified: t("alerts.notified"),
                  pending: t("alerts.pending"),
                  notePlaceholder: t("alerts.notePlaceholder"),
                  clear: t("alerts.clear"),
                  kind: {
                    TELEMETRY_ANOMALY: t("alerts.kind.TELEMETRY_ANOMALY"),
                    LINK_LOST: t("alerts.kind.LINK_LOST"),
                    SUSPENDED: t("alerts.kind.SUSPENDED"),
                  },
                }}
              />
            </div>
          ),
          equipment: (
            <div
              className="rounded-lg border border-hairline bg-card px-3 py-3"
              data-testid="station-equipment"
            >
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted">
                {t("equipmentKeys")}
              </div>
              {asset.apiKeys.length === 0 ? (
                <p className="mt-1 text-[13px] text-muted">{t("noKeys")}</p>
              ) : (
                <ul className="mt-1 divide-y divide-hairline text-[13px]">
                  {asset.apiKeys.map((key) => (
                    <li key={key.id} className="flex justify-between py-1.5">
                      <span>
                        {key.label ?? "—"}{" "}
                        <span className="num text-muted">{key.prefix}…</span>
                      </span>
                      <span className="text-[11px] text-muted">
                        {key.revokedAt
                          ? t("revoked")
                          : key.lastUsedAt
                            ? new Date(key.lastUsedAt).toLocaleDateString(locale)
                            : t("never")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ),
        }}
      />

      {/* US-27 — выбрать раскладку можно здесь, собирают их в кабинете. */}
      {layouts.length > 0 && (
        <section className="mt-6" data-testid="station-layouts">
          <h2 className="text-[12px] uppercase tracking-[0.16em] text-muted">{t("panel")}</h2>
          <nav className="mt-2 flex flex-wrap gap-1.5">
            {layouts.map((l) => (
              <Link
                key={l.name}
                href={href({ layout: l.name })}
                prefetch={false}
                className={`rounded-full border px-3 py-1.5 text-[12px] ${
                  l.name === active.name
                    ? "border-accent text-accent"
                    : "border-hairline text-muted"
                }`}
              >
                {l.name}
              </Link>
            ))}
          </nav>
          <p className="mt-2 text-[11px] leading-snug text-muted">{t("panelHint")}</p>
        </section>
      )}

      {/* §30 «Правила продажи» — то же серверное действие, что в кабинете. */}
      <section className="mt-6" data-testid="station-rules">
        <SaleRulesForm
          assetId={asset.id}
          initial={{
            minSalePrice: asset.minSalePrice ? num(asset.minSalePrice) : null,
            shareToMarketPct: asset.shareToMarketPct,
            shareToStoragePct: asset.shareToStoragePct,
            shareToSelfPct: asset.shareToSelfPct,
            reserveSocPct: asset.reserveSocPct ?? 0,
          }}
          canStore={hasStorage}
          labels={{
            rules: t("saleRules.rules"),
            rulesHelp: t("saleRules.rulesHelp"),
            minSalePrice: t("saleRules.minSalePrice"),
            shareToMarket: t("saleRules.shareToMarket"),
            shareToStorage: t("saleRules.shareToStorage"),
            shareToSelf: t("saleRules.shareToSelf"),
            reserveSoc: t("saleRules.reserveSoc"),
            saveRules: t("saleRules.saveRules"),
            saving: t("saleRules.saving"),
            saved: t("saleRules.saved"),
          }}
        />
      </section>

      {/* §30 «Удалённые команды» — честно про то, чего нет. */}
      <p className="mt-6 text-[11px] leading-snug text-muted" data-testid="station-commands">
        {t("commands")}
      </p>
    </Screen>
  );
}
