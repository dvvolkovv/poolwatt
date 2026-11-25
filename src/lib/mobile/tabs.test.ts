import { describe, it, expect } from "vitest";
import { visibleTabs, moreSections } from "./tabs";

describe("visibleTabs — §20", () => {
  it("shows a visitor only the map, the main screen and the profile", () => {
    expect(visibleTabs(false)).toEqual(["home", "charge", "profile"]);
  });

  it("gives a signed-in account the wallet and the hub", () => {
    expect(visibleTabs(true)).toEqual([
      "home",
      "wallet",
      "charge",
      "more",
      "profile",
    ]);
  });

  it("never offers more than five tabs", () => {
    expect(visibleTabs(true).length).toBeLessThanOrEqual(5);
    expect(visibleTabs(false).length).toBeLessThanOrEqual(5);
  });
});

describe("moreSections — §22", () => {
  it("offers a visitor nothing: every section needs an account", () => {
    expect(
      moreSections({ signedIn: false, hasAsset: false, isCoopMember: false }),
    ).toEqual([]);
  });

  it("offers a plain account the account, the card, contacts and roaming", () => {
    expect(
      moreSections({ signedIn: true, hasAsset: false, isCoopMember: false }),
    ).toEqual(["account", "card", "contacts", "roaming"]);
  });

  it("puts the station first for a prosumer", () => {
    expect(
      moreSections({ signedIn: true, hasAsset: true, isCoopMember: false })[0],
    ).toBe("station");
  });

  it("keeps both the station and the cooperative for a member who produces", () => {
    const sections = moreSections({
      signedIn: true,
      hasAsset: true,
      isCoopMember: true,
    });
    expect(sections).toContain("station");
    expect(sections).toContain("coop");
  });

  it("gives a member without a station no station section", () => {
    expect(
      moreSections({ signedIn: true, hasAsset: false, isCoopMember: true }),
    ).not.toContain("station");
  });
});
