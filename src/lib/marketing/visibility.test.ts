import { describe, expect, it } from "vitest";
import {
  type ContentForDisplay,
  type ViewerFacts,
  isContentLive,
  matchesAudience,
  selectForPlacement,
} from "./visibility";

const GUEST: ViewerFacts = {
  signedIn: false,
  chargesInNetwork: 0,
  coopMember: false,
  cardHolder: false,
};

function content(over: Partial<ContentForDisplay> = {}): ContentForDisplay {
  return {
    id: "c1",
    type: "BANNER",
    title: "Half price on Sundays",
    body: null,
    linkUrl: null,
    status: "APPROVED",
    placements: ["FULL_CARD"],
    audience: "ALL",
    pointIds: [],
    startsAt: null,
    endsAt: null,
    weekdays: [],
    hourFrom: null,
    hourTo: null,
    assets: [],
    ...over,
  };
}

/** 2026-11-25 is a Wednesday (weekday 3). */
const WED_NOON = new Date("2026-11-25T12:00:00.000Z");

describe("isContentLive", () => {
  it("does not show a draft", () => {
    expect(isContentLive(content({ status: "DRAFT" }), WED_NOON)).toBe(false);
  });

  it("does not show something the operator rejected", () => {
    expect(isContentLive(content({ status: "REJECTED" }), WED_NOON)).toBe(false);
  });

  it("shows approved content with no schedule at all", () => {
    expect(isContentLive(content(), WED_NOON)).toBe(true);
  });

  it("does not show it before it starts", () => {
    const c = content({ startsAt: new Date("2026-12-01T00:00:00.000Z") });
    expect(isContentLive(c, WED_NOON)).toBe(false);
  });

  it("does not show it after it ends", () => {
    const c = content({ endsAt: new Date("2026-11-24T00:00:00.000Z") });
    expect(isContentLive(c, WED_NOON)).toBe(false);
  });

  it("shows it inside its dates", () => {
    const c = content({
      startsAt: new Date("2026-11-01T00:00:00.000Z"),
      endsAt: new Date("2026-12-31T00:00:00.000Z"),
    });
    expect(isContentLive(c, WED_NOON)).toBe(true);
  });

  it("honours the days of the week", () => {
    expect(isContentLive(content({ weekdays: [3] }), WED_NOON)).toBe(true);
    expect(isContentLive(content({ weekdays: [0, 6] }), WED_NOON)).toBe(false);
  });

  it("honours the hour window", () => {
    expect(isContentLive(content({ hourFrom: 9, hourTo: 18 }), WED_NOON)).toBe(true);
    expect(isContentLive(content({ hourFrom: 18, hourTo: 22 }), WED_NOON)).toBe(false);
  });

  it("treats the hour window as half-open", () => {
    const at18 = new Date("2026-11-25T18:00:00.000Z");
    expect(isContentLive(content({ hourFrom: 9, hourTo: 18 }), at18)).toBe(false);
    expect(isContentLive(content({ hourFrom: 18, hourTo: 22 }), at18)).toBe(true);
  });

  it("lets an hour window cross midnight", () => {
    const night = content({ hourFrom: 22, hourTo: 6 });
    expect(isContentLive(night, new Date("2026-11-25T23:30:00.000Z"))).toBe(true);
    expect(isContentLive(night, new Date("2026-11-25T05:00:00.000Z"))).toBe(true);
    expect(isContentLive(night, new Date("2026-11-25T12:00:00.000Z"))).toBe(false);
  });
});

describe("matchesAudience", () => {
  it("shows ALL to anyone, signed in or not", () => {
    expect(matchesAudience(content({ audience: "ALL" }), GUEST)).toBe(true);
  });

  it("counts a guest as a newcomer", () => {
    expect(matchesAudience(content({ audience: "NEWCOMERS" }), GUEST)).toBe(true);
  });

  it("stops calling somebody a newcomer once they charged in the network", () => {
    const viewer = { ...GUEST, signedIn: true, chargesInNetwork: 1 };
    expect(matchesAudience(content({ audience: "NEWCOMERS" }), viewer)).toBe(false);
  });

  it("calls somebody a regular from the third charge", () => {
    const two = { ...GUEST, signedIn: true, chargesInNetwork: 2 };
    const three = { ...GUEST, signedIn: true, chargesInNetwork: 3 };
    expect(matchesAudience(content({ audience: "REGULARS" }), two)).toBe(false);
    expect(matchesAudience(content({ audience: "REGULARS" }), three)).toBe(true);
  });

  it("shows a cooperative offer only to a member", () => {
    const member = { ...GUEST, signedIn: true, coopMember: true };
    expect(matchesAudience(content({ audience: "COOP_MEMBERS" }), member)).toBe(true);
    expect(matchesAudience(content({ audience: "COOP_MEMBERS" }), GUEST)).toBe(false);
  });

  it("shows a card-holder offer to nobody, because the card does not exist", () => {
    const holder = { ...GUEST, signedIn: true, cardHolder: true };
    expect(matchesAudience(content({ audience: "CARD_HOLDERS" }), holder)).toBe(false);
  });
});

describe("selectForPlacement", () => {
  it("keeps only what belongs in that place", () => {
    const mini = content({ id: "mini", placements: ["NAVIGATOR_MINI"] });
    const full = content({ id: "full", placements: ["FULL_CARD"] });
    const both = content({ id: "both", placements: ["FULL_CARD", "NAVIGATOR_MINI"] });
    const chosen = selectForPlacement([mini, full, both], "FULL_CARD", WED_NOON, GUEST);
    expect(chosen.map((c) => c.id)).toEqual(["full", "both"]);
  });

  it("drops what is out of schedule and what is not for this viewer", () => {
    const dead = content({ id: "dead", endsAt: new Date("2026-01-01T00:00:00.000Z") });
    const notMine = content({ id: "notMine", audience: "COOP_MEMBERS" });
    const live = content({ id: "live" });
    const chosen = selectForPlacement([dead, notMine, live], "FULL_CARD", WED_NOON, GUEST);
    expect(chosen.map((c) => c.id)).toEqual(["live"]);
  });

  it("puts the banner first — it is the one thing the mini-card has room for", () => {
    const news = content({ id: "news", type: "NEWS" });
    const banner = content({ id: "banner", type: "BANNER" });
    const promo = content({ id: "promo", type: "PROMO" });
    const chosen = selectForPlacement([news, promo, banner], "FULL_CARD", WED_NOON, GUEST);
    expect(chosen[0]!.id).toBe("banner");
  });

  it("shows network-wide content on every point and scoped content only on its own", () => {
    const wide = content({ id: "wide", pointIds: [] });
    const scoped = content({ id: "scoped", pointIds: ["p-2"] });
    const here = selectForPlacement([wide, scoped], "FULL_CARD", WED_NOON, GUEST, "p-1");
    expect(here.map((c) => c.id)).toEqual(["wide"]);
    const there = selectForPlacement([wide, scoped], "FULL_CARD", WED_NOON, GUEST, "p-2");
    expect(there.map((c) => c.id).sort()).toEqual(["scoped", "wide"]);
  });
});
