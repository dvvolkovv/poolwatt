// §27 «Карта и список пунктов» на телефоне. Экран внутри вкладки «Зарядка»:
// нижняя панель остаётся на пяти вкладках, потому что палец попадает в пять.
//
// Фильтры приходят в адресе страницы и уезжают в него же — найденный вид это
// ссылка, которую можно сохранить и отправить. `?open=<id>` открывает
// мини-карточку сразу: так на пункт можно дать ссылку с карты.

import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { parseMapFilters } from "@/lib/mobile/map-filters";
import { loadPointAsStation } from "@/lib/points/point-detail";
import { PointMap } from "@/components/mobile/point-map";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MapScreen({ params, searchParams }: Props) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("app.map");
  const tRoute = await getTranslations("route");

  const one = (key: string) => (typeof sp[key] === "string" ? (sp[key] as string) : "");
  const filters = parseMapFilters(
    new URLSearchParams(
      Object.entries(sp).flatMap(([k, v]) =>
        typeof v === "string" ? ([[k, v]] as [string, string][]) : [],
      ),
    ),
  );

  const open = one("open");
  const initialStation = open ? await loadPointAsStation(open) : null;

  const lat = Number(one("lat"));
  const lng = Number(one("lng"));
  const zoom = Number(one("z"));
  const initialView =
    Number.isFinite(lat) && Number.isFinite(lng) && one("lat") !== "" && one("lng") !== ""
      ? { lat, lng, zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 13 }
      : null;

  const labels = {
    filters: t("filters"),
    apply: t("apply"),
    reset: t("reset"),
    type: t("type"),
    connector: t("connector"),
    power: t("power"),
    free: t("free"),
    maxFiat: t("maxFiat"),
    maxTokens: t("maxTokens"),
    open24: t("open24"),
    pay: t("pay"),
    green: t("green"),
    greenHint: t("greenHint"),
    any: t("any"),
    oursOnly: t("oursOnly"),
    locate: t("locate"),
    locateDenied: t("locateDenied"),
    empty: t("empty"),
    loading: t("loading"),
    found: t("found"),
    charge: t("charge"),
    details: t("details"),
    freeOf: t("freeOf"),
    priceTokens: t("priceTokens"),
    priceUtc: t("priceUtc"),
    foreignPin: t("foreignPin"),
    pointType: {
      CHARGING_STATION: t("pointType.CHARGING_STATION"),
      POWERBANK: t("pointType.POWERBANK"),
      GENERATION: t("pointType.GENERATION"),
      MIXED: t("pointType.MIXED"),
    },
    availability: {
      FREE: t("availability.FREE"),
      BUSY: t("availability.BUSY"),
      OUT_OF_SERVICE: t("availability.OUT_OF_SERVICE"),
      BOOKED: t("availability.BOOKED"),
      UNKNOWN: t("availability.UNKNOWN"),
    },
    payMethod: {
      TOKEN: t("payMethod.TOKEN"),
      POOLWATT_CARD: t("payMethod.POOLWATT_CARD"),
      WHITE_LABEL_CARD: t("payMethod.WHITE_LABEL_CARD"),
      BANK_CARD: t("payMethod.BANK_CARD"),
      QR: t("payMethod.QR"),
    },
    powerLevel: {
      ac_slow: t("powerLevel.ac_slow"),
      ac_fast: t("powerLevel.ac_fast"),
      dc_fast: t("powerLevel.dc_fast"),
      dc_ultra: t("powerLevel.dc_ultra"),
    },
  };

  const routeLabels = {
    route: tRoute("route"),
    openIn: tRoute("openIn"),
    system: tRoute("system"),
    google: tRoute("google"),
    apple: tRoute("apple"),
    waze: tRoute("waze"),
    cancel: tRoute("cancel"),
  };

  // Карта занимает всё, что остаётся между заголовком и нижней панелью:
  // `Screen` даёт колонку с отступами, а карте нужен весь экран.
  return (
    <div className="flex h-[100dvh] flex-col px-0 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <header className="flex h-12 shrink-0 items-center gap-3 px-4">
        <Link
          href={`/${locale}/app/charge`}
          aria-label={t("title")}
          className="-ml-1 px-1 text-[20px] leading-none text-muted"
        >
          ‹
        </Link>
        <h1 className="text-[20px] font-semibold tracking-[-0.01em]">{t("title")}</h1>
      </header>
      <div className="min-h-0 flex-1 pb-20">
        <PointMap
          locale={locale}
          initialFilters={filters}
          initialStation={initialStation}
          initialView={initialView}
          labels={labels}
          routeLabels={routeLabels}
        />
      </div>
    </div>
  );
}
