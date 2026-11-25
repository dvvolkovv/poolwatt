// Which point a charging session happened at — ТЗ §46 ("Пункт, разъём, дата и
// время начала и конца зарядки") and the ground §45's gifts stand on.
//
// `Payment` has carried `pointId` since the receipts block, but nothing filled
// it: a real session arrived with a free-form `chargePointId` string and
// nothing else, so the receipt printed without the network's brand and
// "первая зарядка в моей сети" was not a question the data could answer.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PaymentError, chargeSession } from "./payment-service";
import { getOrCreateWallet } from "./wallet-service";
import { buildReceiptDocument } from "@/lib/receipts/receipt-document";

const PREFIX = "test_chgpt_";
const ZONE_CODE = "TESTCHGPT";

let zoneId: string;
let driverUserId: string;
let operatorId: string;
let pointId: string;
let connectorId: string;
let foreignPointId: string;

async function wipe() {
  await prisma.receipt.deleteMany({ where: { payment: { zone: { code: ZONE_CODE } } } });
  await prisma.payment.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.operatorAccounting.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.asset.deleteMany({ where: { company: { regNumber: `${PREFIX}reg` } } });
  await prisma.company.deleteMany({ where: { regNumber: `${PREFIX}reg` } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE_CODE } });
}

/** Tokens on the driver's balance, so a session needs no order book at all. */
async function giveKwh(amount: number) {
  const wallet = await getOrCreateWallet(driverUserId, zoneId);
  const asset = await prisma.asset.findFirstOrThrow({
    where: { company: { regNumber: `${PREFIX}reg` } },
  });
  await prisma.energyToken.create({
    data: {
      zoneId,
      assetId: asset.id,
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

beforeAll(async () => {
  await wipe();

  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE_CODE, country: "SK", name: "Charge point test zone", currency: "EUR" },
    })
  ).id;

  driverUserId = (
    await prisma.user.upsert({
      where: { username: `${PREFIX}driver` },
      update: {},
      create: { username: `${PREFIX}driver`, passwordHash: "x" },
    })
  ).id;

  const company = await prisma.company.create({
    data: {
      legalName: "Charge point test producer",
      country: "SK",
      regNumber: `${PREFIX}reg`,
      type: "PRODUCER",
      kybStatus: "APPROVED",
    },
  });
  await prisma.asset.create({
    data: {
      companyId: company.id,
      gridZoneId: zoneId,
      kind: "SOLAR",
      name: "Charge point test roof",
      capacityKw: new Prisma.Decimal(10),
      status: "ACTIVE",
    },
  });

  operatorId = (
    await prisma.chargerOperator.create({
      data: { slug: `${PREFIX}net`, displayName: "Charge point test network" },
    })
  ).id;
  await prisma.operatorAccounting.create({
    data: { operatorId, legalName: "Charge point test network s.r.o." },
  });

  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId,
      type: "CHARGING_STATION",
      name: "Depot A",
      status: "PUBLISHED",
      country: "SK",
      city: "Košice",
      addressLine: "Hlavná 3",
      gridZoneId: zoneId,
      connectors: {
        create: [{ type: "CCS2", powerKw: new Prisma.Decimal(150), quantity: 1 }],
      },
    },
    include: { connectors: true },
  });
  pointId = point.id;
  connectorId = point.connectors[0]!.id;

  const foreign = await prisma.chargerOperator.create({
    data: { slug: `${PREFIX}other`, displayName: "Somebody else" },
  });
  foreignPointId = (
    await prisma.acceptancePoint.create({
      data: { operatorId: foreign.id, type: "CHARGING_STATION", name: "Theirs" },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.receipt.deleteMany({ where: { payment: { zoneId } } });
  await prisma.payment.deleteMany({ where: { zoneId } });
  await prisma.energyToken.deleteMany({ where: { zoneId } });
  await prisma.wallet.deleteMany({ where: { zoneId } });
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("chargeSession — the session remembers where it happened", () => {
  it("writes the point, the connector and the window onto the payment", async () => {
    await giveKwh(10);
    const startedAt = new Date("2026-11-25T08:00:00.000Z");
    const endedAt = new Date("2026-11-25T08:40:00.000Z");

    const result = await chargeSession({
      userId: driverUserId,
      zoneId,
      requestedKwh: 10,
      pointId,
      connectorId,
      startedAt,
      endedAt,
    });

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: result.paymentId } });
    expect(payment.pointId).toBe(pointId);
    expect(payment.connectorId).toBe(connectorId);
    expect(payment.startedAt?.toISOString()).toBe(startedAt.toISOString());
    expect(payment.endedAt?.toISOString()).toBe(endedAt.toISOString());
  });

  it("makes the §46 receipt name the network and the point", async () => {
    await giveKwh(10);
    const result = await chargeSession({
      userId: driverUserId,
      zoneId,
      requestedKwh: 10,
      pointId,
      connectorId,
    });

    const doc = await buildReceiptDocument(result.receiptId!);
    expect(doc?.network?.displayName).toBe("Charge point test network");
    expect(doc?.network?.legalName).toBe("Charge point test network s.r.o.");
    expect(doc?.session?.pointName).toBe("Depot A");
    expect(doc?.session?.connector).toContain("CCS2");
  });

  it("still charges without a point — a session somewhere else is not a sin", async () => {
    await giveKwh(5);
    const result = await chargeSession({ userId: driverUserId, zoneId, requestedKwh: 5 });

    expect(result.status).toBe("CAPTURED");
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: result.paymentId } });
    expect(payment.pointId).toBeNull();
  });

  it("refuses a point that is not in our database", async () => {
    await giveKwh(5);
    await expect(
      chargeSession({ userId: driverUserId, zoneId, requestedKwh: 5, pointId: "no-such-point" }),
    ).rejects.toThrow(PaymentError);
  });

  it("refuses a connector that belongs to a different point", async () => {
    await giveKwh(5);
    await expect(
      chargeSession({
        userId: driverUserId,
        zoneId,
        requestedKwh: 5,
        pointId: foreignPointId,
        connectorId,
      }),
    ).rejects.toThrow(/connector/i);
  });

  it("refuses a session that ends before it starts", async () => {
    await giveKwh(5);
    await expect(
      chargeSession({
        userId: driverUserId,
        zoneId,
        requestedKwh: 5,
        pointId,
        startedAt: new Date("2026-11-25T09:00:00.000Z"),
        endedAt: new Date("2026-11-25T08:00:00.000Z"),
      }),
    ).rejects.toThrow(PaymentError);
  });

  it("keeps the point on a replay of the same idempotency key", async () => {
    await giveKwh(10);
    const key = `${PREFIX}replay-1`;
    const first = await chargeSession({
      userId: driverUserId,
      zoneId,
      requestedKwh: 5,
      pointId,
      idempotencyKey: key,
    });
    const replay = await chargeSession({
      userId: driverUserId,
      zoneId,
      requestedKwh: 5,
      pointId,
      idempotencyKey: key,
    });

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.paymentId).toBe(first.paymentId);
  });
});
