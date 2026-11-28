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
  const tPayment = await getTranslations("points.payment");

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
    // Три раздела, геопозиция, страна, оплата — всё новое от 2026-11-28.
    tab_list: t("tabStations"),
    tab_operators: t("tabOperators"),
    tab_map: t("tabMap"),
    nearMe: t("nearMe"),
    locating: t("locating"),
    country: t("country"),
    sortDistance: t("sortDistance"),
    noOperators: t("noOperators"),
    payments: t("payments"),
    back: t("back"),
    payment_TOKEN: tPayment("TOKEN"),
    payment_POOLWATT_CARD: tPayment("POOLWATT_CARD"),
    payment_WHITE_LABEL_CARD: tPayment("WHITE_LABEL_CARD"),
    payment_BANK_CARD: tPayment("BANK_CARD"),
    payment_QR: tPayment("QR"),
  };

  // US-23 — the filters live in the address, so the view a driver found is a
  // link they can keep and send.
  const one = (key: string) =>
    typeof sp[key] === "string" ? (sp[key] as string) : "";

  const view = one("view");

  return (
    <>
      {/* Заголовок страницы скрытый: три раздела под ним названы словами, и
          повторять имя страницы крупно — отнимать у телефона первый экран.
          Имя документу всё равно нужно: без него страница безымянна для
          читалки экрана. */}
      <h1 className="sr-only">{t("title")}</h1>
      <NavigatorClient
        labels={labels}
        initialView={view === "map" || view === "operators" ? view : "list"}
        initialFilters={{
          connector: (one("connector") as never) || "",
          power: (one("power") as never) || "",
          status: one("status"),
          query: one("q"),
          country: one("country"),
          operator: one("operator"),
          sort: (one("sort") as never) || "distance",
          freeOnly: one("free") === "1",
        }}
      />
    </>
  );
}
