import { getTranslations, setRequestLocale } from "next-intl/server";
import { NavigatorClient } from "@/components/navigator/navigator-client";

export async function generateMetadata() {
  const t = await getTranslations("navigator");
  return {
    title: `${t("title")} — Poolwatt`,
    description: t("metaDescription"),
  };
}

type Props = { params: Promise<{ locale: string }> };

export default async function NavigatorPage({ params }: Props) {
  const { locale } = await params;
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
    lastVerified: t("lastVerified"),
    directions: t("directions"),
    metaDescription: t("metaDescription"),
    sourceLive: t("sourceLive"),
    sourceCache: t("sourceCache"),
    sourceStale: t("sourceStale"),
    sourceMock: t("sourceMock"),
    errorLoad: t("errorLoad"),
    retry: t("retry"),
  };

  return <NavigatorClient labels={labels} />;
}
