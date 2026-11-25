import { describe, it, expect } from "vitest";
import {
  DEFAULT_AUTH_BUFFER_PCT,
  authorizationAmount,
  canCoverFromFiat,
  planCharge,
} from "./charge";
import type { MatchResult } from "./matching";

function match(filledKwh: number, notional: number): MatchResult {
  return {
    fills: [{ makerOrderId: "m1", amountKwh: filledKwh, price: notional / filledKwh }],
    filledKwh,
    remainingKwh: 0,
    notional,
    avgPrice: notional / filledKwh,
    skipped: [],
  };
}

describe("planCharge — ТЗ §16.6 waterfall", () => {
  it("pays entirely from the kWh balance when it is enough", () => {
    const plan = planCharge({ requestedKwh: 10, walletKwhBalance: 25, market: null });
    expect(plan.kwhFromBalance).toBe(10);
    expect(plan.kwhFromMarket).toBe(0);
    expect(plan.energyCost).toBe(0);
    expect(plan.total).toBe(0);
    expect(plan.authorizedFiat).toBe(0);
    expect(plan.sources).toEqual(["balance"]);
    expect(plan.feasible).toBe(true);
  });

  it("buys only the shortfall on the exchange", () => {
    const plan = planCharge({
      requestedKwh: 10,
      walletKwhBalance: 4,
      market: match(6, 1.2),
    });
    expect(plan.kwhFromBalance).toBe(4);
    expect(plan.kwhFromMarket).toBe(6);
    expect(plan.energyCost).toBe(1.2);
    expect(plan.deliverableKwh).toBe(10);
    expect(plan.sources).toEqual(["balance", "market"]);
  });

  it("buys the whole session on the exchange when the balance is empty", () => {
    const plan = planCharge({ requestedKwh: 10, walletKwhBalance: 0, market: match(10, 2) });
    expect(plan.kwhFromBalance).toBe(0);
    expect(plan.sources).toEqual(["market"]);
  });

  it("treats a negative balance as zero rather than as debt to charge for", () => {
    const plan = planCharge({ requestedKwh: 5, walletKwhBalance: -3, market: match(5, 1) });
    expect(plan.kwhFromBalance).toBe(0);
    expect(plan.kwhFromMarket).toBe(5);
  });

  it("rejects a non-positive request", () => {
    expect(() => planCharge({ requestedKwh: 0, walletKwhBalance: 10, market: null })).toThrow(
      RangeError,
    );
  });
});

describe("planCharge — ТЗ §16.7 aggregator fallback", () => {
  it("covers what the thin book could not, at the external spot price", () => {
    const plan = planCharge({
      requestedKwh: 10,
      walletKwhBalance: 0,
      market: match(4, 0.8),
      aggregatorPrice: 0.25,
    });
    expect(plan.kwhFromMarket).toBe(4);
    expect(plan.kwhFromAggregator).toBe(6);
    expect(plan.energyCost).toBe(0.8 + 1.5);
    expect(plan.unservedKwh).toBe(0);
    expect(plan.sources).toEqual(["market", "aggregator"]);
  });

  it("covers the whole session when the book is empty", () => {
    const plan = planCharge({
      requestedKwh: 10,
      walletKwhBalance: 0,
      market: null,
      aggregatorPrice: 0.3,
    });
    expect(plan.kwhFromAggregator).toBe(10);
    expect(plan.energyCost).toBe(3);
  });

  it("short-fills when neither the book nor the aggregator can serve", () => {
    const plan = planCharge({
      requestedKwh: 10,
      walletKwhBalance: 2,
      market: match(3, 0.6),
      aggregatorPrice: null,
    });
    expect(plan.deliverableKwh).toBe(5);
    expect(plan.unservedKwh).toBe(5);
    expect(plan.feasible).toBe(true); // 5 kWh can still be delivered
  });

  it("is infeasible when nothing at all can be sourced", () => {
    const plan = planCharge({ requestedKwh: 10, walletKwhBalance: 0, market: null });
    expect(plan.deliverableKwh).toBe(0);
    expect(plan.unservedKwh).toBe(10);
    expect(plan.feasible).toBe(false);
  });

  it("ignores a zero or negative aggregator price", () => {
    const plan = planCharge({
      requestedKwh: 10,
      walletKwhBalance: 0,
      market: null,
      aggregatorPrice: 0,
    });
    expect(plan.kwhFromAggregator).toBe(0);
    expect(plan.unservedKwh).toBe(10);
  });
});

describe("planCharge — commission and authorization", () => {
  it("charges commission on the money spent, not on balance kWh", () => {
    const plan = planCharge({
      requestedKwh: 10,
      walletKwhBalance: 8,
      market: match(2, 0.5),
      chargeFeePct: 2,
    });
    expect(plan.energyCost).toBe(0.5);
    expect(plan.fee).toBe(0.01);
    expect(plan.total).toBe(0.51);
  });

  it("charges nothing at all for a pure token payment (§16.9)", () => {
    const plan = planCharge({
      requestedKwh: 10,
      walletKwhBalance: 10,
      market: null,
      chargeFeePct: 2,
    });
    expect(plan.fee).toBe(0);
    expect(plan.total).toBe(0);
  });

  it("authorizes the total plus the Y% buffer", () => {
    const plan = planCharge({
      requestedKwh: 10,
      walletKwhBalance: 0,
      market: match(10, 2),
      authBufferPct: 10,
    });
    expect(plan.total).toBe(2);
    expect(plan.authorizedFiat).toBe(2.2);
  });

  it("uses the default buffer when none is configured", () => {
    const plan = planCharge({ requestedKwh: 10, walletKwhBalance: 0, market: match(10, 10) });
    expect(plan.authorizedFiat).toBe(authorizationAmount(10, DEFAULT_AUTH_BUFFER_PCT));
  });
});

describe("authorizationAmount", () => {
  it("rounds the hold up to the cent", () => {
    expect(authorizationAmount(1.01, 10)).toBe(1.12);
  });

  it("holds nothing for a free session", () => {
    expect(authorizationAmount(0, 10)).toBe(0);
  });

  it("holds exactly the total when the buffer is zero or negative", () => {
    expect(authorizationAmount(5, 0)).toBe(5);
    expect(authorizationAmount(5, -20)).toBe(5);
  });
});

describe("canCoverFromFiat", () => {
  const plan = planCharge({ requestedKwh: 10, walletKwhBalance: 0, market: match(10, 2) });

  it("pays from a funded wallet", () => {
    expect(canCoverFromFiat(plan, { fiatBalance: 5, reservedFiat: 0 })).toBe(true);
  });

  it("does not spend funds reserved against open buy orders", () => {
    expect(canCoverFromFiat(plan, { fiatBalance: 5, reservedFiat: 4 })).toBe(false);
  });
});

describe("promo kWh — §43 'списывается первым, раньше обычного баланса'", () => {
  it("spends the gift before the wallet's own kWh", () => {
    const plan = planCharge({
      requestedKwh: 10,
      giftKwh: 4,
      walletKwhBalance: 10,
      market: null,
    });

    expect(plan.kwhFromGift).toBe(4);
    expect(plan.kwhFromBalance).toBe(6);
    expect(plan.kwhFromMarket).toBe(0);
    expect(plan.deliverableKwh).toBe(10);
    expect(plan.sources).toEqual(["gift", "balance"]);
  });

  it("costs the driver nothing for the gifted part", () => {
    const plan = planCharge({
      requestedKwh: 5,
      giftKwh: 5,
      walletKwhBalance: 0,
      market: null,
      chargeFeePct: 2,
    });

    expect(plan.kwhFromGift).toBe(5);
    expect(plan.energyCost).toBe(0);
    expect(plan.fee).toBe(0);
    expect(plan.total).toBe(0);
    expect(plan.authorizedFiat).toBe(0);
    expect(plan.feasible).toBe(true);
  });

  it("spends only as much of the gift as the session needs", () => {
    const plan = planCharge({
      requestedKwh: 3,
      giftKwh: 20,
      walletKwhBalance: 10,
      market: null,
    });

    expect(plan.kwhFromGift).toBe(3);
    expect(plan.kwhFromBalance).toBe(0);
    expect(plan.sources).toEqual(["gift"]);
  });

  it("buys the shortfall after the gift and the balance are exhausted", () => {
    const plan = planCharge({
      requestedKwh: 10,
      giftKwh: 2,
      walletKwhBalance: 3,
      market: match(5, 1.1),
    });

    expect(plan.kwhFromGift).toBe(2);
    expect(plan.kwhFromBalance).toBe(3);
    expect(plan.kwhFromMarket).toBe(5);
    expect(plan.energyCost).toBe(1.1);
    expect(plan.sources).toEqual(["gift", "balance", "market"]);
  });

  it("changes nothing when there is no gift", () => {
    const withZero = planCharge({ requestedKwh: 8, giftKwh: 0, walletKwhBalance: 8, market: null });
    const without = planCharge({ requestedKwh: 8, walletKwhBalance: 8, market: null });
    expect(withZero).toEqual(without);
  });

  it("ignores a negative gift rather than handing out energy for it", () => {
    const plan = planCharge({
      requestedKwh: 5,
      giftKwh: -5,
      walletKwhBalance: 5,
      market: null,
    });
    expect(plan.kwhFromGift).toBe(0);
    expect(plan.kwhFromBalance).toBe(5);
  });

  it("floors the gift to whole tokens, like the balance", () => {
    const plan = planCharge({
      requestedKwh: 5,
      giftKwh: 2.00049,
      walletKwhBalance: 5,
      market: null,
    });
    expect(plan.kwhFromGift).toBe(2);
  });
});
