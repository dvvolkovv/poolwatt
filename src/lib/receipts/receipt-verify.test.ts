// §46 item 8 — the open page behind the QR code. What it proves, and what it
// must never hand to a stranger who found the paper.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, PaymentStatus, PointStatus, PointType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOrCreateWallet } from "@/lib/exchange/wallet-service";
import { receiptStamp } from "./receipt-number";
import { verifyReceipt } from "./receipt-verify";

const PREFIX = "test_verify_";
const SLUG = `${PREFIX}net`;
const ZONE = "TESTVERIFY";

let zoneId: string;
let userId: string;
let pointId: string;
let code: string;
let receiptId: string;

async function wipe() {
  await prisma.receipt.deleteMany({ where: { payment: { zone: { code: ZONE } } } });
  await prisma.payment.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await wipe();
  userId = (await prisma.user.create({ data: { username: `${PREFIX}d`, passwordHash: "x" } })).id;
  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE, name: "Verify", country: "SK", currency: "EUR" },
    })
  ).id;
  const operator = await prisma.chargerOperator.create({
    data: { slug: SLUG, displayName: "Verify network" },
  });
  pointId = (
    await prisma.acceptancePoint.create({
      data: {
        operatorId: operator.id,
        type: PointType.CHARGING_STATION,
        name: "Verify point",
        status: PointStatus.PUBLISHED,
        paymentMethods: [],
        amenities: [],
      },
    })
  ).id;
  const wallet = await getOrCreateWallet(userId, zoneId);
  const payment = await prisma.payment.create({
    data: {
      walletId: wallet.id,
      zoneId,
      pointId,
      requestedKwh: new Prisma.Decimal(10),
      kwhFromBalance: new Prisma.Decimal(10),
      amountFiat: new Prisma.Decimal(4.2),
      status: PaymentStatus.CAPTURED,
    },
  });
  const stamp = await receiptStamp(prisma, new Date("2026-03-04T10:00:00Z"));
  code = stamp.verifyCode;
  receiptId = (
    await prisma.receipt.create({
      data: {
        ...stamp,
        paymentId: payment.id,
        burnedTokenIds: ["tok_secret"],
        totalKwh: new Prisma.Decimal(10),
        totalFiat: new Prisma.Decimal(4.2),
        currency: "EUR",
        breakdown: { kind: "charge" } as Prisma.InputJsonValue,
      },
    })
  ).id;
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe("verifyReceipt", () => {
  it("confirms a real receipt by its code", async () => {
    const proof = await verifyReceipt(code);
    expect(proof).toMatchObject({
      kind: "charge",
      totalKwh: 10,
      totalFiat: 4.2,
      currency: "EUR",
      pointName: "Verify point",
      networkName: "Verify network",
    });
    expect(proof!.number).toMatch(/^PW-2026-\d{6}$/);
  });

  it("tells a stranger nothing about who charged", async () => {
    const proof = await verifyReceipt(code);
    const json = JSON.stringify(proof);
    expect(json).not.toContain(userId);
    expect(json).not.toContain("tok_secret");
    expect(json).not.toContain(receiptId);
  });

  it("knows nothing about a code that was never issued", async () => {
    expect(await verifyReceipt("0".repeat(32))).toBeNull();
  });

  it("refuses a code that is not a code, without touching the database", async () => {
    expect(await verifyReceipt("' OR 1=1 --")).toBeNull();
    expect(await verifyReceipt("")).toBeNull();
    expect(await verifyReceipt(code.toUpperCase())).toBeNull();
  });
});
