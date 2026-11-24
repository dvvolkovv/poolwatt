// End-to-end integration test of the exchange core against the real dev DB.
//
// It walks the whole ТЗ happy path once: listing (§4) → telemetry and minting
// (§5) → order book and a trade (§6) → charging payment (§8) → interval close
// and routing (§16.4), asserting the invariants that money and energy depend
// on. Unit tests cover the arithmetic; this covers the wiring.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAsset } from "./asset-service";
import { closeInterval, reconcileWalletBalances } from "./interval-close-service";
import { createCompany, decideApplication, submitApplication } from "./listing-service";
import { cancelOrder, placeOrder, readOrderBook } from "./order-service";
import { chargeSession, quoteCharge } from "./payment-service";
import { ingestReadings, readAssetTokens } from "./telemetry-service";
import { transferKwh } from "./transfer-service";
import { num } from "./decimal";
import { assertWalletTokensBalance } from "./token-registry";
import { getOrCreateWallet } from "./wallet-service";

const PREFIX = "test_xchg_";
const ZONE_CODE = "TESTZONE";

let zoneId: string;
let producerUserId: string;
let buyerUserId: string;
let operatorUserId: string;
let friendUserId: string;
let companyId: string;
let assetId: string;
let storageAssetId: string;

const INTERVAL_START = new Date("2026-11-20T10:00:00.000Z");

async function seedUser(username: string) {
  const user = await prisma.user.upsert({
    where: { username },
    update: {},
    create: { username, passwordHash: "x" },
  });
  return user.id;
}

async function fundWallet(userId: string, amount: number) {
  const wallet = await getOrCreateWallet(userId, zoneId);
  await prisma.wallet.update({
    where: { id: wallet.id },
    data: { fiatBalance: new Prisma.Decimal(amount) },
  });
  return wallet;
}

beforeAll(async () => {
  // Shut in production until a bank and a lawyer say otherwise (gates.ts).
  vi.stubEnv("IBAN_PROVIDER", "sandbox");
  vi.stubEnv("KWH_TRANSFERS_ENABLED", "true");

  // Clean any leftovers from a previous run, children first.
  const zone = await prisma.gridZone.findUnique({ where: { code: ZONE_CODE } });
  if (zone) {
    await prisma.receipt.deleteMany({ where: { OR: [{ payment: { zoneId: zone.id } }, { trade: { zoneId: zone.id } }] } });
    await prisma.trade.deleteMany({ where: { zoneId: zone.id } });
    await prisma.payment.deleteMany({ where: { zoneId: zone.id } });
    await prisma.tokenTransfer.deleteMany({ where: { zoneId: zone.id } });
    await prisma.order.deleteMany({ where: { zoneId: zone.id } });
    await prisma.energyToken.deleteMany({ where: { zoneId: zone.id } });
    await prisma.meterReading.deleteMany({ where: { zoneId: zone.id } });
    await prisma.wallet.deleteMany({ where: { zoneId: zone.id } });
    await prisma.asset.deleteMany({ where: { gridZoneId: zone.id } });
    await prisma.listingApplication.deleteMany({ where: { company: { legalName: { startsWith: PREFIX } } } });
    await prisma.settlementAccount.deleteMany({ where: { company: { legalName: { startsWith: PREFIX } } } });
    await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
    await prisma.gridZone.delete({ where: { id: zone.id } });
  }

  const created = await prisma.gridZone.create({
    data: {
      code: ZONE_CODE,
      country: "SK",
      name: "Test Zone",
      currency: "EUR",
      intervalMinutes: 15,
      corridorPct: new Prisma.Decimal(50),
      spotPrice: new Prisma.Decimal(0.2),
      spotPriceAt: new Date(),
      aggregatorName: "test-aggregator",
    },
  });
  zoneId = created.id;

  producerUserId = await seedUser(`${PREFIX}producer`);
  buyerUserId = await seedUser(`${PREFIX}buyer`);
  operatorUserId = await seedUser(`${PREFIX}operator`);
  friendUserId = await seedUser(`${PREFIX}friend`);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  if (!zoneId) return;
  await prisma.receipt.deleteMany({ where: { OR: [{ payment: { zoneId } }, { trade: { zoneId } }] } });
  await prisma.trade.deleteMany({ where: { zoneId } });
  await prisma.payment.deleteMany({ where: { zoneId } });
  await prisma.tokenTransfer.deleteMany({ where: { zoneId } });
  await prisma.order.deleteMany({ where: { zoneId } });
  await prisma.energyToken.deleteMany({ where: { zoneId } });
  await prisma.meterReading.deleteMany({ where: { zoneId } });
  await prisma.wallet.deleteMany({ where: { zoneId } });
  await prisma.asset.deleteMany({ where: { gridZoneId: zoneId } });
  await prisma.listingApplication.deleteMany({ where: { company: { legalName: { startsWith: PREFIX } } } });
  await prisma.settlementAccount.deleteMany({ where: { company: { legalName: { startsWith: PREFIX } } } });
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
  await prisma.auditLog.deleteMany({ where: { entity: "GridZone", entityId: zoneId } });
  await prisma.gridZone.delete({ where: { id: zoneId } });
});

describe("listing — ТЗ §4, US-01, US-02, US-13", () => {
  it("registers a company and submits an application for review", async () => {
    const company = await createCompany({
      legalName: `${PREFIX}Sunfarm`,
      country: "SK",
      regNumber: `${PREFIX}123`,
      type: "PRODUCER",
      ownerUserId: producerUserId,
    });
    companyId = company.id;
    expect(company.kybStatus).toBe("PENDING");

    const application = await submitApplication({
      companyId,
      actorUserId: producerUserId,
      documents: [
        { name: "licence.pdf", url: "https://example.test/l.pdf", bytes: 1024, mime: "application/pdf" },
      ],
    });
    expect(application.status).toBe("SUBMITTED");
    expect(application.submittedAt).not.toBeNull();
  });

  it("refuses a document over the 20 MB limit", async () => {
    await expect(
      submitApplication({
        companyId,
        actorUserId: producerUserId,
        documents: [
          { name: "huge.pdf", url: "https://example.test/h.pdf", bytes: 21 * 1024 * 1024, mime: "application/pdf" },
        ],
      }),
    ).rejects.toThrow(/20 MB/);
  });

  it("keeps a new asset in DRAFT while KYB is still pending (§4 gate)", async () => {
    const draft = await createAsset({
      companyId,
      kind: "SOLAR",
      name: "Draft roof",
      capacityKw: 10,
      gridZoneId: zoneId,
      actorUserId: producerUserId,
    });
    expect(draft.status).toBe("DRAFT");
  });

  it("approves the application, opens an IBAN and starts asset probation", async () => {
    const pending = await prisma.listingApplication.findFirstOrThrow({
      where: { companyId, status: "SUBMITTED" },
    });
    const result = await decideApplication({
      applicationId: pending.id,
      reviewerId: operatorUserId,
      approve: true,
      screeningNote: "No sanctions hits",
    });

    expect(result.accountId).not.toBeNull();
    expect(result.promotedAssets).toBe(1);

    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(company.kybStatus).toBe("APPROVED");

    const account = await prisma.settlementAccount.findUniqueOrThrow({ where: { companyId } });
    expect(account.iban).toMatch(/^LT/);
  });

  it("refuses a rejection without a comment (US-02)", async () => {
    const app = await submitApplication({
      companyId,
      actorUserId: producerUserId,
      documents: [
        { name: "l.pdf", url: "https://example.test/l.pdf", bytes: 10, mime: "application/pdf" },
      ],
    });
    await expect(
      decideApplication({ applicationId: app.id, reviewerId: operatorUserId, approve: false }),
    ).rejects.toThrow(/comment/i);
    await prisma.listingApplication.delete({ where: { id: app.id } });
  });
});

describe("telemetry and minting — ТЗ §5, US-03, US-04, §16.2", () => {
  it("creates an asset that goes straight to TEST once KYB is approved", async () => {
    const asset = await createAsset({
      companyId,
      kind: "SOLAR",
      name: "Roof array",
      capacityKw: 100,
      gridZoneId: zoneId,
      meterId: `${PREFIX}meter-1`,
      goCertificateRef: "GO-SK-2026-0001",
      actorUserId: producerUserId,
    });
    assetId = asset.id;
    expect(asset.status).toBe("TEST");
  });

  it("validates telemetry but mints nothing while the asset is in TEST (§4)", async () => {
    const outcome = await ingestReadings({
      assetId,
      readings: [{ intervalStart: "2026-11-19T10:00:00.000Z", energyKwh: 20 }],
    });
    expect(outcome.accepted).toBe(1);
    expect(outcome.minted).toBe(0);

    const tokens = await prisma.energyToken.count({ where: { assetId } });
    expect(tokens).toBe(0);
  });

  it("mints one batch per valid interval once the asset is ACTIVE", async () => {
    await prisma.asset.update({
      where: { id: assetId },
      data: { status: "ACTIVE", activatedAt: new Date() },
    });

    const outcome = await ingestReadings({
      assetId,
      readings: [
        { intervalStart: INTERVAL_START.toISOString(), energyKwh: 20 },
        { intervalStart: "2026-11-20T10:15:00.000Z", energyKwh: 18.4567 },
      ],
    });
    expect(outcome.minted).toBe(2);
    expect(outcome.mintedKwh).toBe(38.457);

    const wallet = await getOrCreateWallet(producerUserId, zoneId);
    expect(num((await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } })).kwhBalance)).toBe(
      38.457,
    );
  });

  it("ignores a replayed interval instead of minting it twice (§16.2)", async () => {
    const before = await prisma.energyToken.count({ where: { assetId } });
    const outcome = await ingestReadings({
      assetId,
      readings: [{ intervalStart: INTERVAL_START.toISOString(), energyKwh: 20 }],
    });
    expect(outcome.duplicates).toBe(1);
    expect(outcome.minted).toBe(0);
    expect(await prisma.energyToken.count({ where: { assetId } })).toBe(before);
  });

  it("holds an implausible reading for review and mints nothing", async () => {
    const outcome = await ingestReadings({
      assetId,
      readings: [{ intervalStart: "2026-11-20T10:30:00.000Z", energyKwh: 500 }],
    });
    expect(outcome.suspicious).toBe(1);
    expect(outcome.minted).toBe(0);

    // §4 — an anomaly resets the clean-telemetry clock.
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
    expect(asset.telemetryCleanSince).toBeNull();
  });

  it("refuses a batch over the 1000-interval limit (§15)", async () => {
    const readings = Array.from({ length: 1001 }, (_, i) => ({
      intervalStart: new Date(Date.UTC(2026, 0, 1, 0, i * 15)).toISOString(),
      energyKwh: 1,
    }));
    await expect(ingestReadings({ assetId, readings })).rejects.toThrow(/1000/);
  });

  it("summarises tokens by status for the producer dashboard (US-05)", async () => {
    const summary = await readAssetTokens({
      assetId,
      from: new Date("2026-11-20T00:00:00.000Z"),
      to: new Date("2026-11-21T00:00:00.000Z"),
    });
    expect(summary.mintedKwh).toBe(38.457);
    expect(summary.availableKwh).toBe(38.457);
    expect(summary.batches[0].goCertificateRef).toBe("GO-SK-2026-0001");
  });
});

describe("the order book — ТЗ §6, US-06, US-07, §16.5", () => {
  it("rests a producer's limit sell and shows it in the book", async () => {
    const sell = await placeOrder({
      userId: producerUserId,
      zoneId,
      side: "SELL",
      type: "LIMIT",
      amountKwh: 20,
      limitPrice: 0.22,
      intervalStart: INTERVAL_START,
    });
    expect(sell.status).toBe("NEW");
    expect(sell.filledKwh).toBe(0);

    const book = await readOrderBook(zoneId, INTERVAL_START);
    expect(book.asks).toEqual([{ price: 0.22, amountKwh: 20, orders: 1 }]);
    expect(book.bestAsk).toBe(0.22);
    expect(book.corridor).toEqual({ min: 0.1, max: 0.3 });
  });

  it("refuses to sell kWh the wallet does not hold", async () => {
    const sell = await placeOrder({
      userId: buyerUserId,
      zoneId,
      side: "SELL",
      type: "LIMIT",
      amountKwh: 5,
      limitPrice: 0.2,
    });
    expect(sell.status).toBe("REJECTED");
    expect(sell.rejectReason).toMatch(/cannot sell/i);
  });

  it("refuses a limit price outside the zone corridor (§16.5)", async () => {
    const order = await placeOrder({
      userId: buyerUserId,
      zoneId,
      side: "BUY",
      type: "LIMIT",
      amountKwh: 1,
      limitPrice: 5,
    });
    expect(order.status).toBe("REJECTED");
    expect(order.rejectReason).toMatch(/corridor/i);
  });

  it("refuses a buy the wallet cannot fund", async () => {
    const order = await placeOrder({
      userId: buyerUserId,
      zoneId,
      side: "BUY",
      type: "MARKET",
      amountKwh: 10,
      intervalStart: INTERVAL_START,
    });
    expect(order.status).toBe("REJECTED");
    expect(order.rejectReason).toMatch(/insufficient funds/i);
  });

  it("matches a funded market buy at the maker's price and moves tokens and money", async () => {
    await fundWallet(buyerUserId, 100);
    const producerWallet = await getOrCreateWallet(producerUserId, zoneId);
    const producerFiatBefore = num(
      (await prisma.wallet.findUniqueOrThrow({ where: { id: producerWallet.id } })).fiatBalance,
    );

    const buy = await placeOrder({
      userId: buyerUserId,
      zoneId,
      side: "BUY",
      type: "MARKET",
      amountKwh: 8,
      intervalStart: INTERVAL_START,
    });

    expect(buy.status).toBe("FILLED");
    expect(buy.filledKwh).toBe(8);
    expect(buy.avgPrice).toBe(0.22);
    expect(buy.notional).toBe(1.76);
    expect(buy.tradeIds).toHaveLength(1);

    const buyerWallet = await getOrCreateWallet(buyerUserId, zoneId);
    const buyer = await prisma.wallet.findUniqueOrThrow({ where: { id: buyerWallet.id } });
    expect(num(buyer.kwhBalance)).toBe(8);
    // 1.76 notional + 1% buyer commission (rounded up) = 1.78
    expect(num(buyer.fiatBalance)).toBe(98.22);

    const producer = await prisma.wallet.findUniqueOrThrow({ where: { id: producerWallet.id } });
    expect(num(producer.kwhBalance)).toBe(30.457);
    // 1.76 notional − 1% seller commission = 1.74
    expect(num(producer.fiatBalance)).toBe(producerFiatBefore + 1.74);

    // Registry and cached balances must agree after every settlement.
    await expect(assertWalletTokensBalance(prisma, buyerWallet.id)).resolves.toBe(8);
    await expect(assertWalletTokensBalance(prisma, producerWallet.id)).resolves.toBe(30.457);
  });

  it("leaves the partially filled sell resting with the remainder", async () => {
    const book = await readOrderBook(zoneId, INTERVAL_START);
    expect(book.asks).toEqual([{ price: 0.22, amountKwh: 12, orders: 1 }]);
  });

  it("issues a receipt for the trade (§46)", async () => {
    const trade = await prisma.trade.findFirstOrThrow({
      where: { zoneId },
      include: { receipt: true },
    });
    expect(trade.receipt).not.toBeNull();
    expect(num(trade.receipt!.totalKwh)).toBe(8);
  });

  it("replays an idempotency key instead of placing a second order (§15)", async () => {
    const key = `${PREFIX}idem-1`;
    const first = await placeOrder({
      userId: buyerUserId,
      zoneId,
      side: "BUY",
      type: "LIMIT",
      amountKwh: 1,
      limitPrice: 0.15,
      idempotencyKey: key,
    });
    const second = await placeOrder({
      userId: buyerUserId,
      zoneId,
      side: "BUY",
      type: "LIMIT",
      amountKwh: 1,
      limitPrice: 0.15,
      idempotencyKey: key,
    });
    expect(second.orderId).toBe(first.orderId);
    expect(second.idempotentReplay).toBe(true);
    await cancelOrder(first.orderId, buyerUserId);
  });

  it("reserves funds for a resting buy and releases them on cancel (US-06)", async () => {
    const walletBefore = await getOrCreateWallet(buyerUserId, zoneId);
    const order = await placeOrder({
      userId: buyerUserId,
      zoneId,
      side: "BUY",
      type: "LIMIT",
      amountKwh: 10,
      limitPrice: 0.15,
      intervalStart: new Date("2026-11-21T10:00:00.000Z"),
    });
    expect(order.status).toBe("NEW");

    const reserved = num(
      (await prisma.wallet.findUniqueOrThrow({ where: { id: walletBefore.id } })).reservedFiat,
    );
    expect(reserved).toBe(1.52); // 10 × 0.15 + 1% commission, rounded up

    await cancelOrder(order.orderId, buyerUserId);
    const after = await prisma.wallet.findUniqueOrThrow({ where: { id: walletBefore.id } });
    expect(num(after.reservedFiat)).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } })).status).toBe(
      "CANCELLED",
    );
  });

  it("refuses to cancel someone else's order", async () => {
    const order = await placeOrder({
      userId: producerUserId,
      zoneId,
      side: "SELL",
      type: "LIMIT",
      amountKwh: 1,
      limitPrice: 0.25,
    });
    await expect(cancelOrder(order.orderId, buyerUserId)).rejects.toThrow(/not your order/i);
    await cancelOrder(order.orderId, producerUserId);
  });
});

describe("charging payment — ТЗ §8, US-08, §16.6", () => {
  it("quotes the session before the user confirms (§54)", async () => {
    const quote = await quoteCharge({ userId: buyerUserId, zoneId, requestedKwh: 10 });
    // 8 kWh on the balance, 2 bought from the resting ask at 0.22
    expect(quote.kwhFromBalance).toBe(8);
    expect(quote.kwhFromMarket).toBe(2);
    expect(quote.authorizedFiat).toBeGreaterThan(quote.total);
  });

  it("spends the balance first, buys the shortfall and issues a receipt", async () => {
    const result = await chargeSession({
      userId: buyerUserId,
      zoneId,
      requestedKwh: 10,
      chargePointId: `${PREFIX}cp-1`,
      idempotencyKey: `${PREFIX}charge-1`,
    });

    expect(result.status).toBe("CAPTURED");
    expect(result.kwhFromBalance).toBe(8);
    expect(result.kwhBought).toBe(2);
    expect(result.deliveredKwh).toBe(10);
    expect(result.unservedKwh).toBe(0);
    expect(result.burnedTokenIds.length).toBeGreaterThan(0);
    expect(result.receiptId).not.toBeNull();

    // All 10 kWh are burned, so the wallet is back to zero kWh.
    const wallet = await getOrCreateWallet(buyerUserId, zoneId);
    expect(num((await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } })).kwhBalance)).toBe(0);

    const burned = await prisma.energyToken.findMany({
      where: { id: { in: result.burnedTokenIds } },
    });
    expect(burned.every((b) => b.status === "BURNED" && b.burnedAt !== null)).toBe(true);
  });

  it("replays the same idempotency key instead of charging twice", async () => {
    const replay = await chargeSession({
      userId: buyerUserId,
      zoneId,
      requestedKwh: 10,
      idempotencyKey: `${PREFIX}charge-1`,
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.deliveredKwh).toBe(10);
  });

  it("fails cleanly when nothing can be sourced", async () => {
    const poor = await seedUser(`${PREFIX}poor`);
    const result = await chargeSession({ userId: poor, zoneId, requestedKwh: 5 });
    expect(result.status).toBe("FAILED");
    expect(result.failureReason).toMatch(/insufficient funds|liquidity/i);
    expect(result.deliveredKwh).toBe(0);
  });
});

describe("member transfers — ТЗ §24, US-19", () => {
  // §24.1 — transfers only run between KYC-verified members of one cooperative.
  beforeAll(async () => {
    const coop = await prisma.cooperative.create({
      data: { companyId, zoneId, name: `${PREFIX}coop` },
    });
    for (const userId of [producerUserId, friendUserId, buyerUserId]) {
      await prisma.coopMember.create({
        data: { coopId: coop.id, userId, status: "ACTIVE", kycVerifiedAt: new Date() },
      });
    }
  });

  it("moves kWh between members of the same zone without moving money", async () => {
    await fundWallet(producerUserId, 50);
    const friendWallet = await getOrCreateWallet(friendUserId, zoneId);
    const fiatBefore = num(
      (await prisma.wallet.findUniqueOrThrow({ where: { id: friendWallet.id } })).fiatBalance,
    );

    const transfer = await transferKwh({
      fromUserId: producerUserId,
      toUsername: `${PREFIX}friend`,
      zoneId,
      amountKwh: 5,
      note: "community share",
    });
    expect(transfer.status).toBe("CONFIRMED");

    const friend = await prisma.wallet.findUniqueOrThrow({ where: { id: friendWallet.id } });
    expect(num(friend.kwhBalance)).toBe(5);
    expect(num(friend.fiatBalance)).toBe(fiatBefore);
  });

  it("refuses a transfer over the balance", async () => {
    await expect(
      transferKwh({
        fromUserId: friendUserId,
        toUsername: `${PREFIX}buyer`,
        zoneId,
        amountKwh: 9999,
      }),
    ).rejects.toThrow(/cannot transfer/i);
  });

  it("refuses a transfer to an unknown user and to oneself", async () => {
    await expect(
      transferKwh({ fromUserId: friendUserId, toUsername: "nobody_here", zoneId, amountKwh: 1 }),
    ).rejects.toThrow(/No Poolwatt user/);
    await expect(
      transferKwh({ fromUserId: friendUserId, toUsername: `${PREFIX}friend`, zoneId, amountKwh: 1 }),
    ).rejects.toThrow(/yourself/);
  });

  it("enforces the daily AML cap even when the balance would allow it (§24)", async () => {
    // A big asset mints enough in two intervals to clear the 500 kWh cap, so
    // the rejection can only come from the cap and not from the balance.
    const big = await createAsset({
      companyId,
      kind: "WIND",
      name: "Wind park",
      capacityKw: 10_000,
      gridZoneId: zoneId,
      actorUserId: producerUserId,
    });
    await prisma.asset.update({ where: { id: big.id }, data: { status: "ACTIVE" } });
    await ingestReadings({
      assetId: big.id,
      readings: [
        { intervalStart: "2026-11-22T10:00:00.000Z", energyKwh: 1000 },
        { intervalStart: "2026-11-22T10:15:00.000Z", energyKwh: 1000 },
      ],
    });

    const wallet = await getOrCreateWallet(producerUserId, zoneId);
    expect(num((await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } })).kwhBalance)).toBeGreaterThan(
      600,
    );

    await expect(
      transferKwh({
        fromUserId: producerUserId,
        toUsername: `${PREFIX}friend`,
        zoneId,
        amountKwh: 600,
      }),
    ).rejects.toThrow(/daily transfer limit/i);
  });
});

describe("interval close — ТЗ §16.4, US-09", () => {
  it("routes unsold kWh into cooperative storage first, then to the aggregator", async () => {
    const storage = await createAsset({
      companyId,
      kind: "STORAGE",
      name: "Community powerbank",
      capacityKw: 50,
      storageKwh: 3,
      gridZoneId: zoneId,
      actorUserId: producerUserId,
    });
    storageAssetId = storage.id;
    await prisma.asset.update({ where: { id: storageAssetId }, data: { status: "ACTIVE" } });

    const unsoldBefore = await prisma.energyToken.aggregate({
      where: { zoneId, intervalStart: INTERVAL_START, status: "AVAILABLE" },
      _sum: { amountKwh: true },
    });
    const unsoldKwh = num(unsoldBefore._sum.amountKwh);
    // 20 kWh minted for this interval, minus 8 traded, 2 bought by the charge
    // session and 5 transferred to a member — 5 kWh are left unsold.
    expect(unsoldKwh).toBe(5);

    const result = await closeInterval(zoneId, INTERVAL_START);
    expect(result.unsoldKwh).toBe(5);
    expect(result.storedKwh).toBe(3); // storage takes what it can hold
    expect(result.routedKwh).toBe(2); // the rest goes to the aggregator

    const bank = await prisma.asset.findUniqueOrThrow({ where: { id: storageAssetId } });
    expect(num(bank.storedKwh)).toBe(3);

    const routed = await prisma.energyToken.findMany({
      where: { zoneId, intervalStart: INTERVAL_START, status: "ROUTED" },
    });
    expect(routed).toHaveLength(1);
    expect(routed[0].routedTo).toBe("test-aggregator");

    const stillAvailable = await prisma.energyToken.count({
      where: { zoneId, intervalStart: INTERVAL_START, status: "AVAILABLE" },
    });
    expect(stillAvailable).toBe(0);
  });

  it("expires the resting orders of the closed interval (§14)", async () => {
    const stale = await prisma.order.findMany({
      where: { zoneId, intervalStart: INTERVAL_START, status: { in: ["NEW", "PARTIALLY_FILLED"] } },
    });
    expect(stale).toHaveLength(0);
  });

  it("leaves no drift between wallet balances and the token registry (§16.11)", async () => {
    const drifts = await reconcileWalletBalances();
    expect(drifts.filter((d) => d.walletId)).toEqual([]);
  });
});
