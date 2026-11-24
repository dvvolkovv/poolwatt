import { describe, it, expect } from "vitest";
import {
  aggregateBook,
  bestPrice,
  matchOrder,
  type RestingOrder,
  type TakerOrder,
} from "./matching";

const T0 = Date.parse("2026-11-24T10:00:00Z");

function ask(id: string, price: number, kwh: number, tOffset = 0, walletId = "w-maker"): RestingOrder {
  return { id, side: "SELL", limitPrice: price, remainingKwh: kwh, createdAt: T0 + tOffset, walletId };
}

function bid(id: string, price: number, kwh: number, tOffset = 0, walletId = "w-maker"): RestingOrder {
  return { id, side: "BUY", limitPrice: price, remainingKwh: kwh, createdAt: T0 + tOffset, walletId };
}

function taker(over: Partial<TakerOrder> = {}): TakerOrder {
  return {
    id: "taker-1",
    side: "BUY",
    type: "MARKET",
    limitPrice: null,
    amountKwh: 10,
    walletId: "w-taker",
    ...over,
  };
}

describe("matchOrder — price-time priority (ТЗ §6)", () => {
  it("fills a market buy from the cheapest ask first", () => {
    const book = [ask("a1", 0.25, 5), ask("a2", 0.2, 5), ask("a3", 0.3, 5)];
    const r = matchOrder(taker({ amountKwh: 10 }), book, {});
    expect(r.fills.map((f) => f.makerOrderId)).toEqual(["a2", "a1"]);
    expect(r.fills.map((f) => f.price)).toEqual([0.2, 0.25]);
    expect(r.filledKwh).toBe(10);
    expect(r.remainingKwh).toBe(0);
  });

  it("breaks a price tie by arrival time, oldest first", () => {
    const book = [ask("late", 0.2, 5, 2000), ask("early", 0.2, 5, 1000)];
    const r = matchOrder(taker({ amountKwh: 10 }), book, {});
    expect(r.fills.map((f) => f.makerOrderId)).toEqual(["early", "late"]);
  });

  it("fills a market sell from the highest bid first", () => {
    const book = [bid("b1", 0.2, 5), bid("b2", 0.3, 5)];
    const r = matchOrder(taker({ side: "SELL", amountKwh: 10 }), book, {});
    expect(r.fills.map((f) => f.makerOrderId)).toEqual(["b2", "b1"]);
  });

  it("executes at the maker's price, not the taker's", () => {
    const book = [ask("a1", 0.18, 10)];
    const r = matchOrder(taker({ type: "LIMIT", limitPrice: 0.25, amountKwh: 10 }), book, {});
    expect(r.fills[0].price).toBe(0.18);
    expect(r.notional).toBe(1.8);
  });
});

describe("matchOrder — limit orders", () => {
  it("stops at the taker's limit price on a buy", () => {
    const book = [ask("a1", 0.2, 4), ask("a2", 0.26, 10)];
    const r = matchOrder(taker({ type: "LIMIT", limitPrice: 0.25, amountKwh: 10 }), book, {});
    expect(r.fills).toHaveLength(1);
    expect(r.filledKwh).toBe(4);
    expect(r.remainingKwh).toBe(6);
  });

  it("stops at the taker's limit price on a sell", () => {
    const book = [bid("b1", 0.3, 4), bid("b2", 0.1, 10)];
    const r = matchOrder(taker({ side: "SELL", type: "LIMIT", limitPrice: 0.2, amountKwh: 10 }), book, {});
    expect(r.fills).toHaveLength(1);
    expect(r.filledKwh).toBe(4);
  });

  it("fills nothing when the book is all on the wrong side of the limit", () => {
    const book = [ask("a1", 0.5, 10)];
    const r = matchOrder(taker({ type: "LIMIT", limitPrice: 0.1, amountKwh: 10 }), book, {});
    expect(r.fills).toEqual([]);
    expect(r.remainingKwh).toBe(10);
    expect(r.avgPrice).toBeNull();
  });
});

describe("matchOrder — partial fills and leftovers", () => {
  it("reports the unfilled remainder when the book is too thin", () => {
    const book = [ask("a1", 0.2, 3)];
    const r = matchOrder(taker({ amountKwh: 10 }), book, {});
    expect(r.filledKwh).toBe(3);
    expect(r.remainingKwh).toBe(7);
  });

  it("partially consumes the last maker it touches", () => {
    const book = [ask("a1", 0.2, 4), ask("a2", 0.21, 10)];
    const r = matchOrder(taker({ amountKwh: 6 }), book, {});
    expect(r.fills[1]).toMatchObject({ makerOrderId: "a2", amountKwh: 2 });
  });

  it("returns an empty result for an empty book", () => {
    const r = matchOrder(taker(), [], {});
    expect(r.fills).toEqual([]);
    expect(r.filledKwh).toBe(0);
    expect(r.notional).toBe(0);
  });
});

describe("matchOrder — ТЗ §16.1 token grid", () => {
  it("never fills a fraction finer than 0.001 kWh", () => {
    const book = [ask("a1", 0.2, 1 / 3)];
    const r = matchOrder(taker({ amountKwh: 10 }), book, {});
    expect(r.fills[0].amountKwh).toBe(0.333);
  });

  it("skips a maker whose remainder is dust below the grid", () => {
    const book = [ask("a1", 0.2, 0.0004), ask("a2", 0.21, 5)];
    const r = matchOrder(taker({ amountKwh: 5 }), book, {});
    expect(r.fills.map((f) => f.makerOrderId)).toEqual(["a2"]);
  });

  it("snaps the requested amount onto the grid the DB column stores", () => {
    // Order.amountKwh is Decimal(18,3), which rounds half-up — the engine has
    // to agree with the column or filledKwh and amountKwh drift apart.
    const book = [ask("a1", 0.2, 100)];
    const r = matchOrder(taker({ amountKwh: 2.4567 }), book, {});
    expect(r.fills[0].amountKwh).toBe(2.457);
    expect(r.filledKwh).toBe(2.457);
  });

  it("never fills more than the maker actually has", () => {
    const book = [ask("a1", 0.2, 2.4564)];
    const r = matchOrder(taker({ amountKwh: 10 }), book, {});
    expect(r.fills[0].amountKwh).toBe(2.456);
  });
});

describe("matchOrder — ТЗ §16.5 price corridor", () => {
  const corridor = { spotPrice: 0.2, corridorPct: 20 }; // 0.16 .. 0.24

  it("skips a resting order priced outside the corridor", () => {
    const book = [ask("cheap-but-legal", 0.17, 4), ask("too-dear", 0.5, 10)];
    const r = matchOrder(taker({ amountKwh: 10 }), book, corridor);
    expect(r.fills.map((f) => f.makerOrderId)).toEqual(["cheap-but-legal"]);
    expect(r.skipped).toEqual([
      { makerOrderId: "too-dear", reason: "outside-corridor" },
    ]);
    expect(r.remainingKwh).toBe(6);
  });

  it("keeps matching past a skipped maker instead of stopping", () => {
    const book = [ask("under", 0.05, 5), ask("ok", 0.2, 5)];
    const r = matchOrder(taker({ side: "SELL", amountKwh: 5 }), [bid("under", 0.05, 5), bid("ok", 0.2, 5)], corridor);
    expect(r.fills.map((f) => f.makerOrderId)).toEqual(["ok"]);
    expect(book.length).toBe(2); // input not mutated
  });

  it("imposes no constraint when the zone has no spot reference", () => {
    const book = [ask("a1", 99, 5)];
    const r = matchOrder(taker({ amountKwh: 5 }), book, { spotPrice: null, corridorPct: 20 });
    expect(r.fills).toHaveLength(1);
  });
});

describe("matchOrder — hygiene", () => {
  it("refuses to trade a wallet against itself", () => {
    const book = [ask("mine", 0.2, 5, 0, "w-taker"), ask("theirs", 0.21, 5)];
    const r = matchOrder(taker({ amountKwh: 10, walletId: "w-taker" }), book, {});
    expect(r.fills.map((f) => f.makerOrderId)).toEqual(["theirs"]);
    expect(r.skipped).toEqual([{ makerOrderId: "mine", reason: "self-trade" }]);
  });

  it("ignores same-side orders left in the book slice", () => {
    const book = [ask("a1", 0.2, 5), bid("b1", 0.9, 5)];
    const r = matchOrder(taker({ amountKwh: 10 }), book, {});
    expect(r.fills.map((f) => f.makerOrderId)).toEqual(["a1"]);
  });

  it("computes the volume-weighted average price", () => {
    const book = [ask("a1", 0.1, 5), ask("a2", 0.3, 5)];
    const r = matchOrder(taker({ amountKwh: 10 }), book, {});
    expect(r.notional).toBe(2.0);
    expect(r.avgPrice).toBe(0.2);
  });

  it("does not mutate the resting orders it was given", () => {
    const book = [ask("a1", 0.2, 5)];
    matchOrder(taker({ amountKwh: 5 }), book, {});
    expect(book[0].remainingKwh).toBe(5);
  });

  it("rejects a non-positive taker amount", () => {
    expect(() => matchOrder(taker({ amountKwh: 0 }), [], {})).toThrow(RangeError);
    expect(() => matchOrder(taker({ amountKwh: -1 }), [], {})).toThrow(RangeError);
  });

  it("rejects a limit order with no price", () => {
    expect(() => matchOrder(taker({ type: "LIMIT", limitPrice: null }), [], {})).toThrow(
      /limit price/i,
    );
  });
});

describe("aggregateBook — GET /v1/zones/{id}/orderbook", () => {
  it("groups each side by price with totals and order counts", () => {
    const book = [
      ask("a1", 0.2, 5),
      ask("a2", 0.2, 3),
      ask("a3", 0.25, 1),
      bid("b1", 0.18, 2),
      bid("b2", 0.19, 4),
    ];
    const agg = aggregateBook(book);
    expect(agg.asks).toEqual([
      { price: 0.2, amountKwh: 8, orders: 2 },
      { price: 0.25, amountKwh: 1, orders: 1 },
    ]);
    expect(agg.bids).toEqual([
      { price: 0.19, amountKwh: 4, orders: 1 },
      { price: 0.18, amountKwh: 2, orders: 1 },
    ]);
  });

  it("drops dust levels so the book shows only tradable size", () => {
    const agg = aggregateBook([ask("a1", 0.2, 0.0004)]);
    expect(agg.asks).toEqual([]);
  });

  it("returns empty sides for an empty book", () => {
    expect(aggregateBook([])).toEqual({ bids: [], asks: [] });
  });
});

describe("bestPrice", () => {
  it("reports best bid and best ask", () => {
    const book = [ask("a1", 0.25, 1), ask("a2", 0.2, 1), bid("b1", 0.18, 1), bid("b2", 0.1, 1)];
    expect(bestPrice(book)).toEqual({ bestBid: 0.18, bestAsk: 0.2 });
  });

  it("reports nulls on an empty book", () => {
    expect(bestPrice([])).toEqual({ bestBid: null, bestAsk: null });
  });
});
