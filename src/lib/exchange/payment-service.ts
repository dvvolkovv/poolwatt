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
import { availableGiftKwh, spendGrants } from "@/lib/marketing/grant-spend";
import { splitSessionRevenue, subpartnerFeePctFor } from "@/lib/pricing/subpartner-service";
import { pricingAt } from "@/lib/pricing/pricing-service";
import { receiptStamp } from "@/lib/receipts/receipt-number";
import { deliverReceipt } from "@/lib/receipts/receipt-delivery";

export class PaymentError extends Error {}

export interface ChargeInput {
  userId: string;
  zoneId: string;
  requestedKwh: number;
  /** Whatever the equipment calls itself. Free-form, not an identity. */
  chargePointId?: string | null;
  /**
   * §46 "Пункт, разъём, дата и время начала и конца зарядки" — the point in
   * our own database this session ran at. Null for a charge somewhere else:
   * the receipt is still issued, just without a network behind it.
   */
  pointId?: string | null;
  connectorId?: string | null;
  startedAt?: Date | null;
  endedAt?: Date | null;
  cardId?: string | null;
  idempotencyKey?: string | null;
  /** Override the §16.6 Y% authorization buffer. */
  authBufferPct?: number;
}

/**
 * The session's own point, checked before anything moves.
 *
 * A point id that is not ours would quietly produce a receipt with no network
 * and a gift that cannot be judged, so it is refused rather than ignored.
 */
async function resolveSession(input: ChargeInput): Promise<{
  pointId: string | null;
  connectorId: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
}> {
  const startedAt = input.startedAt ?? null;
  const endedAt = input.endedAt ?? null;
  if (startedAt && endedAt && endedAt < startedAt) {
    throw new PaymentError("The session ends before it starts");
  }

  if (!input.pointId) {
    if (input.connectorId) throw new PaymentError("A connector without a point is not a session");
    return { pointId: null, connectorId: null, startedAt, endedAt };
  }

  const point = await prisma.acceptancePoint.findUnique({
    where: { id: input.pointId },
    select: { id: true },
  });
  if (!point) throw new PaymentError(`No such point: ${input.pointId}`);

  if (input.connectorId) {
    const connector = await prisma.pointConnector.findUnique({
      where: { id: input.connectorId },
      select: { pointId: true },
    });
    if (!connector || connector.pointId !== point.id) {
      throw new PaymentError("That connector belongs to a different point");
    }
  }

  return { pointId: point.id, connectorId: input.connectorId ?? null, startedAt, endedAt };
}

export interface ChargeResult {
  paymentId: string;
  status: PaymentStatus;
  deliveredKwh: number;
  /** §43 promo kWh spent on this session; the driver pays nothing for them. */
  kwhFromGift: number;
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

  // §43 — the partner's gift goes before the balance, and only in the network
  // it belongs to. A session with no point of ours gets nothing (US-43).
  const giftKwh = await availableGiftKwh(input.userId, input.pointId ?? null);

  const afterGift = roundKwh(Math.max(0, requested - Math.min(giftKwh, requested)));
  const shortfall = roundKwh(Math.max(0, afterGift - Math.min(balance, afterGift)));

  const quote =
    shortfall > 0
      ? await quoteMarketOrder(zone.id, OrderSide.BUY, shortfall)
      : { filledKwh: 0, notional: 0, avgPrice: null, unavailableKwh: 0 };

  // §53 — the commission on a charging session comes from the plan of the
  // network the session ran in. Before this it was always the built-in 2 %:
  // the plans existed and nothing read them.
  const chargeFeePct = await chargeFeePctFor(input.pointId ?? null);

  const plan = planCharge({
    requestedKwh: requested,
    giftKwh,
    walletKwhBalance: balance,
    market: quoteToMatch(quote),
    aggregatorPrice: numOrNull(zone.spotPrice),
    authBufferPct: input.authBufferPct,
    chargeFeePct,
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
        deliveredKwh: roundKwh(
          num(existing.kwhFromBalance) + num(existing.kwhBought) + giftOf(existing.receipt),
        ),
        kwhFromGift: giftOf(existing.receipt),
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
  const session = await resolveSession(input);

  // ── 1. Plan and authorize, before anything moves ────────────────────────
  const plan = await quoteCharge({
    userId: input.userId,
    zoneId: input.zoneId,
    requestedKwh: requested,
    pointId: session.pointId,
    authBufferPct: input.authBufferPct,
  });

  // §54 — the tariff version this session is priced under, taken once and
  // stamped on the payment. Everything that reads the price afterwards (the
  // receipt, the accounting export) reads that version, not whatever the
  // partner has set since.
  const tariffVersion = session.pointId
    ? (await pricingAt("POINT_TARIFF", session.pointId, session.startedAt ?? new Date()))?.version ??
      null
    : null;

  const payment = await prisma.payment.create({
    data: {
      walletId: wallet.id,
      zoneId: zone.id,
      chargePointId: input.chargePointId ?? null,
      pointId: session.pointId,
      tariffVersion,
      connectorId: session.connectorId,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
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
      kwhFromGift: 0,
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
  // §53 — what the platform actually took on this session: the commission of
  // the market order that served it.
  let marketFee = 0;
  let marketOrderId: string | null = null;

  const shortfall = roundKwh(requested - plan.kwhFromGift - plan.kwhFromBalance);
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
    marketFee = roundMoney(order.fee);
    energyCost = roundMoney(order.notional + order.fee);

    if (isKwhDust(kwhBought) && isKwhDust(plan.kwhFromBalance) && isKwhDust(plan.kwhFromGift)) {
      return fail(order.rejectReason ?? "Market order could not be filled");
    }
  }

  // ── 3. Burn what is delivered and capture (§8.2, §14 → captured) ────────
  // §52 — a franchise commission, when this point belongs to a franchisee.
  const subpartner = await subpartnerFeePctFor(session.pointId);

  let giftSpent = 0;
  let giftNetwork: string | null = null;
  let deliveredKwh = roundKwh(plan.kwhFromGift + plan.kwhFromBalance + kwhBought);
  let burnedTokenIds: string[] = [];
  let receiptId: string | null = null;

  await prisma.$transaction(async (tx) => {
    // §43 — the gift is spent first, out of the partner's own batches. What
    // it could not cover the driver pays for out of their own balance, which
    // is already on it: the gift only ever shrinks.
    const gift = await spendGrants(tx, {
      userId: input.userId,
      pointId: session.pointId,
      amountKwh: plan.kwhFromGift,
    });
    giftSpent = gift.spentKwh;
    giftNetwork = gift.networkName;

    const fromOwn = roundKwh(plan.kwhFromBalance + kwhBought + (plan.kwhFromGift - giftSpent));
    const ownBalance = num(
      (await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } })).kwhBalance,
    );
    const fromOwnCovered = roundKwh(Math.min(fromOwn, Math.max(0, ownBalance)));
    deliveredKwh = roundKwh(giftSpent + fromOwnCovered);

    burnedTokenIds = [...gift.burnedTokenIds];
    if (!isKwhDust(fromOwnCovered)) {
      burnedTokenIds.push(
        ...(await burnTokens(tx, { walletId: wallet.id, amountKwh: fromOwnCovered })),
      );
    }

    // What the driver paid, divided the way §53 orders it: the platform
    // first, then the head network, and the rest is the partner's.
    const revenue = splitSessionRevenue({
      amountFiat: energyCost,
      platformFeeFiat: marketFee,
      subpartnerFeePct: subpartner.pct,
    });

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
          pointId: session.pointId,
          requestedKwh: requested,
          kwhFromGift: giftSpent,
          giftNetwork,
          // §54 — "расчёт комиссий … с отражением в облачной бухгалтерии
          // обеих сторон". Written onto the document, not recomputed later:
          // a rate that changes must not move a closed month.
          platformFee: revenue.platformFee,
          subpartnerFee: revenue.subpartnerFee,
          subpartnerHeadId: subpartner.headId,
          partnerNet: revenue.partnerNet,
          kwhFromBalance: roundKwh(deliveredKwh - giftSpent - kwhBought),
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
        kwhFromBalance: new Prisma.Decimal(roundKwh(deliveredKwh - giftSpent - kwhBought)),
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
        kwhFromGift: giftSpent,
        kwhFromBalance: roundKwh(deliveredKwh - giftSpent - kwhBought),
        kwhBought,
        amountFiat: energyCost,
        authorizedFiat: plan.authorizedFiat,
        burnedTokenIds: burnedTokenIds.length,
      },
    });
  }, { timeout: 20_000 });

  // §15, US-17 — the balance the driver just spent from, on any open page.
  await notifyWallets([input.userId]);

  // §46, US-45 — "чек формируется в течение минуты". It is already formed;
  // this tells the driver about it. Not awaited: a slow mail server must not
  // hold up the response to a charge that has already happened, and whatever
  // fails here the worker retries within the minute.
  if (receiptId) void deliverReceipt(receiptId);

  // §45, US-41 — "начисление в течение минуты после завершения зарядки".
  // Not awaited for the same reason: the charge has happened, and whatever
  // fails here the worker picks up within the minute from
  // `Payment.campaignsEvaluatedAt`.
  void awardGiftsAfterCharge(payment.id);

  return {
    paymentId: payment.id,
    status: PaymentStatus.CAPTURED,
    deliveredKwh,
    kwhFromGift: giftSpent,
    kwhFromBalance: roundKwh(deliveredKwh - giftSpent - kwhBought),
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

/**
 * §45, US-41 — look at the campaigns of the network this session ran in and
 * tell the driver about whatever they earned.
 *
 * Imported lazily: `payment-service` is the charging path, and the marketing
 * module imports back into it through the gift spend. A static cycle would
 * work, but a lazy edge keeps the direction of the dependency honest — the
 * exchange does not need marketing to charge a car.
 */
async function awardGiftsAfterCharge(paymentId: string): Promise<void> {
  try {
    const { awardAfterCharge } = await import("@/lib/marketing/campaign-engine");
    const { tellClientAboutGift } = await import("@/lib/marketing/gift-mail");
    for (const grantId of await awardAfterCharge(paymentId)) {
      await tellClientAboutGift(grantId);
    }
  } catch (err) {
    console.error("[payments] campaign award failed for", paymentId, err);
  }
}

/**
 * How many promo kWh a stored receipt says went into its session. Needed on
 * an idempotent replay, where the plan is long gone and the receipt's own
 * breakdown is the record (§46 "Состав чека").
 */
function giftOf(receipt: { breakdown: unknown } | null | undefined): number {
  if (!receipt) return 0;
  const b = receipt.breakdown as Record<string, unknown> | null;
  const value = b?.kwhFromGift;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * §53 — the platform's commission on a charging session, from the plan of the
 * network whose point it ran at. A session with no point of ours (a charge
 * somewhere else) falls back to the platform default.
 */
async function chargeFeePctFor(pointId: string | null): Promise<number> {
  if (!pointId) return DEFAULT_FEE_RATES.chargeFeePct;
  const point = await prisma.acceptancePoint.findUnique({
    where: { id: pointId },
    select: { operatorId: true },
  });
  if (!point) return DEFAULT_FEE_RATES.chargeFeePct;

  const { resolveFeeRates } = await import("@/lib/pricing/fee-plan-service");
  const rates = await resolveFeeRates({ operatorId: point.operatorId }).catch(() => null);
  return rates?.chargeFeePct ?? DEFAULT_FEE_RATES.chargeFeePct;
}
