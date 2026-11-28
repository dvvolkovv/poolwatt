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
      moreSections({ signedIn: false, hasAsset: false, isCoopMember: false, isStaff: false }),
    ).toEqual([]);
  });

  it("offers a plain account bookings, support, the account, the card, contacts and roaming", () => {
    expect(
      moreSections({ signedIn: true, hasAsset: false, isCoopMember: false, isStaff: false }),
    ).toEqual(["bookings", "support", "account", "card", "contacts", "roaming"]);
  });

  // §51.5 — заявку видно, и искать её не должно быть дольше, чем отправить.
  it("puts support before the account and the card, which still wait for the EMI", () => {
    const sections = moreSections({
      signedIn: true,
      hasAsset: false,
      isCoopMember: false,
      isStaff: false,
    });
    expect(sections.indexOf("support")).toBeLessThan(sections.indexOf("account"));
  });

  it("puts bookings before the account and the card, which still wait for the EMI", () => {
    const sections = moreSections({ signedIn: true, hasAsset: false, isCoopMember: false, isStaff: false });
    expect(sections.indexOf("bookings")).toBeLessThan(sections.indexOf("account"));
  });

  it("puts the station first for a prosumer", () => {
    expect(
      moreSections({ signedIn: true, hasAsset: true, isCoopMember: false, isStaff: false })[0],
    ).toBe("station");
  });

  it("keeps both the station and the cooperative for a member who produces", () => {
    const sections = moreSections({
      signedIn: true,
      hasAsset: true,
      isCoopMember: true,
      isStaff: false,
    });
    expect(sections).toContain("station");
    expect(sections).toContain("coop");
  });

  it("gives a member without a station no station section", () => {
    expect(
      moreSections({ signedIn: true, hasAsset: false, isCoopMember: true, isStaff: false }),
    ).not.toContain("station");
  });
});

describe("moreSections — US-49's engineer", () => {
  const base = { signedIn: true, hasAsset: false, isCoopMember: false };

  it("offers work orders to staff and to nobody else", () => {
    expect(moreSections({ ...base, isStaff: true })).toContain("work");
    expect(moreSections({ ...base, isStaff: false })).not.toContain("work");
  });

  it("puts work orders first: for an engineer it is the job, not a setting", () => {
    expect(moreSections({ ...base, isStaff: true })[0]).toBe("work");
  });

  it("puts work orders before the station for somebody who is both", () => {
    const sections = moreSections({ ...base, hasAsset: true, isStaff: true });
    expect(sections.indexOf("work")).toBeLessThan(sections.indexOf("station"));
  });

  it("shows a visitor nothing at all, staff or not", () => {
    expect(
      moreSections({ signedIn: false, hasAsset: true, isCoopMember: true, isStaff: true }),
    ).toEqual([]);
  });
});

describe("moreSections — чат команды §48", () => {
  const base = { signedIn: true, hasAsset: false, isCoopMember: false };

  it("предлагается сотруднику и никому больше", () => {
    expect(moreSections({ ...base, isStaff: true })).toContain("chat");
    expect(moreSections({ ...base, isStaff: false })).not.toContain("chat");
  });

  it("стоит сразу за нарядами: это та же работа", () => {
    const sections = moreSections({ ...base, isStaff: true });
    expect(sections.indexOf("chat")).toBe(sections.indexOf("work") + 1);
  });
});
