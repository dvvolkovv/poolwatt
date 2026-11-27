// §22.3 "история операций с фильтром" — лента склеивается из четырёх
// таблиц, и ни одна незавершённая операция в неё не попадает.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readWalletHistory, readPurchaseStats } from "./wallet-history";

const PREFIX = "test_wh_";
const ZONE_CODE = "WHZONE";

let zoneId: string;
let meId: string;
let friendId: string;
let newbieId: string;
let myWalletId: string;
let friendWalletId: string;
let operatorId: string;
let campaignId: string;

async function cleanup() {
  await prisma.promoGrant.deleteMany({
    where: { user: { username: { startsWith: PREFIX } } },
  });
  const zone = await prisma.gridZone.findUnique({ where: { code: ZONE_CODE } });
  if (zone) {
    await prisma.receipt.deleteMany({
      where: { OR: [{ payment: { zoneId: zone.id } }, { trade: { zoneId: zone.id } }] },
    });
    await prisma.trade.deleteMany({ where: { zoneId: zone.id } });
    await prisma.payment.deleteMany({ where: { zoneId: zone.id } });
    await prisma.tokenTransfer.deleteMany({ where: { zoneId: zone.id } });
    await prisma.order.deleteMany({ where: { zoneId: zone.id } });
    await prisma.campaign.deleteMany({ where: { zoneId: zone.id } });
    await prisma.wallet.deleteMany({ where: { zoneId: zone.id } });
  }
  await prisma.paymentRefund.deleteMany({
    where: { wallet: { owner: { username: { startsWith: PREFIX } } } },
  });
  await prisma.ticket.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.campaign.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  if (zone) await prisma.gridZone.delete({ where: { id: zone.id } });
}

beforeAll(async () => {
  await cleanup();

  const zone = await prisma.gridZone.create({
    data: {
      code: ZONE_CODE,
      country: "SK",
      name: "History Zone",
      currency: "EUR",
      intervalMinutes: 15,
      corridorPct: new Prisma.Decimal(50),
      aggregatorName: "test-aggregator",
    },
  });
  zoneId = zone.id;

  const me = await prisma.user.create({
    data: { username: `${PREFIX}me`, passwordHash: "x" },
  });
  const friend = await prisma.user.create({
    data: { username: `${PREFIX}friend`, passwordHash: "x" },
  });
  // Человек без единой операции — у него нет даже кошелька.
  const newbie = await prisma.user.create({
    data: { username: `${PREFIX}newbie`, passwordHash: "x" },
  });
  meId = me.id;
  friendId = friend.id;
  newbieId = newbie.id;

  const myWallet = await prisma.wallet.create({
    data: { ownerUserId: meId, zoneId, currency: "EUR" },
  });
  const friendWallet = await prisma.wallet.create({
    data: { ownerUserId: friendId, zoneId, currency: "EUR" },
  });
  myWalletId = myWallet.id;
  friendWalletId = friendWallet.id;

  const operator = await prisma.chargerOperator.create({
    data: { slug: `${PREFIX}net`, displayName: "History Net" },
  });
  operatorId = operator.id;

  const campaign = await prisma.campaign.create({
    data: {
      name: `${PREFIX}campaign`,
      operatorId,
      zoneId,
      status: "ACTIVE",
      trigger: "FIRST_CHARGE",
      giftKwh: new Prisma.Decimal(5),
      budgetKwh: new Prisma.Decimal(100),
      validityDays: 30,
    },
  });
  campaignId = campaign.id;

  // Две сделки по моей заявке на покупку: 10 кВт·ч по 0.20 и 30 по 0.30.
  // Средневзвешенная цена — (10×0.2 + 30×0.3) / 40 = 0.275.
  const myBuy = await prisma.order.create({
    data: {
      walletId: myWalletId,
      zoneId,
      side: "BUY",
      type: "MARKET",
      amountKwh: new Prisma.Decimal(40),
      filledKwh: new Prisma.Decimal(40),
      status: "FILLED",
    },
  });
  const friendSell = await prisma.order.create({
    data: {
      walletId: friendWalletId,
      zoneId,
      side: "SELL",
      type: "LIMIT",
      amountKwh: new Prisma.Decimal(40),
      filledKwh: new Prisma.Decimal(40),
      limitPrice: new Prisma.Decimal(0.2),
      status: "FILLED",
    },
  });
  await prisma.trade.create({
    data: {
      zoneId,
      buyOrderId: myBuy.id,
      sellOrderId: friendSell.id,
      amountKwh: new Prisma.Decimal(10),
      price: new Prisma.Decimal(0.2),
      buyerFee: new Prisma.Decimal(0.01),
      executedAt: new Date("2026-11-01T10:00:00.000Z"),
    },
  });
  await prisma.trade.create({
    data: {
      zoneId,
      buyOrderId: myBuy.id,
      sellOrderId: friendSell.id,
      amountKwh: new Prisma.Decimal(30),
      price: new Prisma.Decimal(0.3),
      buyerFee: new Prisma.Decimal(0.02),
      executedAt: new Date("2026-11-02T10:00:00.000Z"),
    },
  });

  // Моя продажа.
  const mySell = await prisma.order.create({
    data: {
      walletId: myWalletId,
      zoneId,
      side: "SELL",
      type: "LIMIT",
      amountKwh: new Prisma.Decimal(4),
      filledKwh: new Prisma.Decimal(4),
      limitPrice: new Prisma.Decimal(0.25),
      status: "FILLED",
    },
  });
  const friendBuy = await prisma.order.create({
    data: {
      walletId: friendWalletId,
      zoneId,
      side: "BUY",
      type: "MARKET",
      amountKwh: new Prisma.Decimal(4),
      filledKwh: new Prisma.Decimal(4),
      status: "FILLED",
    },
  });
  await prisma.trade.create({
    data: {
      zoneId,
      buyOrderId: friendBuy.id,
      sellOrderId: mySell.id,
      amountKwh: new Prisma.Decimal(4),
      price: new Prisma.Decimal(0.25),
      sellerFee: new Prisma.Decimal(0.01),
      executedAt: new Date("2026-11-03T10:00:00.000Z"),
    },
  });

  // Зарядка со чеком и зарядка, которая ещё не состоялась.
  const captured = await prisma.payment.create({
    data: {
      walletId: myWalletId,
      zoneId,
      requestedKwh: new Prisma.Decimal(12),
      kwhFromBalance: new Prisma.Decimal(12),
      amountFiat: new Prisma.Decimal(3.6),
      status: "CAPTURED",
      createdAt: new Date("2026-11-04T10:00:00.000Z"),
      capturedAt: new Date("2026-11-04T10:30:00.000Z"),
    },
  });
  await prisma.receipt.create({
    data: {
      paymentId: captured.id,
      totalKwh: new Prisma.Decimal(12),
      totalFiat: new Prisma.Decimal(3.6),
      currency: "EUR",
    },
  });
  await prisma.payment.create({
    data: {
      walletId: myWalletId,
      zoneId,
      requestedKwh: new Prisma.Decimal(99),
      status: "INITIATED",
      createdAt: new Date("2026-11-05T10:00:00.000Z"),
    },
  });

  // Перевод наружу, перевод внутрь и отменённый перевод.
  await prisma.tokenTransfer.create({
    data: {
      zoneId,
      fromWalletId: myWalletId,
      toWalletId: friendWalletId,
      amountKwh: new Prisma.Decimal(2),
      status: "CONFIRMED",
      createdAt: new Date("2026-11-06T10:00:00.000Z"),
    },
  });
  await prisma.tokenTransfer.create({
    data: {
      zoneId,
      fromWalletId: friendWalletId,
      toWalletId: myWalletId,
      amountKwh: new Prisma.Decimal(3),
      status: "CONFIRMED",
      createdAt: new Date("2026-11-07T10:00:00.000Z"),
    },
  });
  await prisma.tokenTransfer.create({
    data: {
      zoneId,
      fromWalletId: myWalletId,
      toWalletId: friendWalletId,
      amountKwh: new Prisma.Decimal(50),
      status: "CANCELLED",
      createdAt: new Date("2026-11-08T10:00:00.000Z"),
    },
  });

  // Подарок §43.
  await prisma.promoGrant.create({
    data: {
      campaignId,
      userId: meId,
      operatorId,
      amountKwh: new Prisma.Decimal(5),
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      status: "ACTIVE",
      issuedAt: new Date("2026-11-09T10:00:00.000Z"),
    },
  });

  // §51 — возврат ошибочного списания по этой зарядке: деньги вернулись на
  // баланс, и в ленте кошелька это отдельная строка.
  const ticket = await prisma.ticket.create({
    data: {
      operatorId,
      paymentId: captured.id,
      reporterId: meId,
      problemType: "WRONG_PRICE",
    },
  });
  await prisma.paymentRefund.create({
    data: {
      paymentId: captured.id,
      ticketId: ticket.id,
      walletId: myWalletId,
      number: "PW-2026-WH0001",
      amountFiat: new Prisma.Decimal(1.2),
      currency: "EUR",
      reason: "wrong tariff",
      decidedById: friendId,
      createdAt: new Date("2026-11-10T10:00:00.000Z"),
    },
  });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("readWalletHistory", () => {
  it("merges every kind of operation, newest first", async () => {
    const rows = await readWalletHistory(meId);
    expect(rows.map((r) => r.kind)).toEqual([
      "REFUND",
      "GIFT",
      "TRANSFER_IN",
      "TRANSFER_OUT",
      "CHARGE",
      "SELL",
      "BUY",
      "BUY",
    ]);
  });

  it("signs kWh the way a person reads the operation", async () => {
    const rows = await readWalletHistory(meId);
    const byKind = (kind: string) => rows.find((r) => r.kind === kind)!;
    expect(byKind("BUY").kwh).toBeGreaterThan(0);
    expect(byKind("SELL").kwh).toBe(-4);
    expect(byKind("CHARGE").kwh).toBe(-12);
    expect(byKind("CHARGE").fiat).toBe(-3.6);
    expect(byKind("TRANSFER_OUT").kwh).toBe(-2);
    expect(byKind("TRANSFER_IN").kwh).toBe(3);
    expect(byKind("GIFT").kwh).toBe(5);
    // Возврат — только деньги: кВт·ч не возвращаются, за ними стоит
    // настоящая выработка (§8).
    expect(byKind("REFUND").fiat).toBe(1.2);
    expect(byKind("REFUND").kwh).toBe(0);
  });

  it("leaves out what has not happened", async () => {
    const rows = await readWalletHistory(meId);
    // Платёж INITIATED на 99 кВт·ч и отменённый перевод на 50.
    expect(rows.some((r) => Math.abs(r.kwh) === 99)).toBe(false);
    expect(rows.some((r) => Math.abs(r.kwh) === 50)).toBe(false);
  });

  it("filters by kind", async () => {
    const rows = await readWalletHistory(meId, { kinds: ["CHARGE", "GIFT"] });
    expect(rows.map((r) => r.kind)).toEqual(["GIFT", "CHARGE"]);
  });

  it("carries the receipt of a charge so the row can open it", async () => {
    const rows = await readWalletHistory(meId, { kinds: ["CHARGE"] });
    expect(rows[0]!.receiptId).toBeTruthy();
  });

  it("names the network of a gift", async () => {
    const rows = await readWalletHistory(meId, { kinds: ["GIFT"] });
    expect(rows[0]!.title).toBe("History Net");
  });

  it("names the other side of a transfer", async () => {
    const rows = await readWalletHistory(meId, { kinds: ["TRANSFER_OUT"] });
    expect(rows[0]!.title).toBe(`${PREFIX}friend`);
  });

  it("honours the limit", async () => {
    const rows = await readWalletHistory(meId, { limit: 2 });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.kind).toBe("REFUND");
  });

  it("shows nothing to somebody who has done nothing", async () => {
    const rows = await readWalletHistory(newbieId);
    expect(rows).toHaveLength(0);
  });

  it("does not hand one person's gift to another", async () => {
    const rows = await readWalletHistory(friendId, { kinds: ["GIFT"] });
    expect(rows).toHaveLength(0);
  });
});

describe("readPurchaseStats", () => {
  it("weights the average price by volume", async () => {
    const stats = await readPurchaseStats(meId);
    expect(stats.boughtKwh).toBe(40);
    expect(stats.avgPrice).toBe(0.275);
  });

  it("has no average before the first purchase", async () => {
    const stats = await readPurchaseStats(newbieId);
    expect(stats.boughtKwh).toBe(0);
    expect(stats.avgPrice).toBeNull();
  });
});
