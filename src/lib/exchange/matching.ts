// The matching engine — ТЗ §6 "Матчинговый движок (биржа)".
//
// Pure and synchronous: it takes a taker order plus the resting book of one
// (zone, interval) and returns the fills that should be applied. Nothing here
// touches Prisma, so the engine is exhaustively testable and the service layer
// stays free to apply the fills inside one transaction.
//
// Priority is price, then time (§6 "Приоритет «цена — время»"). Execution
// happens at the *maker's* price: the resting order published that price and
// waited, so it earns it. A market taker crossing a thin book therefore pays
// progressively worse prices, which is what makes the §16.6 authorization
// buffer necessary.

import { type Corridor, isPriceInCorridor } from "./corridor";
import { floorKwh, isKwhDust, notional as notionalOf, roundKwh, roundMoney, roundPrice } from "./precision";

export type Side = "BUY" | "SELL";
export type OrderKind = "MARKET" | "LIMIT";

/** A limit order sitting in the book. Market orders never rest. */
export interface RestingOrder {
  id: string;
  side: Side;
  limitPrice: number;
  remainingKwh: number;
  /** Epoch ms — the time-priority tiebreak. */
  createdAt: number;
  /** Used for self-trade prevention; omit to disable the check. */
  walletId?: string;
}

export interface TakerOrder {
  id: string;
  side: Side;
  type: OrderKind;
  /** Required for LIMIT, ignored for MARKET. */
  limitPrice: number | null;
  amountKwh: number;
  walletId?: string;
}

export interface Fill {
  makerOrderId: string;
  amountKwh: number;
  price: number;
}

export type SkipReason = "outside-corridor" | "self-trade" | "dust";

export interface MatchResult {
  fills: Fill[];
  /** Total kWh matched, on the 0.001 grid. */
  filledKwh: number;
  /** Taker size left unmatched: rests in the book (LIMIT) or expires (MARKET). */
  remainingKwh: number;
  /** Total money changing hands across all fills. */
  notional: number;
  /** Volume-weighted average fill price, or null when nothing filled. */
  avgPrice: number | null;
  /** Makers deliberately passed over, for the audit trail. */
  skipped: { makerOrderId: string; reason: SkipReason }[];
}

/** Resting orders on the side opposite to the taker, in priority order. */
function counterparties(book: readonly RestingOrder[], takerSide: Side): RestingOrder[] {
  const wantedSide: Side = takerSide === "BUY" ? "SELL" : "BUY";
  const candidates = book.filter((o) => o.side === wantedSide);
  // A buyer walks the asks upward; a seller walks the bids downward. Equal
  // prices are served oldest-first either way.
  const priceSign = takerSide === "BUY" ? 1 : -1;
  return candidates.slice().sort((a, b) => {
    const byPrice = (a.limitPrice - b.limitPrice) * priceSign;
    if (byPrice !== 0) return byPrice;
    return a.createdAt - b.createdAt;
  });
}

function crossesLimit(taker: TakerOrder, makerPrice: number): boolean {
  if (taker.type === "MARKET") return true;
  const limit = taker.limitPrice as number;
  return taker.side === "BUY" ? makerPrice <= limit : makerPrice >= limit;
}

export function matchOrder(
  taker: TakerOrder,
  book: readonly RestingOrder[],
  corridor: Corridor | Record<string, never>,
): MatchResult {
  const amount = roundKwh(taker.amountKwh);
  if (!(amount > 0)) {
    throw new RangeError(`Taker amount must be positive, got ${taker.amountKwh}`);
  }
  if (taker.type === "LIMIT" && taker.limitPrice == null) {
    throw new RangeError("A LIMIT order requires a limit price");
  }

  const c: Corridor = {
    spotPrice: "spotPrice" in corridor ? (corridor.spotPrice ?? null) : null,
    corridorPct: "corridorPct" in corridor ? (corridor.corridorPct ?? null) : null,
  };

  const fills: Fill[] = [];
  const skipped: MatchResult["skipped"] = [];
  let remaining = amount;
  let totalNotional = 0;

  for (const maker of counterparties(book, taker.side)) {
    if (isKwhDust(remaining)) break;

    const makerPrice = roundPrice(maker.limitPrice);

    // Price priority is sorted, so the first maker that fails the taker's
    // limit means every maker after it fails too.
    if (!crossesLimit(taker, makerPrice)) break;

    // `isKwhDust` compares the absolute value, so a maker whose remaining
    // quantity went negative upstream would otherwise produce a negative
    // fill. There is nothing to buy from such a maker either way.
    if (!(maker.remainingKwh > 0) || isKwhDust(maker.remainingKwh)) {
      skipped.push({ makerOrderId: maker.id, reason: "dust" });
      continue;
    }
    if (taker.walletId != null && maker.walletId === taker.walletId) {
      skipped.push({ makerOrderId: maker.id, reason: "self-trade" });
      continue;
    }
    // §16.5 — a resting price that drifted outside the corridor is passed
    // over, not traded against, and the walk continues: the next maker may
    // well be inside the corridor.
    if (!isPriceInCorridor(makerPrice, c)) {
      skipped.push({ makerOrderId: maker.id, reason: "outside-corridor" });
      continue;
    }

    const fillKwh = floorKwh(Math.min(remaining, maker.remainingKwh));
    if (isKwhDust(fillKwh)) {
      skipped.push({ makerOrderId: maker.id, reason: "dust" });
      continue;
    }

    fills.push({ makerOrderId: maker.id, amountKwh: fillKwh, price: makerPrice });
    totalNotional = roundMoney(totalNotional + notionalOf(fillKwh, makerPrice));
    remaining = roundKwh(remaining - fillKwh);
  }

  const filledKwh = roundKwh(amount - remaining);
  return {
    fills,
    filledKwh,
    remainingKwh: isKwhDust(remaining) ? 0 : remaining,
    notional: totalNotional,
    avgPrice: filledKwh > 0 ? roundPrice(totalNotional / filledKwh) : null,
    skipped,
  };
}

export interface BookLevel {
  price: number;
  amountKwh: number;
  orders: number;
}

export interface AggregatedBook {
  /** Highest price first. */
  bids: BookLevel[];
  /** Lowest price first. */
  asks: BookLevel[];
}

/** Collapse the book into price levels for GET /v1/zones/{id}/orderbook. */
export function aggregateBook(book: readonly RestingOrder[]): AggregatedBook {
  const levels = (side: Side): BookLevel[] => {
    const byPrice = new Map<number, BookLevel>();
    for (const o of book) {
      if (o.side !== side) continue;
      if (isKwhDust(o.remainingKwh)) continue;
      const price = roundPrice(o.limitPrice);
      const level = byPrice.get(price) ?? { price, amountKwh: 0, orders: 0 };
      level.amountKwh = roundKwh(level.amountKwh + o.remainingKwh);
      level.orders += 1;
      byPrice.set(price, level);
    }
    const sorted = [...byPrice.values()].sort((a, b) =>
      side === "BUY" ? b.price - a.price : a.price - b.price,
    );
    return sorted;
  };

  return { bids: levels("BUY"), asks: levels("SELL") };
}

/** Top of book, for GET /v1/zones/{id}/price. */
export function bestPrice(book: readonly RestingOrder[]): {
  bestBid: number | null;
  bestAsk: number | null;
} {
  const { bids, asks } = aggregateBook(book);
  return {
    bestBid: bids.length > 0 ? bids[0].price : null,
    bestAsk: asks.length > 0 ? asks[0].price : null,
  };
}
