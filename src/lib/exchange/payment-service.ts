// Charging payments — ТЗ §8, §12 (US-08), §15 (POST /v1/payments/charge),
// §16.6–§16.7, §46 (receipt).
//
// The session runs as authorize → execute → capture, exactly as §14 prescribes
// for Payment. The authorization is sized from a dry-run quote *before* any
// token moves, because the hold has to cover a market order whose real price
// is only known once it runs.
//
// Scope note: the card leg is settled against the wallet's fiat balance. The
// Payment row carries the full authorize/capture lifecycle and `cardId`, so a
// PSP integration replaces two function bodies here and nothing else.

import { OrderSide, OrderType, PaymentStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { type Db, writeAudit } from "./audit";
import { type ChargePlan, planCharge } from "./charge";
import { num, numOrNull } from "./decimal";
import { DEFAULT_FEE_RATES } from "./fees";
import type { MatchResult } from "./matching";
import { isKwhDust, roundKwh, roundMoney } from "./precision";
import { notifyWallets } from "./realtime-notify";
import { placeOrder, quoteMarketOrder } from "./order-service";
import { burnTokens } from "./token-registry";
import { availableFiat, getOrCreateWallet } from "./wallet-service";
import { receiptStamp } from "@/lib/receipts/receipt-number";

export class PaymentError extends Error {}

export interface ChargeInput {
  userId: string;
  zoneId: string;
  requestedKwh: number;
  chargePointId?: string | null;
  cardId?: string | null;
  idempotencyKey?: string | null;
  /** Override the §16.6 Y% authorization buffer. */
  authBufferPct?: number;
}

export interface ChargeResult {
  paymentId: string;
  status: PaymentStatus;
  deliveredKwh: number;
  kwhFromBalance: number;
  kwhBought: number;
  unservedKwh: number;
  authorizedFiat: number;
  amountFiat: number;
  currency: string;
  receiptId: string | null;
  burnedTokenIds: string[];
  failureReason: string | null;
  idempotentReplay: boolean;
}

function quoteToMatch(q: { filledKwh: number; notional: number; avgPrice: number | null; unavailableKwh: number }): MatchResult | null {
  if (isKwhDust(q.filledKwh)) return null;
  return {
    fills: [],
    filledKwh: q.filledKwh,
    remainingKwh: q.unavailableKwh,
    notional: q.notional,
    avgPrice: q.avgPrice,
    skipped: [],
  };
}

/**
 * Quote a session without charging anything — what the app shows before the
 * user confirms (§54 "Клиент видит итоговую цену и все платы до подтверждения").
 */
export async function quoteCharge(
  input: Omit<ChargeInput, "idempotencyKey">,
): Promise<ChargePlan & { currency: string }> {
  const zone = await prisma.gridZone.findUniqueOrThrow({ where: { id: input.zoneId } });
  const wallet = await getOrCreateWallet(input.userId, zone.id);
  const requested = roundKwh(input.requestedKwh);
  const balance = num(wallet.kwhBalance);
  const shortfall = roundKwh(Math.max(0, requested - Math.min(balance, requested)));

  const quote =
    shortfall > 0
      ? await quoteMarketOrder(zone.id, OrderSide.BUY, shortfall)
      : { filledKwh: 0, notional: 0, avgPrice: null, unavailableKwh: 0 };

  const plan = planCharge({
    requestedKwh: requested,
    walletKwhBalance: balance,
    market: quoteToMatch(quote),
    aggregatorPrice: numOrNull(zone.spotPrice),
    authBufferPct: input.authBufferPct,
    chargeFeePct: DEFAULT_FEE_RATES.chargeFeePct,
  });

  return { ...plan, currency: zone.currency };
}

/** POST /v1/payments/charge — US-08. */
export async function chargeSession(input: ChargeInput): Promise<ChargeResult> {
  const requested = roundKwh(input.requestedKwh);
  if (!(requested > 0)) throw new PaymentError("Requested kWh must be positive");

  if (input.idempotencyKey) {
    const existing = await prisma.payment.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { receipt: true, zone: { select: { currency: true } } },
    });
    if (existing) {
      return {
        paymentId: existing.id,
        status: existing.status,
        deliveredKwh: roundKwh(num(existing.kwhFromBalance) + num(existing.kwhBought)),
        kwhFromBalance: num(existing.kwhFromBalance),
        kwhBought: num(existing.kwhBought),
        unservedKwh: roundKwh(
          num(existing.requestedKwh) - num(existing.kwhFromBalance) - num(existing.kwhBought),
        ),
        authorizedFiat: num(existing.authorizedFiat),
        amountFiat: num(existing.amountFiat),
        currency: existing.zone.currency,
        receiptId: existing.receipt?.id ?? null,
        burnedTokenIds: existing.receipt?.burnedTokenIds ?? [],
        failureReason: existing.failureReason,
        idempotentReplay: true,
      };
    }
  }

  const zone = await prisma.gridZone.findUniqueOrThrow({ where: { id: input.zoneId } });
  const wallet = await getOrCreateWallet(input.userId, zone.id);

  // ── 1. Plan and authorize, before anything moves ────────────────────────
  const plan = await quoteCharge({
    userId: input.userId,
    zoneId: input.zoneId,
    requestedKwh: requested,
    authBufferPct: input.authBufferPct,
  });

  const payment = await prisma.payment.create({
    data: {
      walletId: wallet.id,
      zoneId: zone.id,
      chargePointId: input.chargePointId ?? null,
      cardId: input.cardId ?? null,
      requestedKwh: new Prisma.Decimal(requested),
      authorizedFiat: new Prisma.Decimal(plan.authorizedFiat),
      idempotencyKey: input.idempotencyKey ?? null,
      status: PaymentStatus.INITIATED,
    },
  });

  const fail = async (reason: string): Promise<ChargeResult> => {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.FAILED, failureReason: reason },
    });
    await writeAudit(prisma, {
      actor: input.userId,
      entity: "Payment",
      entityId: payment.id,
      action: "payment.failed",
      after: { reason },
    });
    return {
      paymentId: payment.id,
      status: PaymentStatus.FAILED,
      deliveredKwh: 0,
      kwhFromBalance: 0,
      kwhBought: 0,
      unservedKwh: requested,
      authorizedFiat: plan.authorizedFiat,
      amountFiat: 0,
      currency: zone.currency,
      receiptId: null,
      burnedTokenIds: [],
      failureReason: reason,
      idempotentReplay: false,
    };
  };

  if (!plan.feasible) {
    return fail("No liquidity: neither the wallet balance, the order book nor the aggregator can serve this session");
  }
  // The hold has to be coverable before the market order runs — §14's
  // initiated → authorized step is a real check, not a formality.
  if (availableFiat(wallet) + 0.0001 < plan.authorizedFiat) {
    return fail(
      `Insufficient funds for the ${plan.authorizedFiat} ${zone.currency} authorization hold`,
    );
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: PaymentStatus.AUTHORIZED, authorizedAt: new Date() },
  });

  // ── 2. Execute: buy the shortfall on the exchange (§16.6) ───────────────
  let kwhBought = 0;
  let energyCost = 0;
  let marketOrderId: string | null = null;

  const shortfall = roundKwh(requested - plan.kwhFromBalance);
  if (!isKwhDust(shortfall)) {
    const order = await placeOrder({
      userId: input.userId,
      zoneId: zone.id,
      side: OrderSide.BUY,
      type: OrderType.MARKET,
      amountKwh: shortfall,
      idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:market` : null,
    });
    marketOrderId = order.orderId;
    kwhBought = order.filledKwh;
    energyCost = roundMoney(order.notional + order.fee);

    if (isKwhDust(kwhBought) && isKwhDust(plan.kwhFromBalance)) {
      return fail(order.rejectReason ?? "Market order could not be filled");
    }
  }

  // ── 3. Burn what is delivered and capture (§8.2, §14 → captured) ────────
  const deliveredKwh = roundKwh(plan.kwhFromBalance + kwhBought);
  let burnedTokenIds: string[] = [];
  let receiptId: string | null = null;

  await prisma.$transaction(async (tx) => {
    burnedTokenIds = await burnTokens(tx, { walletId: wallet.id, amountKwh: deliveredKwh });

    const receipt = await tx.receipt.create({
      data: {
        ...(await receiptStamp(tx)),
        paymentId: payment.id,
        burnedTokenIds,
        totalKwh: new Prisma.Decimal(deliveredKwh),
        totalFiat: new Prisma.Decimal(energyCost),
        currency: zone.currency,
        // §46 "Состав чека" — kept verbatim for the accounting export.
        breakdown: {
          kind: "charge",
          zone: zone.code,
          chargePointId: input.chargePointId ?? null,
          requestedKwh: requested,
          kwhFromBalance: plan.kwhFromBalance,
          kwhBought,
          unservedKwh: roundKwh(requested - deliveredKwh),
          energyCost,
          marketOrderId,
          authorizedFiat: plan.authorizedFiat,
        } as Prisma.InputJsonValue,
      },
    });
    receiptId = receipt.id;

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.CAPTURED,
        kwhFromBalance: new Prisma.Decimal(plan.kwhFromBalance),
        kwhBought: new Prisma.Decimal(kwhBought),
        amountFiat: new Prisma.Decimal(energyCost),
        marketOrderId,
        capturedAt: new Date(),
      },
    });

    await writeAudit(tx, {
      actor: input.userId,
      entity: "Payment",
      entityId: payment.id,
      action: "payment.captured",
      after: {
        deliveredKwh,
        kwhFromBalance: plan.kwhFromBalance,
        kwhBought,
        amountFiat: energyCost,
        authorizedFiat: plan.authorizedFiat,
        burnedTokenIds: burnedTokenIds.length,
      },
    });
  }, { timeout: 20_000 });

  // §15, US-17 — the balance the driver just spent from, on any open page.
  await notifyWallets([input.userId]);

  return {
    paymentId: payment.id,
    status: PaymentStatus.CAPTURED,
    deliveredKwh,
    kwhFromBalance: plan.kwhFromBalance,
    kwhBought,
    unservedKwh: roundKwh(requested - deliveredKwh),
    authorizedFiat: plan.authorizedFiat,
    amountFiat: energyCost,
    currency: zone.currency,
    receiptId,
    burnedTokenIds,
    failureReason: null,
    idempotentReplay: false,
  };
}

/** GET /v1/receipts/{id}. */
export async function readReceipt(receiptId: string, db: Db = prisma) {
  return db.receipt.findUnique({
    where: { id: receiptId },
    include: {
      payment: { select: { id: true, walletId: true, chargePointId: true, status: true } },
      trade: { select: { id: true, zoneId: true, price: true, amountKwh: true } },
      // §35 US-33 — a no-show leaves a receipt, and its driver is the one
      // most likely to come looking for it.
      reservation: { select: { id: true, userId: true, walletId: true } },
    },
  });
}

export interface ReceiptView {
  id: string;
  paymentId: string | null;
  tradeId: string | null;
  reservationId: string | null;
  burnedTokenIds: string[];
  totalKwh: number;
  totalFiat: number;
  currency: string;
  breakdown: unknown;
  issuedAt: Date;
}

/**
 * The receipt as its owner may see it, or null — §46, and US-07's "чек в
 * истории". A receipt belongs to whoever stood on either leg: the payer of a
 * charge, both sides of a trade, or the driver of the booking that was not
 * used. The operator sees every one.
 *
 * Both the page and GET /v1/receipts/{id} ask this, so the rule is written
 * once; a receipt is a financial document and "who may read it" is not a
 * decision to leave to each caller.
 */
export async function readReceiptForUser(
  receiptId: string,
  userId: string,
  isOperator: boolean,
  db: Db = prisma,
): Promise<ReceiptView | null> {
  const receipt = await readReceipt(receiptId, db);
  if (!receipt) return null;

  if (!isOperator) {
    const wallets = await db.wallet.findMany({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    const mine = new Set(wallets.map((w) => w.id));

    let owned = receipt.payment ? mine.has(receipt.payment.walletId) : false;
    if (!owned && receipt.trade) {
      const trade = await db.trade.findUnique({
        where: { id: receipt.trade.id },
        select: {
          buyOrder: { select: { walletId: true } },
          sellOrder: { select: { walletId: true } },
        },
      });
      owned = Boolean(
        trade && (mine.has(trade.buyOrder.walletId) || mine.has(trade.sellOrder.walletId)),
      );
    }
    if (!owned && receipt.reservation) {
      owned = receipt.reservation.userId === userId;
    }
    if (!owned) return null;
  }

  return {
    id: receipt.id,
    paymentId: receipt.paymentId,
    tradeId: receipt.tradeId,
    reservationId: receipt.reservationId,
    burnedTokenIds: receipt.burnedTokenIds,
    totalKwh: num(receipt.totalKwh),
    totalFiat: num(receipt.totalFiat),
    currency: receipt.currency,
    breakdown: receipt.breakdown,
    issuedAt: receipt.issuedAt,
  };
}

/** §7 / US-07 — buy kWh ahead at the market price, in one click. */
export async function buyAhead(args: {
  userId: string;
  zoneId: string;
  amountKwh: number;
  limitPrice?: number | null;
  idempotencyKey?: string | null;
}) {
  return placeOrder({
    userId: args.userId,
    zoneId: args.zoneId,
    side: OrderSide.BUY,
    type: args.limitPrice != null ? OrderType.LIMIT : OrderType.MARKET,
    amountKwh: args.amountKwh,
    limitPrice: args.limitPrice ?? null,
    idempotencyKey: args.idempotencyKey ?? null,
  });
}
