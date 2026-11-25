import { describe, expect, it } from "vitest";
import {
  FeatureClosedError,
  assertCampaignFiatFundingOpen,
  assertCardTariffsOpen,
  campaignFiatFundingOpen,
  cardTariffsOpen,
  ibansOpen,
  publishableIban,
  transfersOpen,
} from "./gates";

describe("IBAN gate — ТЗ §19, §21", () => {
  it("is closed by default", () => {
    expect(ibansOpen({})).toBe(false);
    expect(ibansOpen({ NODE_ENV: "development" })).toBe(false);
  });

  it("opens only as a sandbox and never in production", () => {
    expect(ibansOpen({ IBAN_PROVIDER: "sandbox", NODE_ENV: "test" })).toBe(true);
    expect(ibansOpen({ IBAN_PROVIDER: "sandbox", NODE_ENV: "production" })).toBe(false);
    expect(ibansOpen({ IBAN_PROVIDER: "real", NODE_ENV: "test" })).toBe(false);
  });

  it("hides every stored IBAN while closed", () => {
    expect(publishableIban("LT122100000000001000", { NODE_ENV: "production", IBAN_PROVIDER: "sandbox" })).toBeNull();
    expect(publishableIban("LT122100000000001000", { NODE_ENV: "test", IBAN_PROVIDER: "sandbox" })).toBe("LT122100000000001000");
    expect(publishableIban(null, { NODE_ENV: "test", IBAN_PROVIDER: "sandbox" })).toBeNull();
  });
});

describe("transfer gate — ТЗ §24.4", () => {
  it("opens only on an explicit true", () => {
    expect(transfersOpen({})).toBe(false);
    for (const v of ["", "1", "yes", "TRUE", "false"]) {
      expect(transfersOpen({ KWH_TRANSFERS_ENABLED: v }), v).toBe(false);
    }
    expect(transfersOpen({ KWH_TRANSFERS_ENABLED: "true" })).toBe(true);
  });
});

describe("campaign money gate — ТЗ §42 'Источник финансирования'", () => {
  it("opens only on an explicit true", () => {
    expect(campaignFiatFundingOpen({})).toBe(false);
    for (const v of ["", "1", "yes", "TRUE", "false"]) {
      expect(campaignFiatFundingOpen({ CAMPAIGN_FIAT_FUNDING: v }), v).toBe(false);
    }
    expect(campaignFiatFundingOpen({ CAMPAIGN_FIAT_FUNDING: "true" })).toBe(true);
  });

  it("refuses rather than invents a reserve on an account nobody issued", () => {
    expect(() => assertCampaignFiatFundingOpen()).toThrow(FeatureClosedError);
  });
});

describe("card tariff gate — ТЗ §53", () => {
  it("opens only on an explicit true", () => {
    expect(cardTariffsOpen({})).toBe(false);
    for (const v of ["", "1", "yes", "TRUE", "false"]) {
      expect(cardTariffsOpen({ CARD_TARIFFS_ENABLED: v }), v).toBe(false);
    }
    expect(cardTariffsOpen({ CARD_TARIFFS_ENABLED: "true" })).toBe(true);
  });

  it("refuses rather than invents an interchange rate", () => {
    expect(() => assertCardTariffsOpen()).toThrow(FeatureClosedError);
  });
});
