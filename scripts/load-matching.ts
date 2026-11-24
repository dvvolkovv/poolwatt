#!/usr/bin/env tsx
// Load test of the matching engine — ТЗ §17: "Матчинг: от 5000 заявок в
// секунду на зону, исполнение рыночной заявки до 100 мс".
//
// The point is to measure, not to pass. It builds a real book in a throwaway
// database, fires market orders at it through the same `placeOrder` the API
// uses, and prints throughput and the latency distribution. Nothing is mocked:
// every order opens a transaction, checks funding, burns tokens and writes an
// audit entry, because that is what the §17 budget has to cover.
//
// Usage (see CLAUDE.md for the throwaway database):
//   NODE_ENV=test DATABASE_URL=…/poolwatt_test npx tsx scripts/load-matching.ts
//   … --orders=2000 --makers=400 --concurrency=32 --keep
//
// Exits 1 when p95 exceeds the §17 budget, so it can gate a deploy later.

import { config as loadDotenv } from "dotenv";

// The caller points this script at a throwaway database on the command line,
// so that choice must survive the .env files (which hold the live one).
const shellDatabaseUrl = process.env.DATABASE_URL;
loadDotenv({ path: ".env" });
loadDotenv({ path: ".env.local", override: true });
if (shellDatabaseUrl) process.env.DATABASE_URL = shellDatabaseUrl;

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { placeOrder } from "@/lib/exchange/order-service";
import { mintToken } from "@/lib/exchange/token-registry";
import { getOrCreateWallet } from "@/lib/exchange/wallet-service";

const LATENCY_BUDGET_MS = 100;
const THROUGHPUT_TARGET = 5000;

const PREFIX = "load_matching_";
const ZONE_CODE = "LOADZONE";

interface Options {
  orders: number;
  makers: number;
  concurrency: number;
  keep: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): Options {
  const flag = (name: string, fallback: number) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? Number(hit.split("=")[1]) : fallback;
  };
  return {
    orders: flag("orders", 1000),
    makers: flag("makers", 200),
    concurrency: flag("concurrency", 32),
    keep: argv.includes("--keep"),
    force: argv.includes("--force"),
  };
}

/** Refuse to flood the live registry with synthetic orders by accident. */
function assertThrowawayDatabase(force: boolean) {
  const url = process.env.DATABASE_URL ?? "";
  const database = url.split("/").pop()?.split("?")[0] ?? "";
  if (/test/i.test(database) || force) return;
  console.error(
    `Refusing to run against database "${database}". This writes thousands of ` +
      `orders and trades. Point DATABASE_URL at poolwatt_test, or pass --force.`,
  );
  process.exit(2);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

async function cleanup() {
  const zone = await prisma.gridZone.findUnique({ where: { code: ZONE_CODE } });
  if (zone) {
    await prisma.receipt.deleteMany({
      where: { OR: [{ payment: { zoneId: zone.id } }, { trade: { zoneId: zone.id } }] },
    });
    await prisma.trade.deleteMany({ where: { zoneId: zone.id } });
    await prisma.order.deleteMany({ where: { zoneId: zone.id } });
    await prisma.energyToken.deleteMany({ where: { zoneId: zone.id } });
    await prisma.meterReading.deleteMany({ where: { zoneId: zone.id } });
    await prisma.wallet.deleteMany({ where: { zoneId: zone.id } });
    await prisma.asset.deleteMany({ where: { gridZoneId: zone.id } });
    await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
    await prisma.gridZone.delete({ where: { id: zone.id } });
  }
  await prisma.auditLog.deleteMany({ where: { actor: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

interface Setup {
  zoneId: string;
  sellerIds: string[];
  buyerIds: string[];
  intervalStart: Date;
}

async function setup(options: Options): Promise<Setup> {
  await cleanup();

  const zone = await prisma.gridZone.create({
    data: {
      code: ZONE_CODE,
      country: "SK",
      name: "Load test zone",
      currency: "EUR",
      intervalMinutes: 60,
      // Wide corridor: this measures the engine, not the §16.5 guard.
      corridorPct: new Prisma.Decimal(90),
      spotPrice: new Prisma.Decimal(0.2),
      spotPriceAt: new Date(),
    },
  });

  const company = await prisma.company.create({
    data: {
      legalName: `${PREFIX}seller_co`,
      country: "SK",
      regNumber: `${PREFIX}reg`,
      type: "PRODUCER",
      kybStatus: "APPROVED",
    },
  });
  const asset = await prisma.asset.create({
    data: {
      companyId: company.id,
      gridZoneId: zone.id,
      kind: "SOLAR",
      name: `${PREFIX}asset`,
      capacityKw: new Prisma.Decimal(1000),
      status: "ACTIVE",
      activatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });

  const intervalStart = new Date("2026-11-20T10:00:00.000Z");
  const sellerIds: string[] = [];
  const buyerIds: string[] = [];

  // One seller per resting order, so no two makers contend for one wallet —
  // the engine is what is being measured, not row locks on one row.
  for (let i = 0; i < options.makers; i += 1) {
    const user = await prisma.user.create({
      data: { username: `${PREFIX}seller_${i}`, passwordHash: "x" },
    });
    sellerIds.push(user.id);
    const wallet = await getOrCreateWallet(user.id, zone.id);
    await mintToken(prisma, {
      assetId: asset.id,
      ownerWalletId: wallet.id,
      zoneId: zone.id,
      amountKwh: 1000,
      intervalStart,
    });
  }

  const buyerCount = Math.max(1, Math.min(options.concurrency, 64));
  for (let i = 0; i < buyerCount; i += 1) {
    const user = await prisma.user.create({
      data: { username: `${PREFIX}buyer_${i}`, passwordHash: "x" },
    });
    buyerIds.push(user.id);
    const wallet = await getOrCreateWallet(user.id, zone.id);
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { fiatBalance: new Prisma.Decimal(1_000_000) },
    });
  }

  return { zoneId: zone.id, sellerIds, buyerIds, intervalStart };
}

/** Fill the book with resting sell orders, and time that too. */
async function buildBook(ctx: Setup, options: Options): Promise<number[]> {
  const latencies: number[] = [];
  for (let i = 0; i < options.makers; i += 1) {
    const started = performance.now();
    await placeOrder({
      userId: ctx.sellerIds[i],
      zoneId: ctx.zoneId,
      side: "SELL",
      type: "LIMIT",
      amountKwh: 10,
      // A spread of prices, so a market order walks several levels.
      limitPrice: Number((0.15 + (i % 20) * 0.001).toFixed(4)),
      intervalStart: ctx.intervalStart,
    });
    latencies.push(performance.now() - started);
  }
  return latencies;
}

interface Shot {
  latencyMs: number;
  filledKwh: number;
  rejected: boolean;
  error?: string;
  stack?: string;
}

/** Fire market buys with a fixed number of requests in flight. */
async function fireMarketOrders(ctx: Setup, options: Options): Promise<Shot[]> {
  const shots: Shot[] = [];
  let next = 0;

  async function worker(buyerId: string) {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= options.orders) return;

      const started = performance.now();
      try {
        const result = await placeOrder({
          userId: buyerId,
          zoneId: ctx.zoneId,
          side: "BUY",
          type: "MARKET",
          amountKwh: 1,
          limitPrice: null,
          intervalStart: ctx.intervalStart,
        });
        shots.push({
          latencyMs: performance.now() - started,
          filledKwh: result.filledKwh,
          rejected: result.rejectReason != null,
        });
      } catch (err) {
        shots.push({
          latencyMs: performance.now() - started,
          filledKwh: 0,
          rejected: true,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    }
  }

  await Promise.all(ctx.buyerIds.map((buyerId) => worker(buyerId)));
  return shots;
}

function report(title: string, latencies: number[], wallMs: number) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const perSecond = latencies.length / (wallMs / 1000);
  const fmt = (n: number) => n.toFixed(1).padStart(8);
  console.log(`\n${title}`);
  console.log(`  orders            ${String(latencies.length).padStart(8)}`);
  console.log(`  wall clock, s     ${fmt(wallMs / 1000)}`);
  console.log(`  throughput, ord/s ${fmt(perSecond)}`);
  console.log(`  p50, ms           ${fmt(percentile(sorted, 50))}`);
  console.log(`  p95, ms           ${fmt(percentile(sorted, 95))}`);
  console.log(`  p99, ms           ${fmt(percentile(sorted, 99))}`);
  console.log(`  max, ms           ${fmt(sorted[sorted.length - 1] ?? 0)}`);
  return { perSecond, p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99) };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  assertThrowawayDatabase(options.force);

  console.log(
    `[load] zone=${ZONE_CODE} makers=${options.makers} market orders=${options.orders} ` +
      `concurrency=${options.concurrency}`,
  );
  console.log(`[load] database=${(process.env.DATABASE_URL ?? "").split("/").pop()}`);

  const ctx = await setup(options);

  const bookStarted = performance.now();
  const bookLatencies = await buildBook(ctx, options);
  const bookWall = performance.now() - bookStarted;
  report("Resting LIMIT SELL orders (book build)", bookLatencies, bookWall);

  const shotStarted = performance.now();
  const shots = await fireMarketOrders(ctx, options);
  const shotWall = performance.now() - shotStarted;

  const filled = shots.filter((s) => s.filledKwh > 0).length;
  const rejected = shots.filter((s) => s.rejected).length;
  const errors = shots.filter((s) => s.error).length;
  const market = report("MARKET BUY orders", shots.map((s) => s.latencyMs), shotWall);
  console.log(`  filled            ${String(filled).padStart(8)}`);
  console.log(`  rejected          ${String(rejected).padStart(8)}`);
  console.log(`  errored           ${String(errors).padStart(8)}`);
  if (errors > 0) {
    const first = shots.find((s) => s.error);
    console.log(`  first error       ${first?.error}`);
    if (process.env.LOAD_SHOW_STACK === "1") console.log(first?.stack);
  }

  console.log("\nТЗ §17 budget");
  console.log(`  market order p95 ≤ ${LATENCY_BUDGET_MS} ms: ${market.p95 <= LATENCY_BUDGET_MS ? "met" : "MISSED"} (${market.p95.toFixed(1)} ms)`);
  console.log(
    `  ≥ ${THROUGHPUT_TARGET} orders/s per zone: ${market.perSecond >= THROUGHPUT_TARGET ? "met" : "MISSED"} (${market.perSecond.toFixed(1)} ord/s)`,
  );

  if (!options.keep) await cleanup();
  await prisma.$disconnect();

  process.exit(market.p95 <= LATENCY_BUDGET_MS ? 0 : 1);
}

main().catch(async (err) => {
  console.error("[load] FAILED:", err);
  await prisma.$disconnect();
  process.exit(2);
});
