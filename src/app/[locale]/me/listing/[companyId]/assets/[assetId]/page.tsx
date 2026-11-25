// The station console — ТЗ §30, US-18, US-26 and US-27. One page per asset:
// what it is generating, what it has generated, what that earned, and the
// state of the equipment behind it — arranged the way its owner arranged it.

import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/exchange/decimal";
import { telemetryChannel } from "@/lib/exchange/realtime";
import { generationSeries, readStationOverview, type SeriesRange } from "@/lib/exchange/station-service";
import { readAssetTokens } from "@/lib/exchange/telemetry-service";
import { readSpotForecast } from "@/lib/exchange/spot-service";
import { readActiveLayout, readLayouts } from "@/lib/dashboard/dashboard-service";
import { WIDGET_KEYS, WIDGET_SIZES, isStorageWidget, type WidgetKey } from "@/lib/dashboard/widgets";
import { AssetAlerts } from "@/components/listing/asset-alerts";
import { DashboardEditor } from "@/components/listing/dashboard-editor";
import { GenerationChart } from "@/components/listing/generation-chart";
import { StationLive } from "@/components/listing/station-live";

export const dynamic = "force-dynamic";

const RANGES: SeriesRange[] = ["day", "week", "month"];

export default async function StationConsole({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; companyId: string; assetId: string }>;
  searchParams: Promise<{ range?: string; layout?: string }>;
}) {
  const { locale, companyId, assetId } = await params;
  const { range: rangeParam, layout: layoutParam } = await searchParams;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(
      `/${locale}/login?callbackUrl=/${locale}/me/listing/${companyId}/assets/${assetId}`,
    );
  }

  const t = await getTranslations("cabinet.station");

  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    include: {
      company: { select: { id: true, legalName: true, ownerUserId: true } },
      gridZone: {
        select: {
          id: true,
          code: true,
          currency: true,
          intervalMinutes: true,
          spotPrice: true,
          spotPriceAt: true,
        },
      },
      apiKeys: { orderBy: { createdAt: "desc" }, select: { id: true, label: true, prefix: true, lastUsedAt: true, revokedAt: true } },
    },
  });
  if (!asset || asset.companyId !== companyId) notFound();
  if (asset.company.ownerUserId !== session.user.id && session.user.role !== "ADMIN") notFound();

  const range: SeriesRange = RANGES.includes(rangeParam as SeriesRange)
    ? (rangeParam as SeriesRange)
    : "day";

  const now = new Date();
  const [overview, series, tokens, anomalies, alerts, forecast, layouts, active] =
    await Promise.all([
    readStationOverview(assetId, now),
    generationSeries(assetId, range, now),
    readAssetTokens({
      assetId,
      from: new Date(now.getTime() - 30 * 24 * 3_600_000),
      to: now,
    }),
    prisma.meterReading.findMany({
      where: { assetId, validationStatus: { in: ["SUSPICIOUS", "REJECTED"] } },
      orderBy: { intervalStart: "desc" },
      take: 5,
      select: { intervalStart: true, validationStatus: true, validationNote: true },
    }),
    prisma.assetAlert.findMany({
      where: { assetId, resolvedAt: null },
      orderBy: { occurredAt: "desc" },
    }),
    // §30 "Текущая цена в зоне и прогноз на 24 часа".
    readSpotForecast(asset.gridZoneId, 24, now),
    // US-27 — the producer's own panels.
    readLayouts(session.user.id),
    readActiveLayout(session.user.id, layoutParam ?? null),
  ]);

  const currency = asset.gridZone.currency;
  const hasStorage = asset.storageKwh != null && num(asset.storageKwh) > 0;

  // US-27 — every widget of the catalogue, drawn once here and arranged by
  // the saved layout below. A widget that needs a storage is dropped for an
  // asset without one rather than drawn empty.
  const catalogue = WIDGET_KEYS.filter((key) => hasStorage || !isStorageWidget(key));
  const widgets = active.widgets.filter((w) => catalogue.includes(w.key));
  const widgetNames = Object.fromEntries(
    catalogue.map((key) => [key, t(`widget.${key}`)]),
  ) as Record<string, string>;

  const soc =
    hasStorage && asset.storageKwh != null
      ? Math.min(100, (num(asset.storedKwh) / num(asset.storageKwh)) * 100)
      : null;
  const spot = asset.gridZone.spotPrice == null ? null : num(asset.gridZone.spotPrice);

  const nodes: Record<WidgetKey, React.ReactNode> = {
    nowKw: (
      <Figure
        label={t("nowKw")}
        value={overview.nowKw == null ? "—" : overview.nowKw.toFixed(3)}
        unit="kW"
        testId="station-now-kw"
        big
      />
    ),
    today: <Figure label={t("today")} value={overview.todayKwh.toFixed(3)} unit="kWh" testId="station-today" />,
    week: <Figure label={t("week")} value={overview.weekKwh.toFixed(3)} unit="kWh" />,
    month: <Figure label={t("month")} value={overview.monthKwh.toFixed(3)} unit="kWh" />,
    year: <Figure label={t("year")} value={overview.yearKwh.toFixed(3)} unit="kWh" />,
    efficiency: (
      <Figure
        label={t("efficiency")}
        value={overview.efficiency == null ? "—" : `${(overview.efficiency * 100).toFixed(1)}`}
        unit="%"
      />
    ),
    revenue: (
      <Figure
        label={t("revenue")}
        value={overview.revenue.net.toFixed(2)}
        unit={currency}
        testId="station-revenue"
      />
    ),
    avgPrice: (
      <Figure
        label={t("avgPrice")}
        value={overview.revenue.avgPrice == null ? "—" : overview.revenue.avgPrice.toFixed(4)}
        unit={`${currency}/kWh`}
      />
    ),
    minted: <Figure label={t("minted")} value={tokens.mintedKwh.toFixed(3)} unit="kWh" />,
    sold: <Figure label={t("sold")} value={tokens.soldKwh.toFixed(3)} unit="kWh" />,
    unsold: <Figure label={t("unsold")} value={tokens.availableKwh.toFixed(3)} unit="kWh" />,
    stored: <Figure label={t("stored")} value={tokens.storedKwh.toFixed(3)} unit="kWh" />,
    routed: <Figure label={t("routed")} value={tokens.routedKwh.toFixed(3)} unit="kWh" />,
    storageSoc: (
      <Figure
        label={t("widget.storageSoc")}
        value={soc == null ? "—" : soc.toFixed(1)}
        unit="%"
        testId="station-soc"
      />
    ),
    zonePrice: (
      <Figure
        label={t("widget.zonePrice")}
        value={spot == null ? "—" : spot.toFixed(4)}
        unit={`${currency}/kWh`}
        testId="station-zone-price"
      />
    ),
    priceForecast: (
      <div className="rounded border border-hairline p-3" data-testid="station-forecast">
        <div className="text-[11px] uppercase tracking-[0.14em] text-muted">
          {t("widget.priceForecast")}
        </div>
        {forecast.length === 0 ? (
          <p className="mt-1 text-[13px] text-muted">{t("noForecast")}</p>
        ) : (
          <ul className="mt-1 text-[12px]">
            {forecast.slice(0, 6).map((f) => (
              <li key={f.intervalStart} className="flex justify-between">
                <span className="num text-muted">{f.intervalStart.slice(11, 16)}</span>
                <span className="num">{f.price.toFixed(4)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    ),
    generationChart: (
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[13px] uppercase tracking-[0.14em] text-muted">{t("chart")}</h2>
          <nav className="flex gap-2 text-[13px]">
            {RANGES.map((r) => (
              <Link
                key={r}
                href={`/${locale}/me/listing/${companyId}/assets/${assetId}?range=${r}${
                  active.name ? `&layout=${encodeURIComponent(active.name)}` : ""
                }`}
                prefetch={false}
                className={`rounded border px-2 py-1 ${
                  r === range ? "border-accent text-accent" : "border-hairline text-muted"
                }`}
              >
                {t(`range.${r}`)}
              </Link>
            ))}
          </nav>
        </div>
        <GenerationChart series={series} emptyLabel={t("chartEmpty")} />
      </div>
    ),
    alerts: (
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
    ),
    equipment: (
      <div>
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">
          {t("equipment")}
        </h2>
        <ul className="text-sm divide-y divide-hairline">
          {asset.apiKeys.length === 0 && <li className="py-2 text-muted">{t("noKeys")}</li>}
          {asset.apiKeys.map((key) => (
            <li key={key.id} className="flex justify-between py-2">
              <span>
                {key.label ?? "—"} <span className="num text-muted">{key.prefix}…</span>
              </span>
              <span className="num text-[12px] text-muted">
                {key.revokedAt
                  ? t("revoked")
                  : key.lastUsedAt
                    ? key.lastUsedAt.toISOString().slice(0, 16).replace("T", " ")
                    : t("neverUsed")}
              </span>
            </li>
          ))}
        </ul>

        {anomalies.length > 0 && (
          <ul className="mt-4 text-[13px] text-down space-y-1" data-testid="station-anomalies">
            {anomalies.map((a) => (
              <li key={a.intervalStart.toISOString()}>
                <span className="num">{a.intervalStart.toISOString().slice(0, 16).replace("T", " ")}</span>{" "}
                · {a.validationStatus}
                {a.validationNote && <> · {a.validationNote}</>}
              </li>
            ))}
          </ul>
        )}
      </div>
    ),
  };

  return (
    <div>
      <Link
        href={`/${locale}/me/listing/${companyId}/assets`}
        prefetch={false}
        className="text-[13px] text-muted underline hover:text-foreground"
      >
        ← {t("back")}
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{t("eyebrow")}</div>
          <h1 className="text-[28px] font-bold">{asset.name}</h1>
          <p className="text-[13px] text-muted">
            {asset.company.legalName} · {asset.gridZone.code} · {t("capacity")}{" "}
            <span className="num">{num(asset.capacityKw).toFixed(3)}</span> kW
          </p>
        </div>
        <StationLive
          channel={telemetryChannel(assetId)}
          labels={{ live: t("live"), offline: t("offline") }}
        />
      </div>

      {overview.stale && (
        <p
          data-testid="station-stale"
          className="mt-4 rounded border border-down/40 px-3 py-2 text-[13px] text-down"
        >
          {t("stale")}
        </p>
      )}

      {/* US-27 — the panel as its owner arranged it (§30). */}
      {layouts.length > 0 && (
        <nav className="mt-6 flex flex-wrap gap-2 text-[13px]" data-testid="layout-tabs">
          {layouts.map((l) => (
            <Link
              key={l.id}
              href={`/${locale}/me/listing/${companyId}/assets/${assetId}?range=${range}&layout=${encodeURIComponent(l.name)}`}
              prefetch={false}
              className={`rounded border px-2 py-1 ${
                l.name === active.name ? "border-accent text-accent" : "border-hairline text-muted"
              }`}
            >
              {l.name}
            </Link>
          ))}
        </nav>
      )}

      <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="widget-grid">
        {widgets.map(({ key, size }) => (
          <div key={key} className={size === "L" ? "col-span-2 md:col-span-4" : size === "M" ? "col-span-2" : ""}>
            {nodes[key]}
          </div>
        ))}
      </section>

      <DashboardEditor
        initial={widgets}
        initialName={active.name}
        catalogue={catalogue}
        widgetNames={widgetNames}
        sizes={[...WIDGET_SIZES]}
        labels={{
          title: t("panel.title"),
          help: t("panel.help"),
          name: t("panel.name"),
          add: t("panel.add"),
          remove: t("panel.remove"),
          up: t("panel.up"),
          down: t("panel.down"),
          size: t("panel.size"),
          save: t("panel.save"),
          saved: t("panel.saved"),
          delete: t("panel.delete"),
          makeDefault: t("panel.makeDefault"),
          newName: t("panel.newName"),
        }}
      />

    </div>
  );
}

function Figure({
  label,
  value,
  unit,
  testId,
  big,
}: {
  label: string;
  value: string;
  unit: string;
  testId?: string;
  big?: boolean;
}) {
  return (
    <div className="rounded border border-hairline p-3">
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className={`num mt-1 ${big ? "text-[24px] font-semibold" : "text-[16px]"}`}>
        <span data-testid={testId}>{value}</span>
        <span className="ml-1 text-[12px] text-muted">{unit}</span>
      </div>
    </div>
  );
}
