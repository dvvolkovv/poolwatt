// US-43 end to end: a gift pays for a charge in the partner's own network and
// is left untouched in anybody else's. And §43's three prohibitions — a gift
// cannot be transferred, sold on the exchange or turned into money — which
// hold because a grant never enters the driver's balance at all.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/exchange/decimal";
import { chargeSession, quoteCharge } from "@/lib/exchange/payment-service";
import { placeOrder } from "@/lib/exchange/order-service";
import { buildReceiptDocument } from "@/lib/receipts/receipt-document";

const PREFIX = "test_giftflow_";
const ZONE_CODE = "TESTGIFTF";

let zoneId: string;
let operatorId: string;
let foreignOperatorId: string;
let partnerUserId: string;
let driverUserId: string;
let pointA: string;
let foreignPoint: string;
let campaignId: string;
let assetId: string;

async function wipe() {
  await prisma.receipt.deleteMany({ where: { payment: { zone: { code: ZONE_CODE } } } });
  await prisma.payment.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.promoGrant.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.campaign.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.trade.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.order.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.asset.deleteMany({ where: { company: { regNumber: `${PREFIX}reg` } } });
  await prisma.company.deleteMany({ where: { regNumber: `${PREFIX}reg` } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE_CODE } });
}

async function walletFor(userId: string) {
  return prisma.wallet.upsert({
    where: { ownerUserId_zoneId: { ownerUserId: userId, zoneId } },
    update: {},
    create: { ownerUserId: userId, zoneId },
  });
}

async function fund(userId: string, amount: number) {
  const wallet = await walletFor(userId);
  await prisma.energyToken.create({
    data: {
      zoneId,
      assetId,
      ownerWalletId: wallet.id,
      amountKwh: new Prisma.Decimal(amount),
      intervalStart: new Date(),
      status: "AVAILABLE",
    },
  });
  await prisma.wallet.update({
    where: { id: wallet.id },
    data: { kwhBalance: { increment: new Prisma.Decimal(amount) } },
  });
  return wallet;
}

async function giveGift(amountKwh: number) {
  return prisma.promoGrant.create({
    data: {
      campaignId,
      userId: driverUserId,
      operatorId,
      amountKwh: new Prisma.Decimal(amountKwh),
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    },
  });
}

beforeAll(async () => {
  await wipe();

  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE_CODE, country: "SK", name: "Gift flow zone", currency: "EUR" },
    })
  ).id;

  const user = async (name: string) =>
    (
      await prisma.user.upsert({
        where: { username: `${PREFIX}${name}` },
        update: {},
        create: { username: `${PREFIX}${name}`, passwordHash: "x" },
      })
    ).id;
  partnerUserId = await user("partner");
  driverUserId = await user("driver");

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: `${PREFIX}net`,
        displayName: "Gift flow network",
        claimedById: partnerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  foreignOperatorId = (
    await prisma.chargerOperator.create({
      data: { slug: `${PREFIX}other`, displayName: "Somebody else" },
    })
  ).id;

  pointA = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "A", gridZoneId: zoneId },
    })
  ).id;
  foreignPoint = (
    await prisma.acceptancePoint.create({
      data: {
        operatorId: foreignOperatorId,
        type: "CHARGING_STATION",
        name: "Theirs",
        gridZoneId: zoneId,
      },
    })
  ).id;

  campaignId = (
    await prisma.campaign.create({
      data: {
        operatorId,
        zoneId,
        name: "Welcome",
        trigger: "FIRST_CHARGE",
        giftKwh: new Prisma.Decimal(10),
        validityDays: 30,
        budgetKwh: new Prisma.Decimal(1000),
        status: "ACTIVE",
      },
    })
  ).id;

  const company = await prisma.company.create({
    data: {
      legalName: "Gift flow producer",
      country: "SK",
      regNumber: `${PREFIX}reg`,
      type: "PRODUCER",
      kybStatus: "APPROVED",
    },
  });
  assetId = (
    await prisma.asset.create({
      data: {
        companyId: company.id,
        gridZoneId: zoneId,
        kind: "SOLAR",
        name: "Gift flow roof",
        capacityKw: new Prisma.Decimal(50),
        status: "ACTIVE",
      },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.receipt.deleteMany({ where: { payment: { zoneId } } });
  await prisma.payment.deleteMany({ where: { zoneId } });
  await prisma.promoGrant.deleteMany({ where: { operatorId } });
  await prisma.trade.deleteMany({ where: { zoneId } });
  await prisma.order.deleteMany({ where: { zoneId } });
  await prisma.energyToken.deleteMany({ where: { zoneId } });
  await prisma.wallet.deleteMany({ where: { zoneId } });
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "ACTIVE", pauseReason: null },
  });
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("a gift pays for a charge in its own network (US-43)", () => {
  it("spends the gift first and leaves the driver's own kWh alone", async () => {
    await fund(partnerUserId, 20);
    const driverWallet = await fund(driverUserId, 5);
    await giveGift(8);

    const result = await chargeSession({
      userId: driverUserId,
      zoneId,
      requestedKwh: 8,
      pointId: pointA,
    });

    expect(result.status).toBe("CAPTURED");
    expect(result.kwhFromGift).toBe(8);
    expect(result.kwhFromBalance).toBe(0);
    expect(result.amountFiat).toBe(0);

    // The driver's 5 kWh are untouched; the partner paid the 8.
    expect(num((await prisma.wallet.findUniqueOrThrow({ where: { id: driverWallet.id } })).kwhBalance)).toBe(5);
    const partnerWallet = await walletFor(partnerUserId);
    expect(num((await prisma.wallet.findUniqueOrThrow({ where: { id: partnerWallet.id } })).kwhBalance)).toBe(12);
  });

  it("falls through to the driver's balance for what the gift does not cover", async () => {
    await fund(partnerUserId, 20);
    const driverWallet = await fund(driverUserId, 10);
    await giveGift(4);

    const result = await chargeSession({
      userId: driverUserId,
      zoneId,
      requestedKwh: 10,
      pointId: pointA,
    });

    expect(result.kwhFromGift).toBe(4);
    expect(result.kwhFromBalance).toBe(6);
    expect(result.deliveredKwh).toBe(10);
    expect(num((await prisma.wallet.findUniqueOrThrow({ where: { id: driverWallet.id } })).kwhBalance)).toBe(4);
  });

  it("prints the gift on the §46 receipt and names the network", async () => {
    await fund(partnerUserId, 20);
    await fund(driverUserId, 10);
    await giveGift(5);

    const result = await chargeSession({
      userId: driverUserId,
      zoneId,
      requestedKwh: 7,
      pointId: pointA,
    });

    const doc = await buildReceiptDocument(result.receiptId!);
    expect(doc?.payment.fromGiftKwh).toBe(5);
    expect(doc?.payment.fromBalanceKwh).toBe(2);
  });

  it("quotes a gifted session at nothing before the driver confirms", async () => {
    await fund(partnerUserId, 20);
    await fund(driverUserId, 10);
    await giveGift(10);

    const quote = await quoteCharge({
      userId: driverUserId,
      zoneId,
      requestedKwh: 10,
      pointId: pointA,
    });

    expect(quote.kwhFromGift).toBe(10);
    expect(quote.total).toBe(0);
    expect(quote.authorizedFiat).toBe(0);
  });
});

describe("a gift is not applied anywhere else (US-43)", () => {
  it("is untouched by a charge in somebody else's network", async () => {
    await fund(partnerUserId, 20);
    const driverWallet = await fund(driverUserId, 10);
    const gift = await giveGift(8);

    const result = await chargeSession({
      userId: driverUserId,
      zoneId,
      requestedKwh: 8,
      pointId: foreignPoint,
    });

    expect(result.kwhFromGift).toBe(0);
    expect(result.kwhFromBalance).toBe(8);
    expect(num((await prisma.promoGrant.findUniqueOrThrow({ where: { id: gift.id } })).usedKwh)).toBe(0);
    expect(num((await prisma.wallet.findUniqueOrThrow({ where: { id: driverWallet.id } })).kwhBalance)).toBe(2);
  });

  it("is untouched by a charge that names no point of ours", async () => {
    await fund(partnerUserId, 20);
    await fund(driverUserId, 10);
    const gift = await giveGift(8);

    const result = await chargeSession({ userId: driverUserId, zoneId, requestedKwh: 5 });

    expect(result.kwhFromGift).toBe(0);
    expect(num((await prisma.promoGrant.findUniqueOrThrow({ where: { id: gift.id } })).usedKwh)).toBe(0);
  });
});

describe("§43 — a gift cannot be transferred, sold or cashed out", () => {
  it("never shows up in the driver's kWh balance", async () => {
    const driverWallet = await walletFor(driverUserId);
    await giveGift(50);

    const after = await prisma.wallet.findUniqueOrThrow({ where: { id: driverWallet.id } });
    expect(num(after.kwhBalance)).toBe(0);
    // And no batch stands behind it: there is nothing to move.
    expect(await prisma.energyToken.count({ where: { ownerWalletId: driverWallet.id } })).toBe(0);
  });

  it("cannot be put up for sale on the exchange", async () => {
    await walletFor(driverUserId);
    await giveGift(50);

    // The book has no idea a gift exists, and the seller holds no batches, so
    // the offer is refused — there is nothing to deliver against it.
    const order = await placeOrder({
      userId: driverUserId,
      zoneId,
      side: "SELL",
      type: "LIMIT",
      amountKwh: 10,
      limitPrice: 0.2,
    });

    expect(order.status).toBe("REJECTED");
    expect(order.filledKwh).toBe(0);
  });
});
