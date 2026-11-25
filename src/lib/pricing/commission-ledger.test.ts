// §54 — "Расчёт комиссий и выплат автоматический, с отражением в облачной
// бухгалтерии обеих сторон." Before this the §46 export showed the partner's
// revenue and nothing about what the platform or a head network took out of
// it, so neither side's books could be reconciled against the other's.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readLedger } from "@/lib/accounting/ledger";
import { renderCsv } from "@/lib/accounting/export";
import { saveSubpartnerAgreement } from "./subpartner-service";

const PREFIX = "test_commled_";
const ZONE_CODE = "TESTCOMMLED";

let zoneId: string;
let headId: string;
let subId: string;
let headOwnerId: string;
let subPointId: string;
let walletId: string;

const FROM = new Date(Date.UTC(2026, 4, 1));
const TO = new Date(Date.UTC(2026, 5, 1));
const AT = new Date(Date.UTC(2026, 4, 10, 12));

async function wipe() {
  await prisma.receipt.deleteMany({ where: { payment: { zone: { code: ZONE_CODE } } } });
  await prisma.payment.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.subpartnerAgreement.deleteMany({
    where: { head: { slug: { startsWith: PREFIX } } },
  });
  await prisma.pricingRule.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.order.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.asset.deleteMany({ where: { company: { regNumber: { startsWith: PREFIX } } } });
  await prisma.company.deleteMany({ where: { regNumber: { startsWith: PREFIX } } });
  await prisma.operatorAccounting.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE_CODE } });
}

/** A captured charge with the commissions the engine recorded on it. */
async function charge(args: { gross: number; platformFee: number; subpartnerFee: number }) {
  const payment = await prisma.payment.create({
    data: {
      walletId,
      zoneId,
      pointId: subPointId,
      requestedKwh: new Prisma.Decimal(10),
      kwhBought: new Prisma.Decimal(10),
      amountFiat: new Prisma.Decimal(args.gross),
      status: "CAPTURED",
      capturedAt: AT,
      startedAt: AT,
      endedAt: AT,
    },
  });
  return prisma.receipt.create({
    data: {
      paymentId: payment.id,
      number: `PW-2026-${Math.floor(Math.random() * 900000 + 100000)}`,
      issuedAt: AT,
      totalKwh: new Prisma.Decimal(10),
      totalFiat: new Prisma.Decimal(args.gross),
      currency: "EUR",
      breakdown: {
        kind: "charge",
        energyCost: args.gross,
        platformFee: args.platformFee,
        subpartnerFee: args.subpartnerFee,
        subpartnerHeadId: args.subpartnerFee > 0 ? headId : null,
      },
    },
  });
}

beforeAll(async () => {
  await wipe();

  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE_CODE, country: "SK", name: "Commission ledger zone", currency: "EUR" },
    })
  ).id;

  headOwnerId = (
    await prisma.user.upsert({
      where: { username: `${PREFIX}head` },
      update: {},
      create: { username: `${PREFIX}head`, passwordHash: "x" },
    })
  ).id;

  headId = (
    await prisma.chargerOperator.create({
      data: {
        slug: `${PREFIX}head`,
        displayName: "Commission head network",
        claimedById: headOwnerId,
        claimedAt: new Date(),
      },
    })
  ).id;
  subId = (
    await prisma.chargerOperator.create({
      data: { slug: `${PREFIX}sub`, displayName: "Commission franchisee" },
    })
  ).id;
  await prisma.operatorAccounting.create({
    data: {
      operatorId: subId,
      legalName: "Commission franchisee s.r.o.",
      vatRatePct: new Prisma.Decimal(20),
      revenueAccount: "8400",
      counterAccount: "1200",
    },
  });

  subPointId = (
    await prisma.acceptancePoint.create({
      data: { operatorId: subId, type: "CHARGING_STATION", name: "Franchisee point" },
    })
  ).id;

  walletId = (
    await prisma.wallet.create({ data: { ownerUserId: headOwnerId, zoneId } })
  ).id;
});

beforeEach(async () => {
  await prisma.receipt.deleteMany({ where: { payment: { zoneId } } });
  await prisma.payment.deleteMany({ where: { zoneId } });
  await prisma.subpartnerAgreement.deleteMany({ where: { headId } });
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("the §46 ledger carries both commissions", () => {
  it("shows what the platform and the head network took on each line", async () => {
    await charge({ gross: 100, platformFee: 2, subpartnerFee: 9.8 });

    const ledger = await readLedger({ operatorId: subId, from: FROM, to: TO, pointIds: null });

    expect(ledger.lines).toHaveLength(1);
    expect(ledger.lines[0].platformFee).toBe(2);
    expect(ledger.lines[0].subpartnerFee).toBe(9.8);
    // What the franchisee actually keeps.
    expect(ledger.lines[0].partnerNet).toBe(88.2);
  });

  it("adds the commissions up over the month", async () => {
    await charge({ gross: 100, platformFee: 2, subpartnerFee: 9.8 });
    await charge({ gross: 50, platformFee: 1, subpartnerFee: 4.9 });

    const ledger = await readLedger({ operatorId: subId, from: FROM, to: TO, pointIds: null });

    expect(ledger.totals.platformFee).toBe(3);
    expect(ledger.totals.subpartnerFee).toBe(14.7);
    expect(ledger.totals.partnerNet).toBe(132.3);
    // And the three shares still add back up to what the drivers paid.
    expect(
      ledger.totals.platformFee + ledger.totals.subpartnerFee + ledger.totals.partnerNet,
    ).toBeCloseTo(ledger.totals.gross, 10);
  });

  it("shows zeroes for a session nobody took a commission on", async () => {
    await charge({ gross: 40, platformFee: 0, subpartnerFee: 0 });

    const ledger = await readLedger({ operatorId: subId, from: FROM, to: TO, pointIds: null });
    expect(ledger.lines[0].platformFee).toBe(0);
    expect(ledger.lines[0].subpartnerFee).toBe(0);
    expect(ledger.lines[0].partnerNet).toBe(40);
  });

  it("falls back to nothing taken for a receipt written before commissions were recorded", async () => {
    const payment = await prisma.payment.create({
      data: {
        walletId,
        zoneId,
        pointId: subPointId,
        requestedKwh: new Prisma.Decimal(5),
        amountFiat: new Prisma.Decimal(20),
        status: "CAPTURED",
        capturedAt: AT,
      },
    });
    await prisma.receipt.create({
      data: {
        paymentId: payment.id,
        issuedAt: AT,
        totalKwh: new Prisma.Decimal(5),
        totalFiat: new Prisma.Decimal(20),
        currency: "EUR",
        breakdown: { kind: "charge" },
      },
    });

    const ledger = await readLedger({ operatorId: subId, from: FROM, to: TO, pointIds: null });
    expect(ledger.lines[0].platformFee).toBe(0);
    expect(ledger.lines[0].partnerNet).toBe(20);
  });

  it("prints both commissions in the CSV the accountant downloads", async () => {
    await charge({ gross: 100, platformFee: 2, subpartnerFee: 9.8 });

    const ledger = await readLedger({ operatorId: subId, from: FROM, to: TO, pointIds: null });
    const csv = renderCsv(ledger);

    expect(csv).toContain("platformFee");
    expect(csv).toContain("subpartnerFee");
    expect(csv).toContain("partnerNet");
    expect(csv).toContain("9,80");
    expect(csv).toContain("88,20");
  });
});

describe("§54 — both sides see the same number", () => {
  it("gives the head network the same commission it takes from the franchisee", async () => {
    await saveSubpartnerAgreement({
      headId,
      subId,
      actorId: headOwnerId,
      chargeFeePct: 10,
    });
    await charge({ gross: 100, platformFee: 2, subpartnerFee: 9.8 });

    const franchisee = await readLedger({
      operatorId: subId,
      from: FROM,
      to: TO,
      pointIds: null,
    });
    const head = await readLedger({
      operatorId: headId,
      from: FROM,
      to: TO,
      pointIds: null,
      // §54 — the head network's books over the sessions it earns from.
      asSubpartnerHead: true,
    });

    expect(head.totals.subpartnerFee).toBe(franchisee.totals.subpartnerFee);
    expect(head.lines.map((l) => l.receiptId)).toEqual(
      franchisee.lines.map((l) => l.receiptId),
    );
  });

  it("gives the head network nothing from a network it has no agreement with", async () => {
    await charge({ gross: 100, platformFee: 2, subpartnerFee: 0 });

    const head = await readLedger({
      operatorId: headId,
      from: FROM,
      to: TO,
      pointIds: null,
      asSubpartnerHead: true,
    });
    expect(head.lines).toEqual([]);
  });
});

describe("a real charging session records its own commissions", () => {
  it("writes what the platform and the head network took onto the receipt", async () => {
    const { chargeSession } = await import("@/lib/exchange/payment-service");
    await saveSubpartnerAgreement({ headId, subId, actorId: headOwnerId, chargeFeePct: 10 });

    // A seller resting in the book, so the session has to buy. The head
    // network's owner already has the wallet this file's fixtures made.
    const sellerWallet = await prisma.wallet.findUniqueOrThrow({
      where: { ownerUserId_zoneId: { ownerUserId: headOwnerId, zoneId } },
    });
    const company = await prisma.company.create({
      data: {
        legalName: "Commission seller",
        country: "SK",
        regNumber: `${PREFIX}seller`,
        type: "PRODUCER",
        kybStatus: "APPROVED",
      },
    });
    const asset = await prisma.asset.create({
      data: {
        companyId: company.id,
        gridZoneId: zoneId,
        kind: "SOLAR",
        name: "Commission roof",
        capacityKw: new Prisma.Decimal(10),
        status: "ACTIVE",
      },
    });
    await prisma.energyToken.create({
      data: {
        zoneId,
        assetId: asset.id,
        ownerWalletId: sellerWallet.id,
        amountKwh: new Prisma.Decimal(20),
        intervalStart: new Date(),
        status: "AVAILABLE",
      },
    });
    await prisma.wallet.update({
      where: { id: sellerWallet.id },
      data: { kwhBalance: new Prisma.Decimal(20) },
    });
    await prisma.order.create({
      data: {
        walletId: sellerWallet.id,
        zoneId,
        side: "SELL",
        type: "LIMIT",
        amountKwh: new Prisma.Decimal(20),
        limitPrice: new Prisma.Decimal(1),
        status: "NEW",
      },
    });

    const driver = await prisma.user.upsert({
      where: { username: `${PREFIX}driver` },
      update: {},
      create: { username: `${PREFIX}driver`, passwordHash: "x" },
    });
    await prisma.wallet.create({
      data: { ownerUserId: driver.id, zoneId, fiatBalance: new Prisma.Decimal(100) },
    });

    const result = await chargeSession({
      userId: driver.id,
      zoneId,
      requestedKwh: 10,
      pointId: subPointId,
    });

    const receipt = await prisma.receipt.findUniqueOrThrow({
      where: { id: result.receiptId! },
    });
    const b = receipt.breakdown as Record<string, number | string | null>;

    // 10 kWh at 1.00 = 10.00, and the driver also pays the platform's own
    // 1 % commission on the purchase, so the session costs 10.10.
    expect(b.platformFee).toBe(0.1);
    expect(b.subpartnerHeadId).toBe(headId);
    // The head network's 10 % of the 10.00 left after the platform.
    expect(b.subpartnerFee).toBe(1);
    expect(b.partnerNet).toBe(9);
    expect(
      (b.platformFee as number) + (b.subpartnerFee as number) + (b.partnerNet as number),
    ).toBeCloseTo(10.1, 10);

  });
});
