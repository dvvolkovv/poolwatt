#!/usr/bin/env tsx
// The grid worker — ТЗ §6 and §16.4 (automatic interval close), §16.11
// (daily reconciliation of the token registry).
//
// Standalone Node entrypoint, so it loads both .env files explicitly:
// `import "dotenv/config"` only picks up .env, and DATABASE_URL lives in
// .env.local (see CLAUDE.md "dotenv + .env.local").

import { config as loadDotenv } from "dotenv";

loadDotenv({ path: ".env" });
loadDotenv({ path: ".env.local", override: true });

import cron from "node-cron";
import { prisma } from "@/lib/prisma";
import { closeInterval, reconcileWalletBalances } from "@/lib/exchange/interval-close-service";
import { purgeIdempotencyRecords } from "@/lib/exchange/idempotency";
import { intervalStartFor } from "@/lib/exchange/zone-service";
import { startTelemetrySubscriber } from "./mqtt";

function log(...args: unknown[]) {
  console.log(`[worker]`, ...args);
}

/**
 * Close every interval that has ended but not yet been settled.
 *
 * The worker closes the interval *before* the current one: the current one is
 * still open for trading. Each zone has its own interval length (§18), so the
 * boundary is computed per zone.
 */
export async function runIntervalClose(now = new Date()): Promise<void> {
  const zones = await prisma.gridZone.findMany();
  for (const zone of zones) {
    const currentStart = intervalStartFor(now, zone.intervalMinutes);
    const closedStart = new Date(
      currentStart.getTime() - zone.intervalMinutes * 60 * 1000,
    );
    try {
      const result = await closeInterval(zone.id, closedStart);
      if (result.allocations > 0 || result.expiredOrders > 0) {
        log(
          `${zone.code} ${result.intervalStart}: expired=${result.expiredOrders} unsold=${result.unsoldKwh} stored=${result.storedKwh} routed=${result.routedKwh}`,
        );
      }
    } catch (err) {
      console.error(`[worker] interval close failed for ${zone.code}:`, err);
    }
  }
}

/** §16.11 — report any drift between wallet balances and the token registry. */
export async function runReconciliation(): Promise<void> {
  const drifts = await reconcileWalletBalances();
  if (drifts.length === 0) {
    log("reconciliation: no drift");
    return;
  }
  // Drift means a bug upstream, so it is reported loudly and never auto-fixed.
  console.error(`[worker] RECONCILIATION DRIFT on ${drifts.length} wallet(s):`, drifts);
}

/** §15 — the replay log is a log, not a financial record: 30 days is plenty. */
export async function runIdempotencyPurge(): Promise<void> {
  const removed = await purgeIdempotencyRecords();
  if (removed > 0) log(`idempotency: purged ${removed} expired record(s)`);
}

async function main() {
  log(`starting. cwd=${process.cwd()}`);

  // Every 5 minutes: the shortest zone interval is 15 min, so this closes an
  // interval within 5 minutes of its end — inside the §17 budget of "до токена
  // 5 минут после конца интервала".
  cron.schedule("*/5 * * * *", () => {
    void runIntervalClose();
  });

  // Daily registry reconciliation (§16.11), at 03:15 local time.
  cron.schedule("15 3 * * *", () => {
    void runReconciliation();
  });

  // Daily purge of the idempotency replay log (§15), at 03:40.
  cron.schedule("40 3 * * *", () => {
    void runIdempotencyPurge();
  });

  // §4 / US-03 — MQTT intake, when a broker is configured.
  startTelemetrySubscriber();

  // Run once at boot so a restart does not leave a stale interval open.
  await runIntervalClose();
  log("schedules registered: interval close */5 min, reconciliation 03:15, idempotency purge 03:40");
}

main().catch((err) => {
  console.error("[worker] FATAL:", err);
  process.exit(1);
});
