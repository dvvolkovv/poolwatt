import { getTranslations } from "next-intl/server";

export type ContractorFormLabels = {
  section: { identity: string; work: string; contact: string; ev: string };
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
      ev: t("new.section.ev"),
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
      providesEvCharging: { label: t("field.providesEvCharging.label") },
      evPowerSource: {
        label: t("field.evPowerSource.label"),
        GRID: t("field.evPowerSource.GRID"),
        MIXED: t("field.evPowerSource.MIXED"),
        RENEWABLE_ONLY: t("field.evPowerSource.RENEWABLE_ONLY"),
      },
      evStationCount: { label: t("field.evStationCount.label") },
      evConnectorTypes: {
        label: t("field.evConnectorTypes.label"),
        CCS2: t("field.evConnectorTypes.CCS2"),
        CHAdeMO: t("field.evConnectorTypes.CHAdeMO"),
        TYPE2: t("field.evConnectorTypes.TYPE2"),
        TYPE1: t("field.evConnectorTypes.TYPE1"),
        TESLA: t("field.evConnectorTypes.TESLA"),
        GB_T: t("field.evConnectorTypes.GB_T"),
        SCHUKO: t("field.evConnectorTypes.SCHUKO"),
      },
      evPowerLevels: {
        label: t("field.evPowerLevels.label"),
        AC_SLOW: t("field.evPowerLevels.AC_SLOW"),
        AC_FAST: t("field.evPowerLevels.AC_FAST"),
        DC_FAST: t("field.evPowerLevels.DC_FAST"),
        DC_ULTRA: t("field.evPowerLevels.DC_ULTRA"),
      },
      evUsageType: {
        label: t("field.evUsageType.label"),
        PUBLIC: t("field.evUsageType.PUBLIC"),
        MEMBERSHIP: t("field.evUsageType.MEMBERSHIP"),
        PRIVATE: t("field.evUsageType.PRIVATE"),
        PAY_AT_LOCATION: t("field.evUsageType.PAY_AT_LOCATION"),
      },
      evMaxPowerKw: { label: t("field.evMaxPowerKw.label") },
      evDescription: { label: t("field.evDescription.label"), placeholder: t("field.evDescription.placeholder") },
    },
    action: { submit: t("action.submit"), save: t("action.save") },
  };
}
