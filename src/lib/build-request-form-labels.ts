import { getTranslations } from "next-intl/server";

export type BuildRequestFormLabels = {
  section: { what: string; where: string; money: string; contact: string };
  field: Record<string, Record<string, string>>;
  action: { submit: string; save: string };
  error: { phoneRequired: string };
};

export async function getBuildRequestFormLabels(): Promise<BuildRequestFormLabels> {
  const t = await getTranslations("cabinet.buildRequest");
  return {
    section: {
      what: t("new.section.what"),
      where: t("new.section.where"),
      money: t("new.section.money"),
      contact: t("new.section.contact"),
    },
    field: {
      source: { label: t("field.source.label"), SOLAR: t("field.source.SOLAR"), WIND: t("field.source.WIND"), HYBRID: t("field.source.HYBRID") },
      peakKw: { label: t("field.peakKw.label") },
      wantPowerbank: { label: t("field.wantPowerbank.label") },
      powerbankKwh: { label: t("field.powerbankKwh.label") },
      wantEvCharger: { label: t("field.wantEvCharger.label") },
      evChargerPorts: { label: t("field.evChargerPorts.label") },
      evPublicForSale: { label: t("field.evPublicForSale.label") },
      country: { label: t("field.country.label") },
      city: { label: t("field.city.label") },
      addressLine: { label: t("field.addressLine.label") },
      siteType: { label: t("field.siteType.label"), PRIVATE_HOUSE: t("field.siteType.PRIVATE_HOUSE"), APARTMENT_ROOF: t("field.siteType.APARTMENT_ROOF"), LAND_PLOT: t("field.siteType.LAND_PLOT"), COMMERCIAL: t("field.siteType.COMMERCIAL") },
      availableAreaM2: { label: t("field.availableAreaM2.label") },
      roofOrientation: { label: t("field.roofOrientation.label"), S: t("field.roofOrientation.S"), SE: t("field.roofOrientation.SE"), SW: t("field.roofOrientation.SW"), E: t("field.roofOrientation.E"), W: t("field.roofOrientation.W"), UNKNOWN: t("field.roofOrientation.UNKNOWN") },
      budget: { label: t("field.budget.label"), UNDER_5K: t("field.budget.UNDER_5K"), FROM_5K_TO_15K: t("field.budget.FROM_5K_TO_15K"), FROM_15K_TO_30K: t("field.budget.FROM_15K_TO_30K"), FROM_30K_TO_60K: t("field.budget.FROM_30K_TO_60K"), OVER_60K: t("field.budget.OVER_60K"), AWAITING_QUOTE: t("field.budget.AWAITING_QUOTE") },
      timeline: { label: t("field.timeline.label"), URGENT_1_3M: t("field.timeline.URGENT_1_3M"), WITHIN_YEAR: t("field.timeline.WITHIN_YEAR"), EXPLORING: t("field.timeline.EXPLORING") },
      notes: { label: t("field.notes.label") },
    },
    action: { submit: t("action.submit"), save: t("action.save") },
    error: { phoneRequired: t("error.phoneRequired") },
  };
}
