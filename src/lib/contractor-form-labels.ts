import { getTranslations } from "next-intl/server";

export type ContractorFormLabels = {
  section: { identity: string; work: string; contact: string };
  field: Record<string, Record<string, string>>;
  action: { submit: string; save: string };
};

export async function getContractorFormLabels(): Promise<ContractorFormLabels> {
  const t = await getTranslations("cabinet.contractor");
  return {
    section: {
      identity: t("new.section.identity"),
      work: t("new.section.work"),
      contact: t("new.section.contact"),
    },
    field: {
      entityType: { label: t("field.entityType.label"), LEGAL_ENTITY: t("field.entityType.LEGAL_ENTITY"), SOLE_TRADER: t("field.entityType.SOLE_TRADER"), INDIVIDUAL: t("field.entityType.INDIVIDUAL") },
      displayName: { label: t("field.displayName.label") },
      legalName: { label: t("field.legalName.label") },
      registrationNumber: { label: t("field.registrationNumber.label") },
      country: { label: t("field.country.label") },
      city: { label: t("field.city.label") },
      foundedYear: { label: t("field.foundedYear.label") },
      workCategories: { label: t("field.workCategories.label"), DESIGN: t("field.workCategories.DESIGN"), MANUFACTURE: t("field.workCategories.MANUFACTURE"), SUPPLY: t("field.workCategories.SUPPLY"), INSTALLATION: t("field.workCategories.INSTALLATION"), COMMISSIONING: t("field.workCategories.COMMISSIONING"), MAINTENANCE: t("field.workCategories.MAINTENANCE") },
      renewableTypes: { label: t("field.renewableTypes.label"), SOLAR: t("field.renewableTypes.SOLAR"), WIND: t("field.renewableTypes.WIND"), HYDRO: t("field.renewableTypes.HYDRO"), BIOMASS: t("field.renewableTypes.BIOMASS"), GEOTHERMAL: t("field.renewableTypes.GEOTHERMAL"), HYBRID: t("field.renewableTypes.HYBRID") },
      countriesServed: { label: t("field.countriesServed.label") },
      bio: { label: t("field.bio.label") },
      websiteUrl: { label: t("field.websiteUrl.label") },
      logoUrl: { label: t("field.logoUrl.label") },
      contactEmail: { label: t("field.contactEmail.label") },
      contactPhone: { label: t("field.contactPhone.label") },
    },
    action: { submit: t("action.submit"), save: t("action.save") },
  };
}
