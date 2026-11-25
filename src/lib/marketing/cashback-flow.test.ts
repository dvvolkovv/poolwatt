// US-12 end to end: a charge paid with tokens earns the share the partner's
// campaign promises, the receipt of §46.6 prints it, and a charge paid with
// money earns nothing.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { chargeSession } from "@/lib/exchange/payment-service";
import { buildReceiptDocument } from "@/lib/receipts/receipt-document";

const PREFIX = "test_cashback_";
const ZONE_CODE = "TESTCASHB";

let zoneId: string;
let operatorId: string;
let partnerUserId: string;
let driverUserId: string;
let sellerUserId: string;
let pointId: string;
let campaignId: string;
let assetId: string;

async function wipe() {
  await prisma.receipt.deleteMany({ where: { payment: { zone: { code: ZONE_CODE } } } });
  await prisma.promoGrant.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.payment.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.campaign.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.trade.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.order.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
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

async function fund(userId: string, kwh: number, fiat = 0) {
  const wallet = await walletFor(userId);
  if (kwh > 0) {
    await prisma.energyToken.create({
      data: {
        zoneId,
        assetId,
        ownerWalletId: wallet.id,
        amountKwh: new Prisma.Decimal(kwh),
        intervalStart: new Date(),
        status: "AVAILABLE",
      },
    });
  }
  await prisma.wallet.update({
    where: { id: wallet.id },
    data: {
      kwhBalance: { increment: new Prisma.Decimal(kwh) },
      fiatBalance: { increment: new Prisma.Decimal(fiat) },
    },
  });
  return wallet;
}

/** Energy on offer, so a session can buy what the balance does not cover. */
async function offer(kwh: number, price: number) {
  const wallet = await fund(sellerUserId, kwh);
  await prisma.order.create({
    data: {
      walletId: wallet.id,
      zoneId,
      side: "SELL",
      type: "LIMIT",
      amountKwh: new Prisma.Decimal(kwh),
      limitPrice: new Prisma.Decimal(price),
      status: "NEW",
    },
  });
}

async function grants() {
  return prisma.promoGrant.findMany({
    where: { campaignId, userId: driverUserId },
    orderBy: { issuedAt: "asc" },
  });
}

beforeAll(async () => {
  await wipe();

  zoneId = (
    await prisma.gridZone.create({
      data: {
        code: ZONE_CODE,
        country: "SK",
        name: "Cashback zone",
        currency: "EUR",
        corridorPct: new Prisma.Decimal(80),
        spotPrice: new Prisma.Decimal(0.2),
        spotPriceAt: new Date(),
      },
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
  sellerUserId = await user("seller");

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: `${PREFIX}net`,
        displayName: "Cashback network",
        claimedById: partnerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  pointId = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "Point", gridZoneId: zoneId },
    })
  ).id;

  const company = await prisma.company.create({
    data: {
      legalName: "Cashback producer",
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
        name: "Cashback roof",
        capacityKw: new Prisma.Decimal(50),
        status: "ACTIVE",
      },
    })
  ).id;
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

beforeEach(async () => {
  await prisma.receipt.deleteMany({ where: { payment: { zoneId } } });
  await prisma.promoGrant.deleteMany({ where: { operatorId } });
  await prisma.payment.deleteMany({ where: { zoneId } });
  await prisma.campaign.deleteMany({ where: { operatorId } });
  await prisma.trade.deleteMany({ where: { zoneId } });
  await prisma.order.deleteMany({ where: { zoneId } });
  await prisma.energyToken.deleteMany({ where: { zoneId } });
  await prisma.wallet.deleteMany({ where: { zoneId } });

  campaignId = (
    await prisma.campaign.create({
      data: {
        operatorId,
        zoneId,
        name: "5 % back on tokens",
        trigger: "TOKEN_PAYMENT",
        giftKwh: new Prisma.Decimal(0),
        cashbackPct: new Prisma.Decimal(5),
        oncePerClient: false,
        validityDays: 30,
        budgetKwh: new Prisma.Decimal(100),
        status: "ACTIVE",
      },
    })
  ).id;
});

describe("cashback on a token payment — US-12", () => {
  it("gives back the campaign's share of what the balance paid", async () => {
    await fund(driverUserId, 20);

    const result = await chargeSession({
      userId: driverUserId,
      zoneId,
      pointId,
      requestedKwh: 20,
      idempotencyKey: "cashback-1",
    });
    expect(result.status).toBe("CAPTURED");
    expect(result.kwhFromBalance).toBe(20);
    expect(result.cashbackKwh).toBe(1);

    const [grant] = await grants();
    expect(Number(grant.amountKwh)).toBe(1);
    expect(grant.paymentId).toBe(result.paymentId);
    expect(grant.operatorId).toBe(operatorId);
    expect(grant.status).toBe("ACTIVE");
    // The budget of §42 counts it like any other grant.
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(Number(campaign.issuedKwh)).toBe(1);
  });

  it("prints the accrual on the receipt it belongs to (§46.6)", async () => {
    await fund(driverUserId, 20);
    const result = await chargeSession({
      userId: driverUserId,
      zoneId,
      pointId,
      requestedKwh: 10,
      idempotencyKey: "cashback-2",
    });

    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: result.receiptId! } });
    expect((receipt.breakdown as Record<string, unknown>).cashbackKwh).toBe(0.5);

    const doc = await buildReceiptDocument(result.receiptId!);
    expect(doc!.cashbackKwh).toBe(0.5);
  });

  it("rewards nothing for kWh bought with money", async () => {
    await fund(driverUserId, 0, 100);
    await offer(20, 0.2);

    const result = await chargeSession({
      userId: driverUserId,
      zoneId,
      pointId,
      requestedKwh: 10,
      idempotencyKey: "cashback-3",
    });
    expect(result.kwhBought).toBe(10);
    expect(result.cashbackKwh).toBe(0);
    expect(await grants()).toHaveLength(0);
  });

  it("rewards only the token part of a mixed session", async () => {
    await fund(driverUserId, 4, 100);
    await offer(20, 0.2);

    const result = await chargeSession({
      userId: driverUserId,
      zoneId,
      pointId,
      requestedKwh: 10,
      idempotencyKey: "cashback-4",
    });
    expect(result.kwhFromBalance).toBe(4);
    expect(result.kwhBought).toBe(6);
    expect(result.cashbackKwh).toBe(0.2);
  });

  it("does not reward a gift — a bonus on a bonus is not a payment", async () => {
    await fund(driverUserId, 0);
    // The partner funds their own gift out of their own generation (§42).
    await fund(partnerUserId, 20);
    await prisma.promoGrant.create({
      data: {
        campaignId,
        userId: driverUserId,
        operatorId,
        amountKwh: new Prisma.Decimal(10),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });

    const result = await chargeSession({
      userId: driverUserId,
      zoneId,
      pointId,
      requestedKwh: 10,
      idempotencyKey: "cashback-5",
    });
    expect(result.kwhFromGift).toBe(10);
    expect(result.cashbackKwh).toBe(0);
  });

  it("accrues once for a replayed payment (§15)", async () => {
    await fund(driverUserId, 20);
    const first = await chargeSession({
      userId: driverUserId,
      zoneId,
      pointId,
      requestedKwh: 10,
      idempotencyKey: "cashback-6",
    });
    const second = await chargeSession({
      userId: driverUserId,
      zoneId,
      pointId,
      requestedKwh: 10,
      idempotencyKey: "cashback-6",
    });

    expect(second.paymentId).toBe(first.paymentId);
    expect(second.cashbackKwh).toBe(0.5);
    expect(await grants()).toHaveLength(1);
  });

  it("repeats with every charge, unlike a gift", async () => {
    await fund(driverUserId, 20);
    // The second session spends the first session's cashback before the
    // balance (§43), and that energy comes out of the partner's wallet.
    await fund(partnerUserId, 20);
    await chargeSession({
      userId: driverUserId,
      zoneId,
      pointId,
      requestedKwh: 10,
      idempotencyKey: "cashback-7a",
    });
    await chargeSession({
      userId: driverUserId,
      zoneId,
      pointId,
      requestedKwh: 10,
      idempotencyKey: "cashback-7b",
    });
    expect(await grants()).toHaveLength(2);
  });

  it("stops at the budget and says why (§42)", async () => {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { budgetKwh: new Prisma.Decimal(0.4) },
    });
    await fund(driverUserId, 20);

    const result = await chargeSession({
      userId: driverUserId,
      zoneId,
      pointId,
      requestedKwh: 10,
      idempotencyKey: "cashback-8",
    });
    // 0.5 kWh does not fit into 0.4 — nothing is promised at all.
    expect(result.cashbackKwh).toBe(0);
    expect(await grants()).toHaveLength(0);
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(campaign.status).toBe("EXHAUSTED");
  });

  it("ignores a campaign of another network and one that is not running", async () => {
    await prisma.campaign.update({ where: { id: campaignId }, data: { status: "PAUSED" } });
    await fund(driverUserId, 20);

    const result = await chargeSession({
      userId: driverUserId,
      zoneId,
      pointId,
      requestedKwh: 10,
      idempotencyKey: "cashback-9",
    });
    expect(result.cashbackKwh).toBe(0);
  });

  it("rewards nothing for a charge outside anybody's network", async () => {
    await fund(driverUserId, 20);
    const result = await chargeSession({
      userId: driverUserId,
      zoneId,
      requestedKwh: 10,
      idempotencyKey: "cashback-10",
    });
    expect(result.cashbackKwh).toBe(0);
    expect(await grants()).toHaveLength(0);
  });

  it("two simultaneous charges cannot overspend the budget", async () => {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { budgetKwh: new Prisma.Decimal(0.7) },
    });
    await fund(driverUserId, 40);

    const results = await Promise.allSettled([
      chargeSession({
        userId: driverUserId,
        zoneId,
        pointId,
        requestedKwh: 10,
        idempotencyKey: "cashback-11a",
      }),
      chargeSession({
        userId: driverUserId,
        zoneId,
        pointId,
        requestedKwh: 10,
        idempotencyKey: "cashback-11b",
      }),
    ]);
    for (const r of results) expect(r.status).toBe("fulfilled");

    const issued = (await grants()).reduce((sum, g) => sum + Number(g.amountKwh), 0);
    expect(issued).toBeLessThanOrEqual(0.7);
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(Number(campaign.issuedKwh)).toBe(issued);
  });
});
