// ТЗ §16.11 — "реестр токенов сверяется с данными сети раз в сутки".
//
// Integration tests against the throwaway database: the checks are queries,
// and a query that is wrong about joins cannot be caught by a stub.

import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { mintToken } from "./token-registry";
import { getOrCreateWallet } from "./wallet-service";
import { reconcileRegistry } from "./reconciliation-service";

const PREFIX = "test_recon_";
const ZONE = "TESTRECON";

const WINDOW_START = new Date("2026-11-24T00:00:00.000Z");
const INTERVAL = new Date("2026-11-24T10:00:00.000Z");
const NOW = new Date("2026-11-24T23:30:00.000Z");

let zoneId: string;
let assetId: string;
let walletId: string;
let userId: string;

async function cleanup() {
  await prisma.reconciliationRun.deleteMany({ where: { scope: { startsWith: PREFIX } } });
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.meterReading.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.asset.deleteMany({ where: { gridZone: { code: ZONE } } });
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
  await prisma.auditLog.deleteMany({ where: { actor: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

/** One valid reading and the batch it minted — the shape of a clean day. */
async function seedReadingWithToken(args: {
  intervalStart: Date;
  energyKwh: number;
  mintKwh?: number;
  mint?: boolean;
}) {
  const reading = await prisma.meterReading.create({
    data: {
      assetId,
      zoneId,
      intervalStart: args.intervalStart,
      intervalEnd: new Date(args.intervalStart.getTime() + 60 * 60 * 1000),
      energyKwh: new Prisma.Decimal(args.energyKwh),
      source: "rest",
      validationStatus: "VALID",
      mintedAt: args.mint === false ? null : new Date(),
    },
  });
  if (args.mint === false) return { reading, token: null };

  const token = await mintToken(prisma, {
    assetId,
    zoneId,
    intervalStart: args.intervalStart,
    amountKwh: args.mintKwh ?? args.energyKwh,
    readingId: reading.id,
    ownerWalletId: walletId,
  });
  return { reading, token };
}

beforeAll(async () => {
  await cleanup();
  const user = await prisma.user.create({
    data: { username: `${PREFIX}owner`, passwordHash: "x" },
  });
  userId = user.id;

  const zone = await prisma.gridZone.create({
    data: {
      code: ZONE,
      country: "SK",
      name: "Reconciliation zone",
      currency: "EUR",
      intervalMinutes: 60,
      corridorPct: new Prisma.Decimal(30),
      spotPrice: new Prisma.Decimal(0.2),
    },
  });
  zoneId = zone.id;

  const company = await prisma.company.create({
    data: {
      legalName: `${PREFIX}Co`,
      country: "SK",
      regNumber: `${PREFIX}reg`,
      type: "PRODUCER",
      kybStatus: "APPROVED",
      ownerUserId: userId,
    },
  });
  const asset = await prisma.asset.create({
    data: {
      companyId: company.id,
      gridZoneId: zoneId,
      kind: "SOLAR",
      name: `${PREFIX}asset`,
      capacityKw: new Prisma.Decimal(20),
      status: "ACTIVE",
      activatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  assetId = asset.id;
  walletId = (await getOrCreateWallet(userId, zoneId)).id;
});

beforeEach(async () => {
  await prisma.energyToken.deleteMany({ where: { zoneId } });
  await prisma.meterReading.deleteMany({ where: { zoneId } });
  await prisma.reconciliationRun.deleteMany({ where: { scope: { startsWith: PREFIX } } });
  await prisma.wallet.update({
    where: { id: walletId },
    data: { kwhBalance: new Prisma.Decimal(0) },
  });
  vi.restoreAllMocks();
  notified = [];
});

afterAll(async () => {
  await cleanup();
});

let notified: { driftCount: number; runId: string }[] = [];

const run = (over: Record<string, unknown> = {}) =>
  reconcileRegistry({
    now: NOW,
    since: WINDOW_START,
    scope: `${PREFIX}daily`,
    // Only this file's assets: the checks count rows, and the suite runs
    // files side by side against the same database.
    assetIds: [assetId],
    walletIds: [walletId],
    operatorIds: [],
    // Injected, so a test never sends mail through the live Resend key.
    notify: async (outcome) => {
      notified.push({ driftCount: outcome.driftCount, runId: outcome.runId });
    },
    ...over,
  });

describe("reconcileRegistry — a clean registry", () => {
  it("finds no drift and records the run", async () => {
    await seedReadingWithToken({ intervalStart: INTERVAL, energyKwh: 4.125 });

    const outcome = await run();

    expect(outcome.ok).toBe(true);
    expect(outcome.driftCount).toBe(0);
    expect(outcome.checks.map((c) => c.name)).toEqual([
      "wallet-balances",
      "readings-minted",
      "orphan-batches",
      "asset-daily-totals",
      "tariff-journal",
    ]);

    const stored = await prisma.reconciliationRun.findUniqueOrThrow({
      where: { id: outcome.runId },
    });
    expect(stored.ok).toBe(true);
    expect(stored.driftCount).toBe(0);
    expect(stored.finishedAt).not.toBeNull();
  });

  it("counts what it actually compared, so a silent no-op is visible", async () => {
    await seedReadingWithToken({ intervalStart: INTERVAL, energyKwh: 4.125 });
    const outcome = await run();
    const readings = outcome.checks.find((c) => c.name === "readings-minted");
    expect(readings?.checked).toBe(1);
  });
});

describe("reconcileRegistry — wallet balances", () => {
  it("reports a cached balance that drifted from the registry", async () => {
    await seedReadingWithToken({ intervalStart: INTERVAL, energyKwh: 4.125 });
    await prisma.wallet.update({
      where: { id: walletId },
      data: { kwhBalance: new Prisma.Decimal(99) },
    });

    const outcome = await run();
    const check = outcome.checks.find((c) => c.name === "wallet-balances");

    expect(outcome.ok).toBe(false);
    expect(check?.drifts).toHaveLength(1);
    expect(check?.drifts[0]).toMatchObject({
      subject: walletId,
      expected: 4.125,
      actual: 99,
    });
  });
});

describe("reconcileRegistry — readings against batches (§16.2)", () => {
  it("reports a valid reading that never minted", async () => {
    await seedReadingWithToken({ intervalStart: INTERVAL, energyKwh: 4.125, mint: false });

    const outcome = await run();
    const check = outcome.checks.find((c) => c.name === "readings-minted");

    expect(outcome.ok).toBe(false);
    expect(check?.drifts).toHaveLength(1);
    expect(check?.drifts[0].note).toMatch(/no batch/i);
  });

  it("reports a batch that does not match its reading", async () => {
    await seedReadingWithToken({
      intervalStart: INTERVAL,
      energyKwh: 4.125,
      mintKwh: 41.25,
    });

    const outcome = await run();
    const readings = outcome.checks.find((c) => c.name === "readings-minted");
    const totals = outcome.checks.find((c) => c.name === "asset-daily-totals");

    expect(readings?.drifts).toHaveLength(1);
    expect(readings?.drifts[0]).toMatchObject({ expected: 4.125, actual: 41.25 });
    // The per-asset total is the number an operator compares with the grid
    // operator's statement, so it must disagree too.
    expect(totals?.drifts).toHaveLength(1);
    expect(totals?.drifts[0]).toMatchObject({ subject: assetId, expected: 4.125, actual: 41.25 });
  });

  it("ignores readings the validator rejected: they must not mint", async () => {
    await prisma.meterReading.create({
      data: {
        assetId,
        zoneId,
        intervalStart: INTERVAL,
        intervalEnd: new Date(INTERVAL.getTime() + 3_600_000),
        energyKwh: new Prisma.Decimal(9999),
        source: "rest",
        validationStatus: "REJECTED",
        validationNote: "impossible for the capacity",
      },
    });

    const outcome = await run();
    expect(outcome.ok).toBe(true);
    expect(outcome.checks.find((c) => c.name === "readings-minted")?.checked).toBe(0);
  });

  it("looks only inside its window", async () => {
    // Yesterday, left unminted on purpose: a daily run must not re-open it.
    await seedReadingWithToken({
      intervalStart: new Date("2026-11-23T10:00:00.000Z"),
      energyKwh: 3,
      mint: false,
    });
    await seedReadingWithToken({ intervalStart: INTERVAL, energyKwh: 4.125 });

    const outcome = await run();
    expect(outcome.ok).toBe(true);
    expect(outcome.checks.find((c) => c.name === "readings-minted")?.checked).toBe(1);
  });
});

describe("reconcileRegistry — orphan batches", () => {
  it("reports a batch that came from no reading and no split", async () => {
    const orphan = await mintToken(prisma, {
      assetId,
      zoneId,
      intervalStart: INTERVAL,
      amountKwh: 7,
      ownerWalletId: walletId,
    });
    // This check windows on mintedAt, which defaults to the real clock. The
    // window here is a fixed day, so the batch has to be dated into it —
    // otherwise the test passes or fails depending on today's date.
    await prisma.energyToken.update({
      where: { id: orphan.id },
      data: { mintedAt: INTERVAL },
    });

    const outcome = await run();
    const check = outcome.checks.find((c) => c.name === "orphan-batches");

    expect(outcome.ok).toBe(false);
    expect(check?.drifts).toHaveLength(1);
    expect(check?.drifts[0]).toMatchObject({ actual: 7 });
  });

  it("accepts a split child, which legitimately has no reading of its own", async () => {
    const { token } = await seedReadingWithToken({ intervalStart: INTERVAL, energyKwh: 10 });
    await prisma.energyToken.create({
      data: {
        assetId,
        zoneId,
        intervalStart: INTERVAL,
        amountKwh: new Prisma.Decimal(4),
        parentId: token!.id,
        ownerWalletId: walletId,
        mintedAt: INTERVAL,
      },
    });
    // Dated into the window for the same reason as above: a child outside it
    // would make this case prove nothing.
    await prisma.energyToken.update({
      where: { id: token!.id },
      data: { mintedAt: INTERVAL },
    });
    await prisma.energyToken.update({
      where: { id: token!.id },
      data: { amountKwh: new Prisma.Decimal(6) },
    });
    await prisma.wallet.update({
      where: { id: walletId },
      data: { kwhBalance: new Prisma.Decimal(10) },
    });

    const outcome = await run();
    expect(outcome.checks.find((c) => c.name === "orphan-batches")?.drifts).toEqual([]);
  });
});

describe("reconcileRegistry — the operator is told", () => {
  it("alerts on drift and stays quiet on a clean run", async () => {
    await seedReadingWithToken({ intervalStart: INTERVAL, energyKwh: 4.125 });
    await run();
    expect(notified).toEqual([]);

    await prisma.wallet.update({
      where: { id: walletId },
      data: { kwhBalance: new Prisma.Decimal(99) },
    });
    const drifted = await run();
    expect(notified).toEqual([{ driftCount: 1, runId: drifted.runId }]);
  });

  it("keeps the finding even when the alert fails", async () => {
    await seedReadingWithToken({ intervalStart: INTERVAL, energyKwh: 4.125, mint: false });
    const outcome = await run({
      notify: async () => {
        throw new Error("smtp down");
      },
    });

    expect(outcome.ok).toBe(false);
    const stored = await prisma.reconciliationRun.findUniqueOrThrow({
      where: { id: outcome.runId },
    });
    // An unminted reading fails two checks: its own, and the asset's day.
    expect(stored.driftCount).toBe(2);
  });

  it("writes an audit entry for every run", async () => {
    await seedReadingWithToken({ intervalStart: INTERVAL, energyKwh: 4.125 });
    const outcome = await run();

    const audit = await prisma.auditLog.findFirst({
      where: { entity: "ReconciliationRun", entityId: outcome.runId },
    });
    expect(audit?.action).toBe("reconciliation.completed");
  });

  it("never repairs what it found: a drift is a bug upstream", async () => {
    await seedReadingWithToken({ intervalStart: INTERVAL, energyKwh: 4.125 });
    await prisma.wallet.update({
      where: { id: walletId },
      data: { kwhBalance: new Prisma.Decimal(99) },
    });

    await run();

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    expect(Number(wallet.kwhBalance)).toBe(99);
  });
});
