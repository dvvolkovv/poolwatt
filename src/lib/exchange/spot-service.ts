// The zone's spot reference, stored and applied — ТЗ §6, §16.5.
//
// Two steps, deliberately apart:
//   * once an hour, fetch the day-ahead curve and store every interval;
//   * every few minutes, point the zone at the price of the interval we are
//     actually in, which is what the §16.5 corridor measures from.
//
// The history matters beyond the corridor: §16.7 settles a payment at the
// external spot price when the exchange has no liquidity, and an overwritten
// single number cannot answer "what was the price at 18:15 yesterday".
//
// Nothing here ever clears a price. A source that times out leaves yesterday's
// reference in place, because a missing reference switches the corridor off
// (see corridor.ts) and an open corridor is worse than a stale one.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "./audit";
import { num } from "./decimal";
import { spotFeedOpen } from "./gates";
import {
  type SpotSeries,
  entsoeRequestUrl,
  parseDayAheadPrices,
} from "./spot-entsoe";

export const ENTSOE_SOURCE = "entsoe";

/** A zone is on the feed when its source says so and it has an area code. */
export function zoneUsesSpotFeed(zone: {
  spotSource: string | null;
  spotAreaCode: string | null;
}): boolean {
  return (zone.spotSource ?? "manual").toLowerCase() === ENTSOE_SOURCE;
}

export async function storeSpotPoints(
  zoneId: string,
  series: SpotSeries,
  source: string,
): Promise<number> {
  for (const point of series.points) {
    await prisma.zoneSpotPrice.upsert({
      where: {
        zoneId_intervalStart_source: {
          zoneId,
          intervalStart: point.intervalStart,
          source,
        },
      },
      // A platform may publish a correction; the latest word wins.
      update: {
        price: new Prisma.Decimal(point.pricePerKwh),
        currency: series.currency,
        fetchedAt: new Date(),
      },
      create: {
        zoneId,
        intervalStart: point.intervalStart,
        price: new Prisma.Decimal(point.pricePerKwh),
        currency: series.currency,
        source,
      },
    });
  }
  return series.points.length;
}

/**
 * Point the zone at the stored price covering `now`, and return it.
 *
 * "Covering" means the newest interval that has already started and is not
 * older than a day: a price from last week is not a reference for today, but
 * the zone keeps whatever it had rather than losing its corridor.
 */
export async function applyCurrentSpot(zoneId: string, now = new Date()): Promise<number | null> {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const row = await prisma.zoneSpotPrice.findFirst({
    where: { zoneId, intervalStart: { lte: now, gte: dayAgo } },
    orderBy: { intervalStart: "desc" },
  });
  if (!row) return null;

  const price = num(row.price);
  await prisma.gridZone.update({
    where: { id: zoneId },
    data: { spotPrice: new Prisma.Decimal(price), spotPriceAt: row.intervalStart },
  });
  return price;
}

export type RefreshResult =
  | { status: "refreshed"; stored: number; applied: number | null }
  | { status: "skipped"; reason: "feed-closed" | "manual" | "no-area-code" }
  | { status: "failed"; error: string };

export interface RefreshOptions {
  /** Injected so tests never touch the network. */
  fetch?: (url: string) => Promise<string>;
  now?: Date;
  /** How far ahead to ask for, in hours. A day-ahead curve is published once. */
  horizonHours?: number;
}

async function defaultFetch(url: string): Promise<string> {
  const response = await fetch(url, { headers: { accept: "application/xml" } });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`ENTSO-E answered ${response.status}: ${body.slice(0, 200)}`);
  }
  return body;
}

/** One zone's hourly refresh. Never throws: a worker tick must survive it. */
export async function refreshZoneSpot(
  zoneId: string,
  options: RefreshOptions = {},
): Promise<RefreshResult> {
  if (!spotFeedOpen()) return { status: "skipped", reason: "feed-closed" };

  const zone = await prisma.gridZone.findUniqueOrThrow({ where: { id: zoneId } });
  if (!zoneUsesSpotFeed(zone)) return { status: "skipped", reason: "manual" };
  if (!zone.spotAreaCode) return { status: "skipped", reason: "no-area-code" };

  const now = options.now ?? new Date();
  const horizon = options.horizonHours ?? 36;
  // From the start of today, so a restart mid-day still fills the morning.
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + horizon * 60 * 60 * 1000);

  const url = entsoeRequestUrl({
    areaCode: zone.spotAreaCode,
    from,
    to,
    token: process.env.ENTSOE_TOKEN?.trim() ?? "",
  });

  try {
    const body = await (options.fetch ?? defaultFetch)(url);
    const series = parseDayAheadPrices(body);
    const stored = await storeSpotPoints(zone.id, series, ENTSOE_SOURCE);
    const applied = await applyCurrentSpot(zone.id, now);

    await writeAudit(prisma, {
      actor: "system",
      entity: "GridZone",
      entityId: zone.id,
      action: "zone.spot.refreshed",
      after: { stored, applied, source: ENTSOE_SOURCE },
    });
    return { status: "refreshed", stored, applied };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

/** Every zone on the feed, for the worker's hourly tick. */
export async function refreshAllZoneSpots(
  options: RefreshOptions = {},
): Promise<{ zone: string; result: RefreshResult }[]> {
  if (!spotFeedOpen()) return [];
  const zones = await prisma.gridZone.findMany({
    where: { spotSource: ENTSOE_SOURCE },
    select: { id: true, code: true },
  });
  const out: { zone: string; result: RefreshResult }[] = [];
  for (const zone of zones) {
    out.push({ zone: zone.code, result: await refreshZoneSpot(zone.id, options) });
  }
  return out;
}

/** Move every zone onto the price of the interval it is in (worker, 5 min). */
export async function applyCurrentSpotToAllZones(now = new Date()): Promise<number> {
  const zones = await prisma.gridZone.findMany({
    where: { spotSource: ENTSOE_SOURCE },
    select: { id: true },
  });
  let moved = 0;
  for (const zone of zones) {
    if ((await applyCurrentSpot(zone.id, now)) !== null) moved += 1;
  }
  return moved;
}

export interface SpotHistoryRow {
  intervalStart: string;
  price: number;
  currency: string;
  source: string;
  fetchedAt: string;
}

/** The operator's page: what the reference has been, newest first. */
export async function readSpotHistory(zoneId: string, limit = 48): Promise<SpotHistoryRow[]> {
  const rows = await prisma.zoneSpotPrice.findMany({
    where: { zoneId },
    orderBy: { intervalStart: "desc" },
    take: Math.min(Math.max(limit, 1), 500),
  });
  return rows.map((r) => ({
    intervalStart: r.intervalStart.toISOString(),
    price: num(r.price),
    currency: r.currency,
    source: r.source,
    fetchedAt: r.fetchedAt.toISOString(),
  }));
}
