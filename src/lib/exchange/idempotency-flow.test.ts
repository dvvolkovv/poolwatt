// ТЗ §15 on the two services that move energy and money through a key:
// orders and member-to-member transfers. CLAUDE.md asks for the concurrent
// case on anything that moves money or energy, so each operation is fired
// twice at once with one key and must happen once.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { placeOrder } from "./order-service";
import { transferKwh } from "./transfer-service";
import { mintToken } from "./token-registry";
import { getOrCreateWallet } from "./wallet-service";

const PREFIX = "test_idemflow_";
const ZONE_CODE = "IDEMZONE";

let zoneId: string;
let sellerId: string;
let buyerId: string;
let coopId: string;

async function seedUser(username: string) {
  const user = await prisma.user.upsert({
    where: { username },
    update: {},
    create: { username, passwordHash: "x" },
  });
  return user.id;
}

async function cleanup() {
  const zone = await prisma.gridZone.findUnique({ where: { code: ZONE_CODE } });
  if (!zone) return;
  await prisma.tokenTransfer.deleteMany({ where: { zoneId: zone.id } });
  await prisma.trade.deleteMany({ where: { zoneId: zone.id } });
  await prisma.order.deleteMany({ where: { zoneId: zone.id } });
  await prisma.energyToken.deleteMany({ where: { zoneId: zone.id } });
  await prisma.asset.deleteMany({ where: { gridZoneId: zone.id } });
  await prisma.coopMember.deleteMany({ where: { coop: { zoneId: zone.id } } });
  await prisma.cooperative.deleteMany({ where: { zoneId: zone.id } });
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
  await prisma.wallet.deleteMany({ where: { zoneId: zone.id } });
  await prisma.gridZone.delete({ where: { id: zone.id } });
}

beforeAll(async () => {
  vi.stubEnv("KWH_TRANSFERS_ENABLED", "true");
  await cleanup();

  const zone = await prisma.gridZone.create({
    data: {
      code: ZONE_CODE,
      country: "SK",
      name: "Idempotency Zone",
      currency: "EUR",
      intervalMinutes: 15,
      corridorPct: new Prisma.Decimal(50),
      spotPrice: new Prisma.Decimal(0.2),
      spotPriceAt: new Date(),
    },
  });
  zoneId = zone.id;

  sellerId = await seedUser(`${PREFIX}seller`);
  buyerId = await seedUser(`${PREFIX}buyer`);

  const coopCompany = await prisma.company.create({
    data: {
      legalName: `${PREFIX}coop_company`,
      country: "SK",
      regNumber: `${PREFIX}reg`,
      type: "COOPERATIVE",
      ownerUserId: sellerId,
    },
  });
  const coop = await prisma.cooperative.create({
    data: { name: `${PREFIX}coop`, zoneId, companyId: coopCompany.id },
  });
  coopId = coop.id;
  for (const userId of [sellerId, buyerId]) {
    const wallet = await getOrCreateWallet(userId, zoneId);
    // §24.1 — transfers need both sides KYC-verified in one cooperative.
    await prisma.coopMember.create({
      data: {
        coopId,
        userId,
        shares: 1,
        status: "ACTIVE",
        kycVerifiedAt: new Date(),
      },
    });
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { fiatBalance: new Prisma.Decimal(500) },
    });
  }

  // Give the seller kWh to sell and to transfer.
  const asset = await prisma.asset.create({
    data: {
      companyId: coopCompany.id,
      gridZoneId: zoneId,
      kind: "SOLAR",
      name: `${PREFIX}asset`,
      capacityKw: 10,
      status: "ACTIVE",
    },
  });
  const sellerWallet = await getOrCreateWallet(sellerId, zoneId);
  await mintToken(prisma, {
    assetId: asset.id,
    ownerWalletId: sellerWallet.id,
    zoneId,
    amountKwh: 200,
    intervalStart: new Date("2026-11-20T10:00:00.000Z"),
  });
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await cleanup();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("orders under one idempotency key — §15", () => {
  it("replays the first order instead of placing a second", async () => {
    const args = {
      userId: sellerId,
      zoneId,
      side: "SELL" as const,
      type: "LIMIT" as const,
      amountKwh: 5,
      limitPrice: 0.21,
      intervalStart: null,
      idempotencyKey: `${PREFIX}seq`,
    };
    const first = await placeOrder(args);
    const second = await placeOrder(args);

    expect(second.orderId).toBe(first.orderId);
    expect(second.idempotentReplay).toBe(true);
    expect(
      await prisma.order.count({ where: { zoneId, idempotencyKey: `${PREFIX}seq` } }),
    ).toBe(1);
  });

  it("places one order when two requests arrive at once", async () => {
    const args = {
      userId: sellerId,
      zoneId,
      side: "SELL" as const,
      type: "LIMIT" as const,
      amountKwh: 7,
      limitPrice: 0.22,
      intervalStart: null,
      idempotencyKey: `${PREFIX}race`,
    };
    const [a, b] = await Promise.all([placeOrder(args), placeOrder(args)]);

    expect(a.orderId).toBe(b.orderId);
    expect(a.idempotentReplay !== b.idempotentReplay).toBe(true);
    expect(
      await prisma.order.count({ where: { zoneId, idempotencyKey: `${PREFIX}race` } }),
    ).toBe(1);
  });
});

describe("transfers under one idempotency key — §15, §24", () => {
  it("replays the first transfer instead of moving the energy twice", async () => {
    const args = {
      fromUserId: sellerId,
      toUsername: `${PREFIX}buyer`,
      zoneId,
      amountKwh: 3,
      idempotencyKey: `${PREFIX}transfer_seq`,
    };
    const before = await getOrCreateWallet(buyerId, zoneId);
    const first = await transferKwh(args);
    const second = await transferKwh(args);
    const after = await getOrCreateWallet(buyerId, zoneId);

    expect(second.transferId).toBe(first.transferId);
    expect(second.idempotentReplay).toBe(true);
    expect(Number(after.kwhBalance) - Number(before.kwhBalance)).toBeCloseTo(3, 3);
  });

  it("moves the energy once when two requests arrive at once", async () => {
    const args = {
      fromUserId: sellerId,
      toUsername: `${PREFIX}buyer`,
      zoneId,
      amountKwh: 4,
      idempotencyKey: `${PREFIX}transfer_race`,
    };
    const before = await getOrCreateWallet(buyerId, zoneId);
    const [a, b] = await Promise.all([transferKwh(args), transferKwh(args)]);
    const after = await getOrCreateWallet(buyerId, zoneId);

    expect(a.transferId).toBe(b.transferId);
    expect(Number(after.kwhBalance) - Number(before.kwhBalance)).toBeCloseTo(4, 3);
    expect(
      await prisma.tokenTransfer.count({
        where: { zoneId, idempotencyKey: `${PREFIX}transfer_race` },
      }),
    ).toBe(1);
  });
});

// §6 and §17 — concurrent takers hitting one resting order. CLAUDE.md asks
// for the concurrent case on anything that moves energy; a book read without
// a lock lets two takers plan fills against the same kWh, and the maker ends
// up having sold more than it held.
describe("concurrent takers against one resting order — §6, §17", () => {
  it("never fills more than the maker was offering", async () => {
    const maker = await placeOrder({
      userId: sellerId,
      zoneId,
      side: "SELL",
      type: "LIMIT",
      amountKwh: 5,
      limitPrice: 0.2,
      intervalStart: null,
    });

    // Eight buyers want 1 kWh each from a 5 kWh offer, all at once.
    const buyers = await Promise.all(
      Array.from({ length: 8 }, async (_, i) => {
        const user = await prisma.user.upsert({
          where: { username: `${PREFIX}racer_${i}` },
          update: {},
          create: { username: `${PREFIX}racer_${i}`, passwordHash: "x" },
        });
        const wallet = await getOrCreateWallet(user.id, zoneId);
        await prisma.wallet.update({
          where: { id: wallet.id },
          data: { fiatBalance: new Prisma.Decimal(100) },
        });
        return user.id;
      }),
    );

    const results = await Promise.allSettled(
      buyers.map((userId) =>
        placeOrder({
          userId,
          zoneId,
          side: "BUY",
          type: "MARKET",
          amountKwh: 1,
          limitPrice: null,
          intervalStart: null,
        }),
      ),
    );

    // No internal errors: an unfillable market order expires, it does not
    // blow up.
    const rejectedByError = results.filter((r) => r.status === "rejected");
    expect(rejectedByError.map((r) => (r as PromiseRejectedResult).reason?.message)).toEqual([]);

    const makerRow = await prisma.order.findUniqueOrThrow({ where: { id: maker.orderId } });
    expect(Number(makerRow.filledKwh)).toBeLessThanOrEqual(5);

    const trades = await prisma.trade.findMany({ where: { sellOrderId: maker.orderId } });
    const soldKwh = trades.reduce((sum, t) => sum + Number(t.amountKwh), 0);
    expect(soldKwh).toBeLessThanOrEqual(5);
    expect(trades.every((t) => Number(t.amountKwh) > 0)).toBe(true);
  });
});
