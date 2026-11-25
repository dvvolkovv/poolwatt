import { describe, it, expect } from "vitest";
import { visibleTabs, moreSections } from "./tabs";

describe("visibleTabs — §20", () => {
  it("shows a guest only the map, the main screen and the profile", () => {
    expect(visibleTabs("GUEST")).toEqual(["home", "charge", "profile"]);
  });

  it("gives a consumer the wallet and the hub", () => {
    expect(visibleTabs("CONSUMER")).toEqual([
      "home",
      "wallet",
      "charge",
      "more",
      "profile",
    ]);
  });

  it("never offers more than five tabs", () => {
    for (const status of ["GUEST", "CONSUMER", "PROSUMER", "COOP_MEMBER"] as const) {
      expect(visibleTabs(status).length).toBeLessThanOrEqual(5);
    }
  });
});

describe("moreSections — §22", () => {
  it("offers a guest nothing: every section needs KYC", () => {
    expect(
      moreSections({ status: "GUEST", hasAsset: false, isCoopMember: false }),
    ).toEqual([]);
  });

  it("offers a consumer the account, the card, contacts and roaming", () => {
    expect(
      moreSections({ status: "CONSUMER", hasAsset: false, isCoopMember: false }),
    ).toEqual(["account", "card", "contacts", "roaming"]);
  });

  it("puts the station first for a prosumer", () => {
    expect(
      moreSections({ status: "PROSUMER", hasAsset: true, isCoopMember: false })[0],
    ).toBe("station");
  });

  it("keeps both the station and the cooperative for a member who produces", () => {
    const sections = moreSections({
      status: "COOP_MEMBER",
      hasAsset: true,
      isCoopMember: true,
    });
    expect(sections).toContain("station");
    expect(sections).toContain("coop");
  });

  it("gives a member without a station no station section", () => {
    expect(
      moreSections({ status: "COOP_MEMBER", hasAsset: false, isCoopMember: true }),
    ).not.toContain("station");
  });
});
