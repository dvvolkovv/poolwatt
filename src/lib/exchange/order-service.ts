// Order placement and settlement — ТЗ §6, §12 (US-06, US-07), §15
// (POST /v1/orders, DELETE /v1/orders/{id}), §16.5–§16.8.
//
// The whole lifecycle of one order runs inside a single Prisma transaction:
// read the resting book, match it with the pure engine, then apply every fill
// — tokens, money, fees, order statuses, audit — atomically. A trade that
// cannot move its tokens must not move its money either, so there is no
// intermediate state where a fill is half-settled.

import {
  EnergyTokenStatus,
  OrderSide,
  OrderStatus,
  OrderType,
  Prisma,
  type GridZone,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { type Db, writeAudit } from "./audit";
import { corridorRejectReason } from "./corridor";
import { num, numOrNull } from "./decimal";
import { DEFAULT_FEE_RATES, splitTradeFees, tradeFee } from "./fees";
import {
  type Fill,
  type RestingOrder,
  aggregateBook,
  bestPrice,
  matchOrder,
} from "./matching";
import { isKwhDust, notional as notionalOf, roundKwh, roundMoney, roundPrice } from "./precision";
import { InsufficientTokensError, spendableTokens, transferTokens } from "./token-registry";
import { getOrCreateWallet } from "./wallet-service";
import { zoneCorridor } from "./zone-service";

export interface PlaceOrderInput {
  userId: string;
  zoneId: string;
  side: OrderSide;
  type: OrderType;
  amountKwh: number;
  limitPrice?: number | null;
  /** null = spot: match against any interval still on offer. */
  intervalStart?: Date | null;
  idempotencyKey?: string | null;
}

export interface PlaceOrderResult {
  orderId: string;
  status: OrderStatus;
  filledKwh: number;
  remainingKwh: number;
  avgPrice: number | null;
  notional: number;
  fee: number;
  tradeIds: string[];
  rejectReason: string | null;
  /** True when an existing order was returned for a repeated idempotency key. */
  idempotentReplay: boolean;
}

export class OrderRejected extends Error {
  constructor(
    readonly reason: string,
    readonly orderId?: string,
  ) {
    super(reason);
    this.name = "OrderRejected";
  }
}

/**
 * Resting book for one (zone, interval).
 *
 * An order with `intervalStart = null` is a spot order and may trade against
 * any interval; an order pinned to an interval trades only against that
 * interval or against spot orders. This is §16.3 ("вне накопителя торгуется
 * только в своём интервале") expressed as a query.
 */
async function loadBook(
  db: Db,
  zoneId: string,
  side: OrderSide,
  intervalStart: Date | null,
): Promise<RestingOrder[]> {
  const wantedSide = side === OrderSide.BUY ? OrderSide.SELL : OrderSide.BUY;
  const rows = await db.order.findMany({
    where: {
      zoneId,
      side: wantedSide,
      type: OrderType.LIMIT,
      status: { in: [OrderStatus.NEW, OrderStatus.PARTIALLY_FILLED] },
      ...(intervalStart
        ? { OR: [{ intervalStart }, { intervalStart: null }] }
        : {}),
    },
    select: {
      id: true,
      side: true,
      limitPrice: true,
      amountKwh: true,
      filledKwh: true,
      createdAt: true,
      walletId: true,
    },
  });

  return rows
    .filter((r) => r.limitPrice != null)
    .map((r) => ({
      id: r.id,
      side: r.side,
      limitPrice: num(r.limitPrice),
      remainingKwh: roundKwh(num(r.amountKwh) - num(r.filledKwh)),
      createdAt: r.createdAt.getTime(),
      walletId: r.walletId,
    }))
    .filter((r) => !isKwhDust(r.remainingKwh));
}

/** Commission rates for the wallet owner, from their company's fee plan (§16.8). */
async function feeRatesFor(db: Db, walletId: string) {
  const wallet = await db.wallet.findUnique({
    where: { id: walletId },
    select: { ownerUserId: true },
  });
  if (!wallet) return DEFAULT_FEE_RATES;

  const company = await db.company.findFirst({
    where: { ownerUserId: wallet.ownerUserId },
    include: { feePlan: true },
  });
  if (company?.feePlan) {
    return {
      tradeFeePct: num(company.feePlan.tradeFeePct),
      chargeFeePct: num(company.feePlan.chargeFeePct),
    };
  }
  const fallback = await db.feePlan.findFirst({ where: { isDefault: true } });
  return fallback
    ? { tradeFeePct: num(fallback.tradeFeePct), chargeFeePct: num(fallback.chargeFeePct) }
    : DEFAULT_FEE_RATES;
}

/**
 * Drop fills whose seller can no longer deliver.
 *
 * A SELL order rests in the book without locking its tokens, so by the time it
 * is matched the seller may have spent them elsewhere. Rather than failing the
 * taker's order, the undeliverable maker is rejected out of the book and the
 * taker keeps whatever else it matched.
 */
async function dropUndeliverableFills(
  db: Db,
  fills: Fill[],
  takerSide: OrderSide,
): Promise<{ kept: Fill[]; rejectedMakerIds: string[] }> {
  if (takerSide === OrderSide.SELL) return { kept: fills, rejectedMakerIds: [] };

  const byMaker = new Map<string, number>();
  for (const f of fills) {
    byMaker.set(f.makerOrderId, roundKwh((byMaker.get(f.makerOrderId) ?? 0) + f.amountKwh));
  }

  const rejectedMakerIds: string[] = [];
  for (const [makerId, needed] of byMaker) {
    const maker = await db.order.findUniqueOrThrow({
      where: { id: makerId },
      select: { walletId: true },
    });
    const batches = await spendableTokens(db, maker.walletId);
    const held = roundKwh(batches.reduce((sum, b) => sum + num(b.amountKwh), 0));
    if (held + 0.0005 < needed) rejectedMakerIds.push(makerId);
  }

  return {
    kept: fills.filter((f) => !rejectedMakerIds.includes(f.makerOrderId)),
    rejectedMakerIds,
  };
}

async function closeMakerIfDone(db: Db, makerId: string) {
  const maker = await db.order.findUniqueOrThrow({ where: { id: makerId } });
  const remaining = roundKwh(num(maker.amountKwh) - num(maker.filledKwh));
  const status = isKwhDust(remaining) ? OrderStatus.FILLED : OrderStatus.PARTIALLY_FILLED;

  // A fully filled resting BUY releases whatever reservation is left over
  // (it was sized at the limit price; fills may have been cheaper).
  let releaseLeftover = 0;
  if (status === OrderStatus.FILLED && maker.side === OrderSide.BUY) {
    releaseLeftover = roundMoney(num(maker.reservedFiat));
    if (releaseLeftover > 0) {
      await db.wallet.update({
        where: { id: maker.walletId },
        data: { reservedFiat: { decrement: new Prisma.Decimal(releaseLeftover) } },
      });
    }
  }

  await db.order.update({
    where: { id: makerId },
    data: {
      status,
      ...(releaseLeftover > 0 ? { reservedFiat: new Prisma.Decimal(0) } : {}),
    },
  });
}

/**
 * Settle one fill: tokens from seller to buyer, money from buyer to seller,
 * commission to the platform, and a Trade row for the immutable journal
 * (§6 "Все сделки пишутся в неизменяемый журнал").
 */
async function settleFill(
  db: Db,
  args: {
    zone: GridZone;
    fill: Fill;
    takerOrderId: string;
    takerSide: OrderSide;
    takerWalletId: string;
    takerFeePct: number;
  },
): Promise<{ tradeId: string; takerFee: number; makerFee: number }> {
  const { zone, fill, takerOrderId, takerSide, takerWalletId, takerFeePct } = args;

  const maker = await db.order.findUniqueOrThrow({ where: { id: fill.makerOrderId } });
  const makerFeePct = (await feeRatesFor(db, maker.walletId)).tradeFeePct;

  const buyOrderId = takerSide === OrderSide.BUY ? takerOrderId : maker.id;
  const sellOrderId = takerSide === OrderSide.BUY ? maker.id : takerOrderId;
  const buyerWalletId = takerSide === OrderSide.BUY ? takerWalletId : maker.walletId;
  const sellerWalletId = takerSide === OrderSide.BUY ? maker.walletId : takerWalletId;
  const buyerFeePct = takerSide === OrderSide.BUY ? takerFeePct : makerFeePct;
  const sellerFeePct = takerSide === OrderSide.BUY ? makerFeePct : takerFeePct;

  const value = notionalOf(fill.amountKwh, fill.price);
  const { buyerFee, sellerFee } = splitTradeFees(value, buyerFeePct, sellerFeePct);

  // Tokens first: if the seller cannot deliver, nothing else may happen.
  await transferTokens(db, {
    fromWalletId: sellerWalletId,
    toWalletId: buyerWalletId,
    amountKwh: fill.amountKwh,
    status: EnergyTokenStatus.SOLD,
  });

  // Money. A resting BUY paid into its reservation; release what this fill uses.
  const buyerDebit = roundMoney(value + buyerFee);
  if (takerSide === OrderSide.SELL) {
    const reserved = roundMoney(num(maker.reservedFiat));
    const release = Math.min(reserved, buyerDebit);
    if (release > 0) {
      await db.wallet.update({
        where: { id: buyerWalletId },
        data: { reservedFiat: { decrement: new Prisma.Decimal(release) } },
      });
      await db.order.update({
        where: { id: maker.id },
        data: { reservedFiat: { decrement: new Prisma.Decimal(release) } },
      });
    }
  }
  await db.wallet.update({
    where: { id: buyerWalletId },
    data: { fiatBalance: { decrement: new Prisma.Decimal(buyerDebit) } },
  });
  await db.wallet.update({
    where: { id: sellerWalletId },
    data: { fiatBalance: { increment: new Prisma.Decimal(roundMoney(value - sellerFee)) } },
  });

  const trade = await db.trade.create({
    data: {
      zoneId: zone.id,
      buyOrderId,
      sellOrderId,
      amountKwh: new Prisma.Decimal(fill.amountKwh),
      price: new Prisma.Decimal(fill.price),
      buyerFee: new Prisma.Decimal(buyerFee),
      sellerFee: new Prisma.Decimal(sellerFee),
    },
  });

  // §46: a trade gets its own receipt, separate from a charging receipt.
  await db.receipt.create({
    data: {
      tradeId: trade.id,
      burnedTokenIds: [],
      totalKwh: new Prisma.Decimal(fill.amountKwh),
      totalFiat: new Prisma.Decimal(roundMoney(value + buyerFee)),
      currency: zone.currency,
      breakdown: {
        kind: "trade",
        amountKwh: fill.amountKwh,
        price: fill.price,
        notional: value,
        buyerFee,
        sellerFee,
        zone: zone.code,
      } as Prisma.InputJsonValue,
    },
  });

  await db.order.update({
    where: { id: maker.id },
    data: { filledKwh: { increment: new Prisma.Decimal(fill.amountKwh) } },
  });
  await closeMakerIfDone(db, maker.id);

  await writeAudit(db, {
    actor: "system",
    entity: "Trade",
    entityId: trade.id,
    action: "trade.settled",
    after: {
      amountKwh: fill.amountKwh,
      price: fill.price,
      buyOrderId,
      sellOrderId,
      buyerFee,
      sellerFee,
    },
  });

  return { tradeId: trade.id, takerFee: takerSide === OrderSide.BUY ? buyerFee : sellerFee, makerFee: takerSide === OrderSide.BUY ? sellerFee : buyerFee };
}

export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const amountKwh = roundKwh(input.amountKwh);
  if (!(amountKwh > 0)) throw new OrderRejected("Amount must be positive");
  if (input.type === OrderType.LIMIT && input.limitPrice == null) {
    throw new OrderRejected("A limit order requires a limit price");
  }
  const limitPrice = input.limitPrice != null ? roundPrice(input.limitPrice) : null;
  if (limitPrice != null && !(limitPrice > 0)) {
    throw new OrderRejected("Limit price must be positive");
  }

  return prisma.$transaction(async (tx) => {
    if (input.idempotencyKey) {
      const existing = await tx.order.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { buyTrades: { select: { id: true } }, sellTrades: { select: { id: true } } },
      });
      if (existing) {
        return {
          orderId: existing.id,
          status: existing.status,
          filledKwh: num(existing.filledKwh),
          remainingKwh: roundKwh(num(existing.amountKwh) - num(existing.filledKwh)),
          avgPrice: numOrNull(existing.avgPrice),
          notional: roundMoney(num(existing.filledKwh) * num(existing.avgPrice ?? 0)),
          fee: 0,
          tradeIds: [...existing.buyTrades, ...existing.sellTrades].map((t) => t.id),
          rejectReason: existing.rejectReason,
          idempotentReplay: true,
        } satisfies PlaceOrderResult;
      }
    }

    const zone = await tx.gridZone.findUniqueOrThrow({ where: { id: input.zoneId } });
    const wallet = await getOrCreateWallet(input.userId, zone.id, tx);
    const corridor = zoneCorridor(zone);
    const intervalStart = input.intervalStart ?? null;

    // §16.5 — a limit price outside the corridor never enters the book.
    const corridorReason =
      limitPrice != null ? corridorRejectReason(limitPrice, corridor) : null;

    const order = await tx.order.create({
      data: {
        walletId: wallet.id,
        zoneId: zone.id,
        side: input.side,
        type: input.type,
        intervalStart,
        amountKwh: new Prisma.Decimal(amountKwh),
        limitPrice: limitPrice != null ? new Prisma.Decimal(limitPrice) : null,
        idempotencyKey: input.idempotencyKey ?? null,
        status: corridorReason ? OrderStatus.REJECTED : OrderStatus.NEW,
        rejectReason: corridorReason,
      },
    });

    const reject = async (reason: string): Promise<PlaceOrderResult> => {
      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.REJECTED, rejectReason: reason },
      });
      await writeAudit(tx, {
        actor: input.userId,
        entity: "Order",
        entityId: order.id,
        action: "order.rejected",
        after: { reason },
      });
      return {
        orderId: order.id,
        status: OrderStatus.REJECTED,
        filledKwh: 0,
        remainingKwh: amountKwh,
        avgPrice: null,
        notional: 0,
        fee: 0,
        tradeIds: [],
        rejectReason: reason,
        idempotentReplay: false,
      };
    };

    if (corridorReason) return reject(corridorReason);

    const rates = await feeRatesFor(tx, wallet.id);

    // A seller must actually hold the kWh it is offering (§16.1: tokens are
    // the inventory, not a promise).
    if (input.side === OrderSide.SELL) {
      const batches = await spendableTokens(tx, wallet.id);
      const held = roundKwh(batches.reduce((sum, b) => sum + num(b.amountKwh), 0));
      if (held + 0.0005 < amountKwh) {
        return reject(`Wallet holds ${held} kWh, cannot sell ${amountKwh} kWh`);
      }
    }

    const book = await loadBook(tx, zone.id, input.side, intervalStart);
    const match = matchOrder(
      {
        id: order.id,
        side: input.side,
        type: input.type,
        limitPrice,
        amountKwh,
        walletId: wallet.id,
      },
      book,
      corridor,
    );

    const { kept, rejectedMakerIds } = await dropUndeliverableFills(tx, match.fills, input.side);
    for (const makerId of rejectedMakerIds) {
      await tx.order.update({
        where: { id: makerId },
        data: {
          status: OrderStatus.REJECTED,
          rejectReason: "Seller no longer holds the offered kWh",
        },
      });
      await writeAudit(tx, {
        actor: "system",
        entity: "Order",
        entityId: makerId,
        action: "order.rejected",
        after: { reason: "undeliverable" },
      });
    }

    const filledKwh = roundKwh(kept.reduce((sum, f) => sum + f.amountKwh, 0));
    const grossNotional = roundMoney(
      kept.reduce((sum, f) => roundMoney(sum + notionalOf(f.amountKwh, f.price)), 0),
    );

    // Funding check for a buyer, before anything settles (§12 US-06 reserve).
    if (input.side === OrderSide.BUY) {
      const restingKwh = roundKwh(amountKwh - filledKwh);
      const restingCost =
        input.type === OrderType.LIMIT && limitPrice != null
          ? notionalOf(restingKwh, limitPrice)
          : 0;
      const needed = roundMoney(
        grossNotional +
          tradeFee(grossNotional, rates.tradeFeePct) +
          restingCost +
          tradeFee(restingCost, rates.tradeFeePct),
      );
      const available = roundMoney(num(wallet.fiatBalance) - num(wallet.reservedFiat));
      if (needed > available) {
        return reject(
          `Insufficient funds: ${needed} ${wallet.currency} needed, ${available} available`,
        );
      }
    }

    const tradeIds: string[] = [];
    let takerFeeTotal = 0;
    try {
      for (const fill of kept) {
        const settled = await settleFill(tx, {
          zone,
          fill,
          takerOrderId: order.id,
          takerSide: input.side,
          takerWalletId: wallet.id,
          takerFeePct: rates.tradeFeePct,
        });
        tradeIds.push(settled.tradeId);
        takerFeeTotal = roundMoney(takerFeeTotal + settled.takerFee);
      }
    } catch (err) {
      if (err instanceof InsufficientTokensError) return reject(err.message);
      throw err;
    }

    const remainingKwh = roundKwh(amountKwh - filledKwh);
    const avgPrice = filledKwh > 0 ? roundPrice(grossNotional / filledKwh) : null;

    let status: OrderStatus;
    let reservedFiat = 0;
    if (isKwhDust(remainingKwh)) {
      status = OrderStatus.FILLED;
    } else if (input.type === OrderType.MARKET) {
      // §6: a market order never rests — the unfillable part expires.
      status = filledKwh > 0 ? OrderStatus.PARTIALLY_FILLED : OrderStatus.EXPIRED;
    } else {
      status = filledKwh > 0 ? OrderStatus.PARTIALLY_FILLED : OrderStatus.NEW;
      if (input.side === OrderSide.BUY && limitPrice != null) {
        const restingCost = notionalOf(remainingKwh, limitPrice);
        reservedFiat = roundMoney(restingCost + tradeFee(restingCost, rates.tradeFeePct));
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { reservedFiat: { increment: new Prisma.Decimal(reservedFiat) } },
        });
      }
    }

    await tx.order.update({
      where: { id: order.id },
      data: {
        filledKwh: new Prisma.Decimal(filledKwh),
        avgPrice: avgPrice != null ? new Prisma.Decimal(avgPrice) : null,
        status,
        reservedFiat: new Prisma.Decimal(reservedFiat),
      },
    });

    await writeAudit(tx, {
      actor: input.userId,
      entity: "Order",
      entityId: order.id,
      action: "order.placed",
      after: {
        side: input.side,
        type: input.type,
        amountKwh,
        limitPrice,
        filledKwh,
        avgPrice,
        status,
        reservedFiat,
        skipped: match.skipped,
      },
    });

    return {
      orderId: order.id,
      status,
      filledKwh,
      remainingKwh: isKwhDust(remainingKwh) ? 0 : remainingKwh,
      avgPrice,
      notional: grossNotional,
      fee: takerFeeTotal,
      tradeIds,
      rejectReason: null,
      idempotentReplay: false,
    };
  }, { timeout: 20_000 });
}

/** DELETE /v1/orders/{id} — §14 new / partially_filled → cancelled. */
export async function cancelOrder(orderId: string, userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { wallet: { select: { ownerUserId: true } } },
    });
    if (!order) throw new OrderRejected("Order not found");
    if (order.wallet.ownerUserId !== userId) throw new OrderRejected("Not your order");
    if (order.status !== OrderStatus.NEW && order.status !== OrderStatus.PARTIALLY_FILLED) {
      throw new OrderRejected(`Cannot cancel an order in status ${order.status}`);
    }

    const reserved = roundMoney(num(order.reservedFiat));
    if (reserved > 0) {
      await tx.wallet.update({
        where: { id: order.walletId },
        data: { reservedFiat: { decrement: new Prisma.Decimal(reserved) } },
      });
    }
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.CANCELLED,
        cancelledAt: new Date(),
        reservedFiat: new Prisma.Decimal(0),
      },
    });
    await writeAudit(tx, {
      actor: userId,
      entity: "Order",
      entityId: orderId,
      action: "order.cancelled",
      before: { status: order.status, reservedFiat: reserved },
    });
  });
}

/** §14 — expire resting orders once their delivery interval starts. */
export async function expireOrdersForInterval(zoneId: string, intervalStart: Date) {
  const { count } = await prisma.order.updateMany({
    where: {
      zoneId,
      intervalStart,
      status: { in: [OrderStatus.NEW, OrderStatus.PARTIALLY_FILLED] },
    },
    data: { status: OrderStatus.EXPIRED },
  });
  return count;
}

export interface OrderBookView {
  zone: { id: string; code: string; currency: string; intervalMinutes: number };
  intervalStart: string | null;
  spotPrice: number | null;
  corridor: { min: number; max: number } | null;
  bids: { price: number; amountKwh: number; orders: number }[];
  asks: { price: number; amountKwh: number; orders: number }[];
  bestBid: number | null;
  bestAsk: number | null;
}

/** GET /v1/zones/{id}/orderbook. */
export async function readOrderBook(
  zoneId: string,
  intervalStart: Date | null,
  db: Db = prisma,
): Promise<OrderBookView> {
  const zone = await db.gridZone.findUniqueOrThrow({ where: { id: zoneId } });
  const rows = await db.order.findMany({
    where: {
      zoneId,
      type: OrderType.LIMIT,
      status: { in: [OrderStatus.NEW, OrderStatus.PARTIALLY_FILLED] },
      ...(intervalStart ? { OR: [{ intervalStart }, { intervalStart: null }] } : {}),
    },
    select: {
      id: true,
      side: true,
      limitPrice: true,
      amountKwh: true,
      filledKwh: true,
      createdAt: true,
    },
  });

  const resting: RestingOrder[] = rows
    .filter((r) => r.limitPrice != null)
    .map((r) => ({
      id: r.id,
      side: r.side,
      limitPrice: num(r.limitPrice),
      remainingKwh: roundKwh(num(r.amountKwh) - num(r.filledKwh)),
      createdAt: r.createdAt.getTime(),
    }));

  const { bids, asks } = aggregateBook(resting);
  const spot = numOrNull(zone.spotPrice);
  const pct = numOrNull(zone.corridorPct);
  const corridor =
    spot != null && pct != null && spot > 0 && pct > 0
      ? { min: roundPrice(spot * (1 - pct / 100)), max: roundPrice(spot * (1 + pct / 100)) }
      : null;

  return {
    zone: {
      id: zone.id,
      code: zone.code,
      currency: zone.currency,
      intervalMinutes: zone.intervalMinutes,
    },
    intervalStart: intervalStart?.toISOString() ?? null,
    spotPrice: spot,
    corridor,
    bids,
    asks,
    ...bestPrice(resting),
  };
}

export interface MarketQuote {
  filledKwh: number;
  notional: number;
  avgPrice: number | null;
  unavailableKwh: number;
}

/**
 * Dry-run a market order against the live book without touching anything.
 *
 * The payment flow needs this before it authorizes a card: §16.6 requires the
 * hold to be placed *before* the market order runs, and the hold can only be
 * sized from what the book would currently fill.
 */
export async function quoteMarketOrder(
  zoneId: string,
  side: OrderSide,
  amountKwh: number,
  intervalStart: Date | null = null,
  db: Db = prisma,
): Promise<MarketQuote> {
  const amount = roundKwh(amountKwh);
  if (!(amount > 0)) return { filledKwh: 0, notional: 0, avgPrice: null, unavailableKwh: 0 };

  const zone = await db.gridZone.findUniqueOrThrow({ where: { id: zoneId } });
  const book = await loadBook(db, zoneId, side, intervalStart);
  const match = matchOrder(
    { id: "quote", side, type: OrderType.MARKET, limitPrice: null, amountKwh: amount },
    book,
    zoneCorridor(zone),
  );
  return {
    filledKwh: match.filledKwh,
    notional: match.notional,
    avgPrice: match.avgPrice,
    unavailableKwh: match.remainingKwh,
  };
}
