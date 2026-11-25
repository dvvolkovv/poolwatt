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
import { closeInterval } from "@/lib/exchange/interval-close-service";
import { dispatchZone, withdrawStaleOffers } from "@/lib/exchange/dispatch-service";
import { detectLinkLoss, notifyPendingAlerts } from "@/lib/exchange/asset-alerts";
import {
  notifyPendingWorkOrders,
  openWorkOrdersForAlerts,
} from "@/lib/work/work-order-service";
import {
  closeExpiredReservations,
  notifyClosedReservations,
  remindAboutClosingWindow,
} from "@/lib/reservations/reservation-service";
import { reconcileRegistry } from "@/lib/exchange/reconciliation-service";
import { purgeIdempotencyRecords } from "@/lib/exchange/idempotency";
import { expireGrants, sweepPendingAwards } from "@/lib/marketing/campaign-engine";
import { notifyPendingGrants } from "@/lib/marketing/gift-mail";
import { notifyPendingRestockRequests } from "@/lib/warehouse/restock-mail";
import { applyCurrentSpotToAllZones, refreshAllZoneSpots } from "@/lib/exchange/spot-service";
import { intervalStartFor } from "@/lib/exchange/zone-service";
import { startTelemetrySubscriber } from "./mqtt";
import { notifyPendingReceipts } from "@/lib/receipts/receipt-delivery";

function log(...args: unknown[]) {
  console.log(`[worker]`, ...args);
}

/**
 * Settle the intervals that have ended — ТЗ §16.4, §30, US-28.
 *
 * Three steps per zone, in this order:
 *
 * 1. Offer the market share of the interval that just ended (§30 sale rules).
 *    Energy is minted from readings that only arrive after the interval is
 *    over, so this is the first moment it can be sold at all.
 * 2. Take down the offers made one interval earlier that nobody took.
 * 3. Close that earlier interval: whatever is now free is routed to storage
 *    or the aggregator (§16.4).
 *
 * So an offer gets exactly one interval to find a buyer, and §16.4 catches
 * what it does not — the dispatcher delays routing by one interval, it never
 * cancels it. Each zone has its own interval length (§18).
 */
export async function runIntervalClose(now = new Date()): Promise<void> {
  const zones = await prisma.gridZone.findMany();
  for (const zone of zones) {
    const step = zone.intervalMinutes * 60 * 1000;
    const currentStart = intervalStartFor(now, zone.intervalMinutes);
    const endedStart = new Date(currentStart.getTime() - step);
    const earlierStart = new Date(endedStart.getTime() - step);

    try {
      const dispatched = await dispatchZone(zone.id, endedStart);
      if (dispatched.offeredKwh > 0) {
        log(
          `${zone.code} ${dispatched.intervalStart}: offered=${dispatched.offeredKwh} kWh from ${dispatched.offers.length} asset(s)`,
        );
      }
    } catch (err) {
      console.error(`[worker] dispatch failed for ${zone.code}:`, err);
    }

    try {
      await withdrawStaleOffers(zone.id, earlierStart);
      const result = await closeInterval(zone.id, earlierStart);
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

/**
 * §16.11 — the nightly check of the registry against the readings it was
 * issued from. Four checks, a recorded run, and mail to the operator on
 * drift; nothing is ever repaired here.
 */
export async function runReconciliation(): Promise<void> {
  const outcome = await reconcileRegistry({ scope: "daily" });
  const summary = outcome.checks
    .map((c) => `${c.name}=${c.drifts.length}/${c.checked}`)
    .join(" ");
  if (outcome.ok) {
    log(`reconciliation: no drift (${summary})`);
    return;
  }
  // Drift means a bug upstream, so it is reported loudly and never auto-fixed.
  console.error(
    `[worker] RECONCILIATION DRIFT: ${outcome.driftCount} finding(s) — ${summary}. ` +
      `See /admin/reconciliation (run ${outcome.runId}).`,
  );
}

/**
 * §6, §16.5 — pull the day-ahead curve for every zone on the feed. Silent
 * while ENTSOE_TOKEN is unset: zones then keep their manual reference.
 */
export async function runSpotRefresh(): Promise<void> {
  const results = await refreshAllZoneSpots();
  for (const { zone, result } of results) {
    if (result.status === "refreshed") {
      log(`spot ${zone}: stored=${result.stored} applied=${result.applied ?? "none"}`);
    } else if (result.status === "failed") {
      // Not fatal: the previous reference stands, the corridor keeps working.
      console.error(`[worker] spot ${zone} failed: ${result.error}`);
    }
  }
}

/** Move each zone onto the reference of the interval it is in. */
export async function runSpotApply(): Promise<void> {
  const moved = await applyCurrentSpotToAllZones();
  if (moved > 0) log(`spot: ${moved} zone(s) moved to the current interval`);
}

/**
 * §30 / US-29 — "push и email в течение минуты после события".
 *
 * Runs every minute: it finds equipment that has gone quiet and tells people
 * about every alarm that still owes a notification, including ones raised a
 * moment ago by telemetry ingestion.
 */
export async function runAlertSweep(now = new Date()): Promise<void> {
  try {
    const raised = await detectLinkLoss(now);
    if (raised > 0) log(`alerts: ${raised} asset(s) went quiet`);
  } catch (err) {
    console.error("[worker] link-loss detection failed:", err);
  }
  try {
    const notified = await notifyPendingAlerts();
    if (notified > 0) log(`alerts: ${notified} notification(s) sent`);
  } catch (err) {
    console.error("[worker] alert notification failed:", err);
  }

  // §48 / US-48 — an alarm becomes a work order, and the engineer hears about
  // it in the same minute.
  try {
    const opened = await openWorkOrdersForAlerts();
    if (opened > 0) log(`work orders: ${opened} opened from alarms`);
  } catch (err) {
    console.error("[worker] opening work orders failed:", err);
  }
  try {
    const told = await notifyPendingWorkOrders();
    if (told > 0) log(`work orders: ${told} notification(s) sent`);
  } catch (err) {
    console.error("[worker] work order notification failed:", err);
  }

  // §46 / US-45 — "чек формируется в течение минуты после зарядки": the
  // inline attempt happens in the payment path, and this is what makes the
  // minute hold when that attempt failed.
  try {
    const sent = await notifyPendingReceipts();
    if (sent > 0) log(`receipts: ${sent} delivered`);
  } catch (err) {
    console.error("[worker] receipt delivery failed:", err);
  }

  // §45 / US-41 — "начисление в течение минуты после завершения зарядки".
  // The inline attempt runs in the payment path; this is what makes the
  // minute hold when it failed, and what tells the driver about the gift.
  try {
    const looked = await sweepPendingAwards();
    if (looked.length > 0) log(`campaigns: ${looked.length} charge(s) evaluated`);
  } catch (err) {
    console.error("[worker] campaign award sweep failed:", err);
  }
  try {
    const told = await notifyPendingGrants();
    if (told > 0) log(`campaigns: ${told} gift notification(s) sent`);
  } catch (err) {
    console.error("[worker] gift notification failed:", err);
  }

  // §35 / US-33 — a booking whose window has closed with nobody there.
  try {
    const closed = await closeExpiredReservations(now);
    if (closed > 0) log(`reservations: ${closed} closed as no-show`);
  } catch (err) {
    console.error("[worker] closing reservations failed:", err);
  }
  try {
    const told = await notifyClosedReservations();
    if (told > 0) log(`reservations: ${told} notification(s) sent`);
  } catch (err) {
    console.error("[worker] reservation notification failed:", err);
  }

  // §49 / US-50 — a store below its minimum raised a request; tell whoever
  // keeps it. The request itself was written in the same transaction as the
  // movement that caused it, so nothing here can lose one.
  try {
    const told = await notifyPendingRestockRequests();
    if (told > 0) log(`stock: ${told} restock notification(s) sent`);
  } catch (err) {
    console.error("[worker] restock notification failed:", err);
  }

  // §32.4 / US-31 — ten minutes before the window closes, offer to extend.
  try {
    const told = await remindAboutClosingWindow();
    if (told > 0) log(`reservations: ${told} closing reminder(s) sent`);
  } catch (err) {
    console.error("[worker] closing reminder failed:", err);
  }
}

/**
 * §43 — "Сгорает по истечении срока; сгоревший объём возвращается в бюджет
 * кампании партнёра." Hourly is enough: a grant's life is counted in days,
 * and an hour of grace costs the partner nothing.
 */
export async function runGrantExpiry(): Promise<void> {
  const expired = await expireGrants();
  if (expired.length > 0) log(`campaigns: ${expired.length} gift(s) expired`);
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
    void runSpotApply();
  });

  // §30 / US-29 — an alarm has to reach the engineer within a minute.
  cron.schedule("* * * * *", () => {
    void runAlertSweep();
  });

  // §6, §16.5 — the day-ahead curve is published once a day, but a retry an
  // hour later is what makes a missed publication harmless.
  cron.schedule("10 * * * *", () => {
    void runSpotRefresh();
  });

  // §43 — gifts burn on their own schedule, checked every hour.
  cron.schedule("20 * * * *", () => {
    void runGrantExpiry();
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
  await runSpotRefresh();
  log(
    "schedules registered: interval close + spot apply */5 min, alerts, work orders, receipts + reservations + campaign gifts every min, spot refresh :10, gift expiry :20, reconciliation 03:15, idempotency purge 03:40",
  );
}

main().catch((err) => {
  console.error("[worker] FATAL:", err);
  process.exit(1);
});
