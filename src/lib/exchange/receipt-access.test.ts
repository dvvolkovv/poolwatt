// US-07 — "чек в истории", ТЗ §46. The receipt is a document the buyer opens,
// so who may open it is a rule of its own: both sides of the trade, the
// operator, and nobody else.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { placeOrder } from "./order-service";
import { readReceiptForUser } from "./payment-service";
import { mintToken } from "./token-registry";
import { getOrCreateWallet } from "./wallet-service";

const PREFIX = "test_receipt_";
const ZONE_CODE = "TESTRECEIPT";

let zoneId: string;
let buyerUserId: string;
let sellerUserId: string;
let strangerUserId: string;
let adminUserId: string;
let receiptId: string;

async function seedUser(username: string, role: "USER" | "ADMIN" = "USER") {
  const user = await prisma.user.upsert({
    where: { username },
    update: { role },
    create: { username, passwordHash: "x", role },
  });
  return user.id;
}

async function wipe() {
  const zone = await prisma.gridZone.findUnique({ where: { code: ZONE_CODE } });
  if (!zone) return;
  await prisma.receipt.deleteMany({ where: { trade: { zoneId: zone.id } } });
  await prisma.trade.deleteMany({ where: { zoneId: zone.id } });
  await prisma.order.deleteMany({ where: { zoneId: zone.id } });
  await prisma.energyToken.deleteMany({ where: { zoneId: zone.id } });
  await prisma.meterReading.deleteMany({ where: { zoneId: zone.id } });
  await prisma.wallet.deleteMany({ where: { zoneId: zone.id } });
  await prisma.asset.deleteMany({ where: { gridZoneId: zone.id } });
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
  await prisma.gridZone.delete({ where: { id: zone.id } });
}

beforeAll(async () => {
  await wipe();
  const zone = await prisma.gridZone.create({
    data: {
      code: ZONE_CODE,
      country: "SK",
      name: "Receipt test zone",
      currency: "EUR",
      intervalMinutes: 60,
      corridorPct: new Prisma.Decimal(50),
      spotPrice: new Prisma.Decimal(0.2),
      spotPriceAt: new Date(),
    },
  });
  zoneId = zone.id;

  buyerUserId = await seedUser(`${PREFIX}buyer`);
  sellerUserId = await seedUser(`${PREFIX}seller`);
  strangerUserId = await seedUser(`${PREFIX}stranger`);
  adminUserId = await seedUser(`${PREFIX}admin`, "ADMIN");

  const buyerWallet = await getOrCreateWallet(buyerUserId, zoneId);
  await prisma.wallet.update({
    where: { id: buyerWallet.id },
    data: { fiatBalance: new Prisma.Decimal(100) },
  });

  // The seller needs tokens to sell. Mint them the way the platform does —
  // from a valid reading — so the nightly reconciliation (§16.11) running in
  // another test file does not see an orphan batch.
  const sellerWallet = await getOrCreateWallet(sellerUserId, zoneId);
  const company = await prisma.company.create({
    data: {
      legalName: `${PREFIX}seller s.r.o.`,
      country: "SK",
      regNumber: `${PREFIX}reg`,
      type: "PRODUCER",
      kybStatus: "APPROVED",
      ownerUserId: sellerUserId,
    },
  });
  const asset = await prisma.asset.create({
    data: {
      companyId: company.id,
      gridZoneId: zoneId,
      kind: "SOLAR",
      name: "Receipt test array",
      capacityKw: new Prisma.Decimal(10),
      status: "ACTIVE",
    },
  });
  const intervalStart = new Date(Date.now() + 3_600_000);
  const reading = await prisma.meterReading.create({
    data: {
      assetId: asset.id,
      zoneId,
      intervalStart,
      intervalEnd: new Date(intervalStart.getTime() + 3_600_000),
      energyKwh: new Prisma.Decimal(10),
      source: "rest",
      validationStatus: "VALID",
      mintedAt: new Date(),
    },
  });
  await mintToken(prisma, {
    assetId: asset.id,
    zoneId,
    intervalStart,
    amountKwh: 10,
    readingId: reading.id,
    ownerWalletId: sellerWallet.id,
  });

  await placeOrder({
    userId: sellerUserId,
    zoneId,
    side: "SELL",
    type: "LIMIT",
    amountKwh: 10,
    limitPrice: 0.2,
    idempotencyKey: `${PREFIX}ask`,
  });
  await placeOrder({
    userId: buyerUserId,
    zoneId,
    side: "BUY",
    type: "MARKET",
    amountKwh: 4,
    idempotencyKey: `${PREFIX}bid`,
  });

  const receipt = await prisma.receipt.findFirstOrThrow({
    where: { trade: { zoneId } },
    orderBy: { issuedAt: "desc" },
  });
  receiptId = receipt.id;
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("readReceiptForUser — who may open a receipt (§46)", () => {
  it("gives the buyer their receipt, with what was bought and at what price", async () => {
    const receipt = await readReceiptForUser(receiptId, buyerUserId, false);
    expect(receipt).not.toBeNull();
    expect(receipt!.totalKwh).toBe(4);
    expect(receipt!.currency).toBe("EUR");
    expect(receipt!.breakdown).toMatchObject({ kind: "trade", price: 0.2, amountKwh: 4 });
  });

  it("gives the seller the same receipt — both sides of one trade", async () => {
    expect(await readReceiptForUser(receiptId, sellerUserId, false)).not.toBeNull();
  });

  it("shows nothing to someone who was not in the trade", async () => {
    expect(await readReceiptForUser(receiptId, strangerUserId, false)).toBeNull();
  });

  it("shows it to the operator", async () => {
    expect(await readReceiptForUser(receiptId, adminUserId, true)).not.toBeNull();
  });

  it("answers nothing for a receipt that does not exist", async () => {
    expect(await readReceiptForUser("no-such-receipt", buyerUserId, false)).toBeNull();
  });
});
