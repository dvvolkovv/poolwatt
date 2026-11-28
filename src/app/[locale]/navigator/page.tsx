import { getTranslations, setRequestLocale } from "next-intl/server";
import { NavigatorClient } from "@/components/navigator/navigator-client";

export async function generateMetadata() {
  const t = await getTranslations("navigator");
  return {
    title: `${t("title")} — Poolwatt`,
    description: t("metaDescription"),
  };
}

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NavigatorPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("navigator");

  const labels: Record<string, string> = {
    title: t("title"),
    loading: t("loading"),
    stationsFound: t("stationsFound"),
    searchPlaceholder: t("searchPlaceholder"),
    filters: t("filters"),
    connectorType: t("connectorType"),
    powerLevel: t("powerLevel"),
    statusLabel: t("statusLabel"),
    all: t("all"),
    status_operational: t("status_operational"),
    status_planned: t("status_planned"),
    status_temporarily_unavailable: t("status_temporarily_unavailable"),
    noStations: t("noStations"),
    pts: t("pts"),
    connections: t("connections"),
    points: t("points"),
    maxPower: t("maxPower"),
    rating: t("rating"),
    cost: t("cost"),
    priceLabel: t("priceLabel"),
    priceFallback: t("priceFallback"),
    priceLive: t("priceLive"),
    priceUpdated: t("priceUpdated"),
    sortLabel: t("sortLabel"),
    sortDefault: t("sortDefault"),
    sortPriceAsc: t("sortPriceAsc"),
    lastVerified: t("lastVerified"),
    directions: t("directions"),
    metaDescription: t("metaDescription"),
    sourceLive: t("sourceLive"),
    sourceCache: t("sourceCache"),
    sourceStale: t("sourceStale"),
    sourceMock: t("sourceMock"),
    errorLoad: t("errorLoad"),
    retry: t("retry"),
    freeNow: t("freeNow"),
    freeNowHelp: t("freeNowHelp"),
    availability_FREE: t("availability_FREE"),
    availability_BUSY: t("availability_BUSY"),
    availability_OUT_OF_SERVICE: t("availability_OUT_OF_SERVICE"),
    availability_BOOKED: t("availability_BOOKED"),
    availability_UNKNOWN: t("availability_UNKNOWN"),
    fullCard: t("fullCard"),
  };

  // US-23 — the filters live in the address, so the view a driver found is a
  // link they can keep and send.
  const one = (key: string) =>
    typeof sp[key] === "string" ? (sp[key] as string) : "";

  return (
    <>
      {/* Карта занимает весь экран (`fixed inset-0`), поэтому заголовок
          страницы — скрытый: имя у документа быть обязано, а место под него
          на карте отдавать нечему. До этого у страницы не было ни `h1`, ни
          `h2` вовсе, и для читалки экрана она была безымянной. */}
      <h1 className="sr-only">{t("title")}</h1>
      <NavigatorClient
        labels={labels}
        initialFilters={{
          connector: (one("connector") as never) || "",
          power: (one("power") as never) || "",
          status: one("status"),
          query: one("q"),
          sort: (one("sort") as never) || "default",
          freeOnly: one("free") === "1",
        }}
      />
    </>
  );
}
