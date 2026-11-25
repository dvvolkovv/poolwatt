// §54 — "новые сделки идут по новой версии, текущие брони и заявки — по
// старой". A printed receipt is the strongest case of that rule: before this,
// `buildReceiptDocument` read the point's live `PointTariff` rows, so a
// partner who corrected a price rewrote the price per kWh on every receipt
// their network had ever issued.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { chargeSession } from "@/lib/exchange/payment-service";
import { savePointStep } from "@/lib/points/point-service";
import { buildReceiptDocument } from "@/lib/receipts/receipt-document";
import { currentPricing } from "./pricing-service";

const PREFIX = "test_rcptver_";
const ZONE_CODE = "TESTRCPTVER";

let zoneId: string;
let operatorId: string;
let ownerUserId: string;
let driverUserId: string;
let pointId: string;
let assetId: string;

async function wipe() {
  await prisma.receipt.deleteMany({ where: { payment: { zone: { code: ZONE_CODE } } } });
  await prisma.payment.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.pricingRule.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
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

async function fund(amount: number) {
  const wallet = await prisma.wallet.upsert({
    where: { ownerUserId_zoneId: { ownerUserId: driverUserId, zoneId } },
    update: {},
    create: { ownerUserId: driverUserId, zoneId },
  });
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
}

async function setTariff(priceFiat: number, priceTokens: number) {
  await savePointStep(pointId, ownerUserId, "tariffs", {
    tariffs: [
      { fromMinute: 0, toMinute: 1440, priceFiat, currency: "EUR", priceTokens },
    ],
  });
}

beforeAll(async () => {
  await wipe();

  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE_CODE, country: "SK", name: "Receipt version zone", currency: "EUR" },
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
  ownerUserId = await user("owner");
  driverUserId = await user("driver");

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: `${PREFIX}net`,
        displayName: "Receipt version network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  pointId = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "A", gridZoneId: zoneId },
    })
  ).id;

  const company = await prisma.company.create({
    data: {
      legalName: "Receipt version producer",
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
        name: "Receipt version roof",
        capacityKw: new Prisma.Decimal(10),
        status: "ACTIVE",
      },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.receipt.deleteMany({ where: { payment: { zoneId } } });
  await prisma.payment.deleteMany({ where: { zoneId } });
  await prisma.pricingRule.deleteMany({ where: { operatorId } });
  await prisma.pointTariff.deleteMany({ where: { pointId } });
  await prisma.energyToken.deleteMany({ where: { zoneId } });
  await prisma.wallet.deleteMany({ where: { zoneId } });
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("a charge is stamped with the tariff version it was priced under", () => {
  it("records the version on the payment", async () => {
    await setTariff(0.42, 1.05);
    await fund(10);

    const result = await chargeSession({
      userId: driverUserId,
      zoneId,
      requestedKwh: 10,
      pointId,
    });

    const version = (await currentPricing("POINT_TARIFF", pointId))!.version;
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: result.paymentId } });
    expect(payment.tariffVersion).toBe(version);
  });

  it("stamps nothing when the point has no tariff at all", async () => {
    await fund(10);
    const result = await chargeSession({
      userId: driverUserId,
      zoneId,
      requestedKwh: 5,
      pointId,
    });

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: result.paymentId } });
    expect(payment.tariffVersion).toBeNull();
  });
});

describe("§54 — an issued receipt keeps the price it was issued at", () => {
  it("does not change when the partner raises the price afterwards", async () => {
    await setTariff(0.42, 1.05);
    await fund(20);

    const before = await chargeSession({
      userId: driverUserId,
      zoneId,
      requestedKwh: 5,
      pointId,
    });
    const asIssued = await buildReceiptDocument(before.receiptId!);
    expect(asIssued?.pricePerKwhTokens).toBe(1.05);

    // The partner doubles the token price.
    await setTariff(0.9, 2.1);

    const stillTheSame = await buildReceiptDocument(before.receiptId!);
    expect(stillTheSame?.pricePerKwhTokens).toBe(1.05);
  });

  it("prices a new session under the new version", async () => {
    await setTariff(0.42, 1.05);
    await fund(20);
    await setTariff(0.9, 2.1);

    const after = await chargeSession({
      userId: driverUserId,
      zoneId,
      requestedKwh: 5,
      pointId,
    });
    const doc = await buildReceiptDocument(after.receiptId!);
    expect(doc?.pricePerKwhTokens).toBe(2.1);
  });

  it("falls back to the live rows for a payment stamped before versions existed", async () => {
    await setTariff(0.42, 1.05);
    await fund(10);
    const result = await chargeSession({
      userId: driverUserId,
      zoneId,
      requestedKwh: 5,
      pointId,
    });
    // An old row, as the database held them before this change.
    await prisma.payment.update({
      where: { id: result.paymentId },
      data: { tariffVersion: null },
    });

    const doc = await buildReceiptDocument(result.receiptId!);
    expect(doc?.pricePerKwhTokens).toBe(1.05);
  });

  it("uses the window that covered the session, not whichever is first", async () => {
    // A night window and a day window, as §52 allows.
    await savePointStep(pointId, ownerUserId, "tariffs", {
      tariffs: [
        { fromMinute: 0, toMinute: 420, priceFiat: 0.2, currency: "EUR", priceTokens: 0.9 },
        { fromMinute: 420, toMinute: 1440, priceFiat: 0.5, currency: "EUR", priceTokens: 1.4 },
      ],
    });
    await fund(20);

    const night = await chargeSession({
      userId: driverUserId,
      zoneId,
      requestedKwh: 5,
      pointId,
      startedAt: new Date("2026-11-25T03:00:00.000Z"),
      endedAt: new Date("2026-11-25T03:30:00.000Z"),
    });
    expect((await buildReceiptDocument(night.receiptId!))?.pricePerKwhTokens).toBe(0.9);

    const day = await chargeSession({
      userId: driverUserId,
      zoneId,
      requestedKwh: 5,
      pointId,
      startedAt: new Date("2026-11-25T13:00:00.000Z"),
      endedAt: new Date("2026-11-25T13:30:00.000Z"),
    });
    expect((await buildReceiptDocument(day.receiptId!))?.pricePerKwhTokens).toBe(1.4);
  });

  it("keeps printing the old price even after the point's tariff rows are gone", async () => {
    await setTariff(0.42, 1.05);
    await fund(10);
    const result = await chargeSession({
      userId: driverUserId,
      zoneId,
      requestedKwh: 5,
      pointId,
    });

    // The partner removes the tariff entirely.
    await savePointStep(pointId, ownerUserId, "tariffs", { tariffs: [] });

    const doc = await buildReceiptDocument(result.receiptId!);
    expect(doc?.pricePerKwhTokens).toBe(1.05);
  });
});
