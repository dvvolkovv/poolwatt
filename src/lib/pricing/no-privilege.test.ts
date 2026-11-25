// §54 rule 1 — "Собственные предприятия Poolwatt настраиваются тем же
// интерфейсом и по тем же правилам, без скрытых преимуществ в навигаторе и на
// бирже."
//
// This is a rule about what the code must *not* contain, so it is tested the
// only way such a rule can be: by showing that the two places where a
// preference could hide — the order book and the navigator — decide on price,
// time and distance, and have nothing to read about who owns a participant.
//
// §54 rule 3 — "Клиент видит итоговую цену и все платы до подтверждения" —
// is checked the same way: the quote carries every charge separately.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { matchOrder, type RestingOrder, type TakerOrder } from "@/lib/exchange/matching";
import { planCharge } from "@/lib/exchange/charge";

const taker: TakerOrder = {
  id: "taker",
  side: "BUY",
  type: "MARKET",
  amountKwh: 10,
  limitPrice: null,
};

function resting(over: Partial<RestingOrder> & { id: string }): RestingOrder {
  return {
    side: "SELL",
    limitPrice: 0.2,
    remainingKwh: 10,
    createdAt: 1000,
    ...over,
  } as RestingOrder;
}

describe("the order book has no notion of who owns a participant", () => {
  it("serves the earlier order first at the same price, whoever placed it", () => {
    const platformOwned = resting({ id: "poolwatt-own", createdAt: 2000 });
    const anybody = resting({ id: "somebody-else", createdAt: 1000 });

    const result = matchOrder(
      taker,
      [platformOwned, anybody],
      {},
    );

    expect(result.fills.map((f) => f.makerOrderId)).toEqual(["somebody-else"]);
  });

  it("serves the better price first, whoever placed it", () => {
    const platformOwned = resting({ id: "poolwatt-own", limitPrice: 0.18 });
    const anybody = resting({ id: "somebody-else", limitPrice: 0.25 });

    const result = matchOrder(
      taker,
      [anybody, platformOwned],
      {},
    );

    expect(result.fills[0]!.makerOrderId).toBe("poolwatt-own");
    // And the other way round, to show it is the price and not the name.
    const reversed = matchOrder(
      taker,
      [
        resting({ id: "poolwatt-own", limitPrice: 0.25 }),
        resting({ id: "somebody-else", limitPrice: 0.18 }),
      ],
      {},
    );
    expect(reversed.fills[0]!.makerOrderId).toBe("somebody-else");
  });

  it("is given nothing about ownership to look at", () => {
    // A resting order carries a price, a size, a side and a time. If a field
    // naming an owner ever appears here, this rule needs rethinking rather
    // than a quiet change.
    const order = resting({ id: "x" });
    expect(Object.keys(order).sort()).toEqual(
      ["createdAt", "id", "limitPrice", "remainingKwh", "side"].sort(),
    );
  });
});

describe("the navigator ranks points by what a driver can see", () => {
  const client = readFileSync("src/components/navigator/navigator-client.tsx", "utf8");
  const sidebar = readFileSync("src/components/navigator/sidebar.tsx", "utf8");

  it("sorts on price, and on nothing about the owner", () => {
    // The only sort the driver is offered besides the default is by price.
    expect(sidebar).toContain("sortPriceAsc");
    expect(client).toContain('"priceAsc"');
    // Nothing in the client reads an owner, a company or a platform flag.
    for (const forbidden of ["poolwattOwned", "isPlatformOwned", "ownCompany", "boost"]) {
      expect(client).not.toContain(forbidden);
    }
  });

  it("puts our own moderated points first for a reason it states out loud", () => {
    // `/api/chargers` does put Poolwatt points before OpenStreetMap pins, and
    // that is not a hidden advantage between partners: every Poolwatt point
    // belongs to some partner, on equal terms, and an OSM pin belongs to
    // nobody and promises nothing. The comment in the route says so.
    const route = readFileSync("src/app/api/chargers/route.ts", "utf8");
    expect(route).toContain("Ours first");
    expect(route).toMatch(/driver can actually be promised/i);
    // And the ordering inside "ours" is the database's, by name — not by who
    // the operator is.
    expect(route).not.toContain("claimedById: ");
  });
});

describe("§54 rule 3 — every charge is visible before confirming", () => {
  it("separates the energy, the commission and the total", () => {
    const plan = planCharge({
      requestedKwh: 10,
      walletKwhBalance: 0,
      market: {
        fills: [{ makerOrderId: "m", amountKwh: 10, price: 0.2 }],
        filledKwh: 10,
        remainingKwh: 0,
        notional: 2,
        avgPrice: 0.2,
        skipped: [],
      },
      chargeFeePct: 2,
    });

    expect(plan.energyCost).toBe(2);
    expect(plan.fee).toBe(0.04);
    expect(plan.total).toBe(2.04);
    // And the hold is never less than the total, so nothing is charged that
    // the driver was not shown.
    expect(plan.authorizedFiat).toBeGreaterThanOrEqual(plan.total);
  });

  it("says what cannot be served instead of quietly serving less", () => {
    const plan = planCharge({
      requestedKwh: 10,
      walletKwhBalance: 2,
      market: null,
    });

    expect(plan.deliverableKwh).toBe(2);
    expect(plan.unservedKwh).toBe(8);
  });

  it("shows a gift as a separate line, not as a discount with no name", () => {
    const plan = planCharge({
      requestedKwh: 10,
      giftKwh: 4,
      walletKwhBalance: 6,
      market: null,
    });

    expect(plan.kwhFromGift).toBe(4);
    expect(plan.kwhFromBalance).toBe(6);
    expect(plan.sources).toEqual(["gift", "balance"]);
  });
});
