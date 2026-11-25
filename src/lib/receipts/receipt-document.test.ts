// The receipt as §46 describes it — the document, not the database row.
//
// Every item of "Состав чека" is a case here: the network's own logo and
// requisites, the point and connector, the window, the volume and where the
// energy came from, price in money and in tokens, the booking fee and its
// credit, the split of the payment, VAT, and the address behind the QR code.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, AssetKind, AssetStatus, EnergyTokenStatus, EvConnectorType, PointStatus, PointType, PaymentStatus, CompanyType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOrCreateWallet } from "@/lib/exchange/wallet-service";
import { receiptStamp } from "./receipt-number";
import { buildReceiptDocument } from "./receipt-document";

const PREFIX = "test_rcpt_";
const SLUG = `${PREFIX}net`;
const ZONE = "TESTRCPT";

let operatorId: string;
let pointId: string;
let connectorId: string;
let zoneId: string;
let userId: string;
let walletId: string;
let companyId: string;
let assetId: string;

async function wipe() {
  await prisma.receipt.deleteMany({ where: { payment: { zone: { code: ZONE } } } });
  await prisma.receipt.deleteMany({
    where: { reservation: { point: { operator: { slug: SLUG } } } },
  });
  await prisma.payment.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.reservation.deleteMany({ where: { point: { operator: { slug: SLUG } } } });
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.asset.deleteMany({ where: { company: { legalName: { startsWith: PREFIX } } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.operatorAccounting.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await wipe();

  userId = (await prisma.user.create({ data: { username: `${PREFIX}driver`, passwordHash: "x" } })).id;
  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE, name: "Receipt zone", country: "SK", currency: "EUR"},
    })
  ).id;
  operatorId = (
    await prisma.chargerOperator.create({
      data: { slug: SLUG, displayName: "Zelená sieť", logoUrl: "https://example.test/logo.png" },
    })
  ).id;
  await prisma.operatorAccounting.create({
    data: {
      operatorId,
      legalName: "Zelená sieť s.r.o.",
      regNumber: "12345678",
      vatNumber: "SK2020123456",
      addressLine: "Hlavná 1",
      city: "Košice",
      country: "SK",
      vatRatePct: new Prisma.Decimal(20),
    },
  });
  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId,
      type: PointType.CHARGING_STATION,
      name: "Košice — Hlavná",
      status: PointStatus.PUBLISHED,
      country: "SK",
      city: "Košice",
      addressLine: "Hlavná 1",
      gridZoneId: zoneId,
      paymentMethods: [],
      amenities: [],
      logoUrl: "https://example.test/point.png",
    },
  });
  pointId = point.id;
  connectorId = (
    await prisma.pointConnector.create({
      data: { pointId, type: EvConnectorType.CCS2, powerKw: new Prisma.Decimal(150), quantity: 1 },
    })
  ).id;
  await prisma.pointTariff.create({
    data: { pointId, priceFiat: new Prisma.Decimal(0.42), priceTokens: new Prisma.Decimal(1.05), currency: "EUR" },
  });

  companyId = (
    await prisma.company.create({
      data: { legalName: `${PREFIX}producer`, country: "SK", regNumber: `${PREFIX}1`, type: CompanyType.PRODUCER },
    })
  ).id;
  assetId = (
    await prisma.asset.create({
      data: {
        companyId,
        kind: AssetKind.SOLAR,
        name: "Roof",
        capacityKw: new Prisma.Decimal(10),
        gridZoneId: zoneId,
        status: AssetStatus.ACTIVE,
      },
    })
  ).id;

  walletId = (await getOrCreateWallet(userId, zoneId)).id;
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

async function burnedBatch(amountKwh: number, kind: AssetKind = AssetKind.SOLAR) {
  const asset =
    kind === AssetKind.SOLAR
      ? { id: assetId }
      : await prisma.asset.create({
          data: {
            companyId,
            kind,
            name: `Asset ${kind}`,
            capacityKw: new Prisma.Decimal(5),
            gridZoneId: zoneId,
            status: AssetStatus.ACTIVE,
          },
        });
  return prisma.energyToken.create({
    data: {
      assetId: asset.id,
      zoneId,
      intervalStart: new Date("2026-03-04T08:00:00Z"),
      amountKwh: new Prisma.Decimal(amountKwh),
      status: EnergyTokenStatus.BURNED,
      burnedAt: new Date("2026-03-04T10:00:00Z"),
    },
  });
}

async function chargeReceipt(
  overrides: Partial<Prisma.ReceiptUncheckedCreateInput> = {},
  paymentOverrides: Partial<Prisma.PaymentUncheckedCreateInput> = {},
  breakdown: Record<string, unknown> = {},
) {
  const payment = await prisma.payment.create({
    data: {
      walletId,
      zoneId,
      pointId,
      connectorId,
      startedAt: new Date("2026-03-04T09:30:00Z"),
      endedAt: new Date("2026-03-04T10:00:00Z"),
      requestedKwh: new Prisma.Decimal(20),
      kwhFromBalance: new Prisma.Decimal(8),
      kwhBought: new Prisma.Decimal(12),
      amountFiat: new Prisma.Decimal(5.04),
      status: PaymentStatus.CAPTURED,
      capturedAt: new Date("2026-03-04T10:00:00Z"),
      ...paymentOverrides,
    },
  });
  const token = await burnedBatch(8);
  return prisma.receipt.create({
    data: {
      ...(await receiptStamp(prisma, new Date("2026-03-04T10:00:00Z"))),
      paymentId: payment.id,
      burnedTokenIds: [token.id],
      totalKwh: new Prisma.Decimal(20),
      totalFiat: new Prisma.Decimal(5.04),
      currency: "EUR",
      breakdown: {
        kind: "charge",
        zone: ZONE,
        requestedKwh: 20,
        kwhFromBalance: 8,
        kwhBought: 12,
        energyCost: 5.04,
        ...breakdown,
      } as Prisma.InputJsonValue,
      ...overrides,
    },
  });
}

describe("buildReceiptDocument — §46 состав чека", () => {
  it("prints the network's logo and requisites, not only Poolwatt's", async () => {
    const receipt = await chargeReceipt();
    const doc = await buildReceiptDocument(receipt.id);
    expect(doc).not.toBeNull();
    expect(doc!.network).toMatchObject({
      displayName: "Zelená sieť",
      logoUrl: "https://example.test/point.png",
      legalName: "Zelená sieť s.r.o.",
      regNumber: "12345678",
      vatNumber: "SK2020123456",
    });
    expect(doc!.network!.address).toContain("Košice");
  });

  it("names the point, the connector and the window of the session", async () => {
    const receipt = await chargeReceipt();
    const doc = await buildReceiptDocument(receipt.id);
    expect(doc!.session).toMatchObject({
      pointName: "Košice — Hlavná",
      connector: "CCS2 · 150 kW",
    });
    expect(doc!.session!.startedAt?.toISOString()).toBe("2026-03-04T09:30:00.000Z");
    expect(doc!.session!.endedAt?.toISOString()).toBe("2026-03-04T10:00:00.000Z");
  });

  it("takes the energy source from the batches that were burned", async () => {
    const receipt = await chargeReceipt();
    const doc = await buildReceiptDocument(receipt.id);
    expect(doc!.energySources).toEqual(["SOLAR"]);
  });

  it("calls a mix a mix when batches came from different kinds of asset", async () => {
    const payment = await prisma.payment.create({
      data: {
        walletId,
        zoneId,
        pointId,
        requestedKwh: new Prisma.Decimal(4),
        kwhFromBalance: new Prisma.Decimal(4),
        amountFiat: new Prisma.Decimal(0),
        status: PaymentStatus.CAPTURED,
      },
    });
    const sun = await burnedBatch(2);
    const wind = await burnedBatch(2, AssetKind.WIND);
    const receipt = await prisma.receipt.create({
      data: {
        ...(await receiptStamp(prisma)),
        paymentId: payment.id,
        burnedTokenIds: [sun.id, wind.id],
        totalKwh: new Prisma.Decimal(4),
        totalFiat: new Prisma.Decimal(0),
        currency: "EUR",
        breakdown: { kind: "charge", kwhFromBalance: 4 } as Prisma.InputJsonValue,
      },
    });
    const doc = await buildReceiptDocument(receipt.id);
    expect(doc!.energySources.sort()).toEqual(["SOLAR", "WIND"]);
  });

  it("gives the price in money and in tokens", async () => {
    const receipt = await chargeReceipt();
    const doc = await buildReceiptDocument(receipt.id);
    // 5.04 EUR for 12 bought kWh.
    expect(doc!.pricePerKwhFiat).toBeCloseTo(0.42, 4);
    // The point's tariff says 1.05 tokens per kWh.
    expect(doc!.pricePerKwhTokens).toBeCloseTo(1.05, 4);
  });

  it("splits the payment into balance, gift and card", async () => {
    const receipt = await chargeReceipt();
    const doc = await buildReceiptDocument(receipt.id);
    expect(doc!.payment).toMatchObject({
      fromBalanceKwh: 8,
      fromGiftKwh: 0,
      boughtKwh: 12,
      boughtFiat: 5.04,
    });
  });

  it("shows the booking fee and its credit when the session had a booking", async () => {
    const receipt = await chargeReceipt({}, {}, { reservationFee: 2, reservationCredit: 2 });
    const doc = await buildReceiptDocument(receipt.id);
    expect(doc!.reservationFee).toBe(2);
    expect(doc!.reservationCredit).toBe(2);
  });

  it("extracts VAT at the partner's rate", async () => {
    const receipt = await chargeReceipt();
    const doc = await buildReceiptDocument(receipt.id);
    expect(doc!.vat).toMatchObject({ ratePct: 20, gross: 5.04 });
    expect(doc!.vat!.net + doc!.vat!.amount).toBeCloseTo(5.04, 10);
  });

  it("says the rate was not stated instead of inventing one", async () => {
    await prisma.operatorAccounting.update({
      where: { operatorId },
      data: { vatRatePct: null },
    });
    const receipt = await chargeReceipt();
    const doc = await buildReceiptDocument(receipt.id);
    expect(doc!.vat).toBeNull();
    await prisma.operatorAccounting.update({
      where: { operatorId },
      data: { vatRatePct: new Prisma.Decimal(20) },
    });
  });

  it("carries the address behind the QR code", async () => {
    const receipt = await chargeReceipt();
    const doc = await buildReceiptDocument(receipt.id);
    expect(doc!.verifyUrl).toContain(`/r/${receipt.verifyCode}`);
  });

  it("issues a receipt for a charge at somebody else's point, without branding", async () => {
    const receipt = await chargeReceipt({}, { pointId: null, connectorId: null });
    const doc = await buildReceiptDocument(receipt.id);
    expect(doc!.network).toBeNull();
    expect(doc!.session?.pointName ?? null).toBeNull();
    expect(doc!.totalKwh).toBe(20);
  });

  it("is null for a receipt that does not exist", async () => {
    expect(await buildReceiptDocument("nope")).toBeNull();
  });

  it("describes a no-show as what it is: a penalty, no kWh", async () => {
    const wallet = await getOrCreateWallet(userId, zoneId);
    const reservation = await prisma.reservation.create({
      data: {
        userId,
        pointId,
        connectorId,
        walletId: wallet.id,
        eta: new Date("2026-03-05T09:00:00Z"),
        windowStart: new Date("2026-03-05T08:45:00Z"),
        windowEnd: new Date("2026-03-05T09:15:00Z"),
        feeFiat: new Prisma.Decimal(1),
        guaranteeFiat: new Prisma.Decimal(5),
        noShowPenaltyFiat: new Prisma.Decimal(3),
        freeCancelMinutes: 30,
        status: "NO_SHOW",
      },
    });
    const receipt = await prisma.receipt.create({
      data: {
        ...(await receiptStamp(prisma)),
        reservationId: reservation.id,
        burnedTokenIds: [],
        totalKwh: new Prisma.Decimal(0),
        totalFiat: new Prisma.Decimal(3),
        currency: "EUR",
        breakdown: { kind: "reservation.no_show", fee: 1, guarantee: 5, penalty: 3 } as Prisma.InputJsonValue,
      },
    });
    const doc = await buildReceiptDocument(receipt.id);
    expect(doc!.kind).toBe("reservation.no_show");
    expect(doc!.totalKwh).toBe(0);
    expect(doc!.totalFiat).toBe(3);
    expect(doc!.network?.displayName).toBe("Zelená sieť");
    expect(doc!.session?.pointName).toBe("Košice — Hlavná");
  });
});
