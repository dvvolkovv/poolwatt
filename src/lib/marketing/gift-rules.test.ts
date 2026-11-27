import { describe, expect, it } from "vitest";
import { chooseGifts, giftShare, type GiftCandidate } from "./gift-rules";

function gift(over: Partial<GiftCandidate> = {}): GiftCandidate {
  return {
    id: "g1",
    campaignId: "c1",
    kind: "ENERGY",
    remainingKwh: 10,
    discountPct: null,
    minNextChargeKwh: null,
    exclusive: false,
    expiresAt: new Date("2026-12-01T00:00:00Z"),
    issuedAt: new Date("2026-11-01T00:00:00Z"),
    ...over,
  };
}

describe("giftShare", () => {
  it("gives a fixed gift up to the session, and no more", () => {
    expect(giftShare(gift({ remainingKwh: 10 }), 40)).toBe(10);
    expect(giftShare(gift({ remainingKwh: 10 }), 4)).toBe(4);
  });

  it("gives a discount its share of the session", () => {
    // §42 — 20 % of a 40 kWh session is 8 kWh out of the partner's wallet.
    expect(giftShare(gift({ discountPct: 20, remainingKwh: 100 }), 40)).toBe(8);
  });

  it("never gives a discount more than the ceiling the partner reserved", () => {
    expect(giftShare(gift({ discountPct: 50, remainingKwh: 5 }), 40)).toBe(5);
  });

  it("floors a discount to 0.001 kWh", () => {
    // 33.3 % of 10 kWh is 3.33 kWh — nothing is rounded up in the partner's
    // disfavour, spending is per 0.001.
    expect(giftShare(gift({ discountPct: 33.33, remainingKwh: 100 }), 10)).toBe(3.333);
  });

  it("gives nothing for a discount of zero, and the whole session for 100 %", () => {
    expect(giftShare(gift({ discountPct: 0, remainingKwh: 100 }), 40)).toBe(0);
    expect(giftShare(gift({ discountPct: 100, remainingKwh: 100 }), 40)).toBe(40);
  });

  it("holds back a gift whose campaign asks for a bigger session", () => {
    // §42 "минимальный объём следующей зарядки" — stored since block I and
    // never read until now.
    expect(giftShare(gift({ minNextChargeKwh: 20 }), 19.999)).toBe(0);
    expect(giftShare(gift({ minNextChargeKwh: 20 }), 20)).toBe(10);
  });

  it("gives no energy for a free booking", () => {
    expect(giftShare(gift({ kind: "FREE_BOOKING", remainingKwh: 0 }), 40)).toBe(0);
  });

  it("gives nothing when there is nothing left", () => {
    expect(giftShare(gift({ remainingKwh: 0 }), 40)).toBe(0);
    expect(giftShare(gift({ remainingKwh: 0.0004 }), 40)).toBe(0);
  });
});

describe("chooseGifts", () => {
  it("spends the gift that burns first", () => {
    const soon = gift({ id: "soon", expiresAt: new Date("2026-11-28T00:00:00Z") });
    const later = gift({ id: "later", expiresAt: new Date("2026-12-28T00:00:00Z") });
    expect(chooseGifts([later, soon], 40).map((g) => g.id)).toEqual(["soon", "later"]);
  });

  it("leaves out a gift that gives nothing in this session", () => {
    const tooBig = gift({ id: "tooBig", minNextChargeKwh: 100 });
    const fine = gift({ id: "fine" });
    expect(chooseGifts([tooBig, fine], 40).map((g) => g.id)).toEqual(["fine"]);
  });

  it("uses one gift only when one of them does not add up with others", () => {
    // §42 "не суммируется с другими акциями" — and the one kept is the one
    // worth most to the driver, not the first in the list.
    const small = gift({ id: "small", remainingKwh: 3 });
    const exclusiveBig = gift({ id: "big", remainingKwh: 25, exclusive: true });
    expect(chooseGifts([small, exclusiveBig], 40).map((g) => g.id)).toEqual(["big"]);
  });

  it("drops the exclusive gift when another one is worth more", () => {
    const exclusiveSmall = gift({ id: "small", remainingKwh: 3, exclusive: true });
    const big = gift({ id: "big", remainingKwh: 25 });
    expect(chooseGifts([exclusiveSmall, big], 40).map((g) => g.id)).toEqual(["big"]);
  });

  it("breaks a tie between two equal gifts by what burns first", () => {
    const a = gift({ id: "a", exclusive: true, expiresAt: new Date("2026-12-10T00:00:00Z") });
    const b = gift({ id: "b", expiresAt: new Date("2026-12-02T00:00:00Z") });
    expect(chooseGifts([a, b], 40).map((g) => g.id)).toEqual(["b"]);
  });

  it("keeps a free booking out of a charging session", () => {
    const booking = gift({ id: "booking", kind: "FREE_BOOKING", remainingKwh: 0 });
    const energy = gift({ id: "energy" });
    expect(chooseGifts([booking, energy], 40).map((g) => g.id)).toEqual(["energy"]);
  });

  it("stops once the session is covered", () => {
    const first = gift({ id: "first", remainingKwh: 40, expiresAt: new Date("2026-11-28T00:00:00Z") });
    const second = gift({ id: "second", remainingKwh: 40 });
    expect(chooseGifts([first, second], 40).map((g) => g.id)).toEqual(["first"]);
  });

  it("adds up two gifts that each cover part of the session", () => {
    const first = gift({ id: "first", remainingKwh: 10, expiresAt: new Date("2026-11-28T00:00:00Z") });
    const second = gift({ id: "second", remainingKwh: 10 });
    expect(chooseGifts([first, second], 40).map((g) => g.id)).toEqual(["first", "second"]);
  });
});
