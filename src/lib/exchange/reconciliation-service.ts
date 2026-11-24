// Daily reconciliation of the token registry — ТЗ §16.11 ("реестр токенов
// сверяется с данными сети раз в сутки") and §5 ("Защита от двойного учёта:
// каждый кВт·ч имеет уникальный идентификатор, сверка с данными сети и
// поставщика").
//
// Four questions, asked every night:
//
//   1. does every wallet's cached kWh balance equal the batches it holds?
//   2. does every valid meter reading have exactly one batch, of exactly its
//      size? (§16.2 "один MeterReading — ровно один выпуск")
//   3. is there a batch that came from no reading and no split — a kWh that
//      appeared out of nowhere?
//   4. per asset and per day, does what we issued equal what the meter said?
//
// Nothing is ever repaired. A drift means a bug upstream, and a reconciliation
// that quietly fixes its own findings is a reconciliation that hides them.
//
// "Данные сети" today means the signed readings of the assets themselves
// (§15 HMAC). Comparing against the grid operator's own statement needs a
// contract and a feed from them — an owner question, not a code question;
// check 4 is shaped as the per-asset daily total precisely so that feed can
// be dropped in beside it.

import { Prisma, ReadingValidationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendReconciliationDrift } from "@/lib/resend-reconciliation";
import { writeAudit } from "./audit";
import { num } from "./decimal";
import { reconcileWalletBalances } from "./interval-close-service";
import { roundKwh } from "./precision";

/** Anything smaller than half a token step is rounding, not drift. */
const TOLERANCE_KWH = 0.0005;

export type CheckName =
  | "wallet-balances"
  | "readings-minted"
  | "orphan-batches"
  | "asset-daily-totals";

export interface Drift {
  /** What disagreed: a wallet id, a reading id, a batch id, an asset id. */
  subject: string;
  expectedKwh: number;
  actualKwh: number;
  note?: string;
}

export interface CheckOutcome {
  name: CheckName;
  /** How many things were compared — a check that compared nothing is news. */
  checked: number;
  drifts: Drift[];
}

export interface ReconciliationOutcome {
  runId: string;
  ok: boolean;
  driftCount: number;
  windowFrom: string;
  windowTo: string;
  checks: CheckOutcome[];
}

export interface ReconcileOptions {
  now?: Date;
  /** Start of the window; defaults to 24 hours before `now`. */
  since?: Date;
  scope?: string;
  /**
   * Who to tell about drift. Injectable so tests do not send mail, and so a
   * later channel (Telegram, a pager) can be added without touching the
   * checks.
   */
  notify?: (outcome: ReconciliationOutcome) => Promise<void>;
}

const differs = (a: number, b: number) => Math.abs(roundKwh(a - b)) > TOLERANCE_KWH;

/**
 * 1. The cached balance against the batches actually held.
 *
 * The comparison itself lives in interval-close-service, which has needed it
 * since §16.4 — two copies of this arithmetic would be exactly the kind of
 * drift this file exists to catch.
 */
async function checkWalletBalances(): Promise<CheckOutcome> {
  const checked = await prisma.wallet.count();
  const drifts = (await reconcileWalletBalances()).map((d) => ({
    subject: d.walletId,
    expectedKwh: d.registryKwh,
    actualKwh: d.cachedKwh,
    note: "cached wallet balance disagrees with the batches it holds",
  }));
  return { name: "wallet-balances", checked, drifts };
}

/** 2. One valid reading, one batch, same size (§16.2). */
async function checkReadingsMinted(from: Date, to: Date): Promise<CheckOutcome> {
  const readings = await prisma.meterReading.findMany({
    where: {
      validationStatus: ReadingValidationStatus.VALID,
      intervalStart: { gte: from, lt: to },
    },
    select: {
      id: true,
      assetId: true,
      energyKwh: true,
      token: { select: { id: true, amountKwh: true } },
    },
  });

  const drifts: Drift[] = [];
  for (const reading of readings) {
    const expected = num(reading.energyKwh);
    if (!reading.token) {
      drifts.push({
        subject: reading.id,
        expectedKwh: expected,
        actualKwh: 0,
        note: "valid reading has no batch: nothing was issued for it",
      });
      continue;
    }
    const actual = num(reading.token.amountKwh);
    if (differs(expected, actual)) {
      drifts.push({
        subject: reading.id,
        expectedKwh: expected,
        actualKwh: actual,
        note: `batch ${reading.token.id} does not match the reading it was issued from`,
      });
    }
  }
  return { name: "readings-minted", checked: readings.length, drifts };
}

/** 3. A batch from no reading and no split — kWh out of nowhere (§5). */
async function checkOrphanBatches(from: Date, to: Date): Promise<CheckOutcome> {
  const batches = await prisma.energyToken.findMany({
    where: { mintedAt: { gte: from, lt: to } },
    select: { id: true, readingId: true, parentId: true, amountKwh: true, assetId: true },
  });

  const drifts = batches
    .filter((b) => b.readingId === null && b.parentId === null)
    .map((b) => ({
      subject: b.id,
      expectedKwh: 0,
      actualKwh: num(b.amountKwh),
      note: `batch of asset ${b.assetId} has neither a reading nor a parent batch`,
    }));

  return { name: "orphan-batches", checked: batches.length, drifts };
}

/**
 * 4. Per asset: the meter's day against the registry's day.
 *
 * This is the line an operator compares with the grid operator's statement,
 * so it is computed as a total rather than inferred from check 2.
 */
async function checkAssetDailyTotals(from: Date, to: Date): Promise<CheckOutcome> {
  const readings = await prisma.meterReading.findMany({
    where: {
      validationStatus: ReadingValidationStatus.VALID,
      intervalStart: { gte: from, lt: to },
    },
    select: {
      assetId: true,
      energyKwh: true,
      token: { select: { amountKwh: true } },
    },
  });

  const byAsset = new Map<string, { meterKwh: number; issuedKwh: number }>();
  for (const reading of readings) {
    const row = byAsset.get(reading.assetId) ?? { meterKwh: 0, issuedKwh: 0 };
    row.meterKwh = roundKwh(row.meterKwh + num(reading.energyKwh));
    row.issuedKwh = roundKwh(row.issuedKwh + (reading.token ? num(reading.token.amountKwh) : 0));
    byAsset.set(reading.assetId, row);
  }

  const drifts: Drift[] = [];
  for (const [assetId, row] of byAsset) {
    if (differs(row.meterKwh, row.issuedKwh)) {
      drifts.push({
        subject: assetId,
        expectedKwh: row.meterKwh,
        actualKwh: row.issuedKwh,
        note: "the asset's metered day and its issued day disagree",
      });
    }
  }
  return { name: "asset-daily-totals", checked: byAsset.size, drifts };
}

export async function reconcileRegistry(
  options: ReconcileOptions = {},
): Promise<ReconciliationOutcome> {
  const to = options.now ?? new Date();
  const from = options.since ?? new Date(to.getTime() - 24 * 60 * 60 * 1000);
  const scope = options.scope ?? "daily";

  const run = await prisma.reconciliationRun.create({
    data: { scope, windowFrom: from, windowTo: to },
  });

  const checks: CheckOutcome[] = [
    await checkWalletBalances(),
    await checkReadingsMinted(from, to),
    await checkOrphanBatches(from, to),
    await checkAssetDailyTotals(from, to),
  ];

  const driftCount = checks.reduce((sum, c) => sum + c.drifts.length, 0);
  const ok = driftCount === 0;

  await prisma.reconciliationRun.update({
    where: { id: run.id },
    data: {
      finishedAt: new Date(),
      checks: checks as unknown as Prisma.InputJsonValue,
      driftCount,
      ok,
    },
  });

  const outcome: ReconciliationOutcome = {
    runId: run.id,
    ok,
    driftCount,
    windowFrom: from.toISOString(),
    windowTo: to.toISOString(),
    checks,
  };

  await writeAudit(prisma, {
    actor: "system",
    entity: "ReconciliationRun",
    entityId: run.id,
    action: "reconciliation.completed",
    after: {
      ok,
      driftCount,
      checks: checks.map((c) => ({ name: c.name, checked: c.checked, drifts: c.drifts.length })),
    },
  });

  if (!ok) {
    const notify = options.notify ?? ((o) => sendReconciliationDrift(o));
    // An alert that throws must not hide the finding it was about.
    await notify(outcome).catch((err) =>
      console.error("[reconciliation] alert failed", err),
    );
  }

  return outcome;
}

/** The operator's page: the last runs, newest first. */
export async function readReconciliationRuns(limit = 30) {
  const runs = await prisma.reconciliationRun.findMany({
    orderBy: { startedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
  });
  return runs.map((r) => ({
    id: r.id,
    scope: r.scope,
    windowFrom: r.windowFrom.toISOString(),
    windowTo: r.windowTo.toISOString(),
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    driftCount: r.driftCount,
    ok: r.ok,
    checks: (r.checks as unknown as CheckOutcome[]) ?? [],
  }));
}
