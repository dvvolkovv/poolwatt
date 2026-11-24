// The station console — ТЗ §30 ("Страница мониторинга и пульт управления
// станцией"), US-18 and US-26.
//
// Everything here is read-only and derived from what the asset actually
// reported: readings that passed validation, the batches they minted, and the
// trades those batches were sold in. Nothing is estimated.

import { ReadingValidationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Db } from "./audit";
import { num } from "./decimal";
import { roundKwh, roundMoney, roundPrice } from "./precision";

/** US-18 — "задержка данных не больше 15 минут". */
const STALE_AFTER_MS = 15 * 60 * 1000;

export interface StationRevenue {
  soldKwh: number;
  /** Gross value of the sold batches, before the seller's fee. */
  gross: number;
  /** What actually reached the wallet: gross less the seller's share of fees. */
  net: number;
  avgPrice: number | null;
  currency: string;
}

export interface StationOverview {
  assetId: string;
  name: string;
  capacityKw: number;
  intervalMinutes: number;
  /** Power of the most recent valid interval, in kW; null if none ever came. */
  nowKw: number | null;
  lastReadingAt: Date | null;
  /** True when an asset that has reported before has gone quiet (US-18). */
  stale: boolean;
  todayKwh: number;
  weekKwh: number;
  monthKwh: number;
  yearKwh: number;
  /** Generation against the nameplate over the last 24 hours, 0…1. */
  efficiency: number | null;
  revenue: StationRevenue;
}

export type SeriesRange = "day" | "week" | "month";

export interface GenerationSeries {
  range: SeriesRange;
  bucket: "interval" | "day";
  from: Date;
  to: Date;
  points: { at: Date; kwh: number }[];
}

function rangeStart(range: SeriesRange, now: Date): Date {
  const days = range === "day" ? 1 : range === "week" ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 3_600_000);
}

export async function readStationOverview(
  assetId: string,
  now = new Date(),
  db: Db = prisma,
): Promise<StationOverview> {
  const asset = await db.asset.findUniqueOrThrow({
    where: { id: assetId },
    include: { gridZone: { select: { intervalMinutes: true, currency: true } } },
  });

  const yearAgo = new Date(now.getTime() - 365 * 24 * 3_600_000);
  const readings = await db.meterReading.findMany({
    where: {
      assetId,
      validationStatus: ReadingValidationStatus.VALID,
      intervalStart: { gte: yearAgo, lte: now },
    },
    orderBy: { intervalStart: "desc" },
    select: { intervalStart: true, intervalEnd: true, energyKwh: true },
  });

  const sumSince = (since: Date) =>
    roundKwh(
      readings
        .filter((r) => r.intervalStart >= since)
        .reduce((total, r) => total + num(r.energyKwh), 0),
    );

  const last = readings[0] ?? null;
  const intervalMinutes = asset.gridZone.intervalMinutes;
  const nowKw = last
    ? roundPrice(num(last.energyKwh) / ((last.intervalEnd.getTime() - last.intervalStart.getTime()) / 3_600_000))
    : null;

  // An asset that has never reported is not stale — it has not started.
  const stale = last != null && now.getTime() - last.intervalEnd.getTime() > STALE_AFTER_MS;

  const dayKwh = sumSince(new Date(now.getTime() - 24 * 3_600_000));
  const capacity = num(asset.capacityKw);
  const efficiency = capacity > 0 ? Math.min(1, roundPrice(dayKwh / (capacity * 24))) : null;

  return {
    assetId,
    name: asset.name,
    capacityKw: capacity,
    intervalMinutes,
    nowKw,
    lastReadingAt: last?.intervalStart ?? null,
    stale,
    todayKwh: dayKwh,
    weekKwh: sumSince(new Date(now.getTime() - 7 * 24 * 3_600_000)),
    monthKwh: sumSince(new Date(now.getTime() - 30 * 24 * 3_600_000)),
    yearKwh: sumSince(yearAgo),
    efficiency,
    revenue: await readStationRevenue(assetId, asset.gridZone.currency, db),
  };
}

/**
 * What the asset's batches earned. A trade can consume several batches, so the
 * seller's fee is apportioned by volume — the asset pays only for its share.
 */
async function readStationRevenue(
  assetId: string,
  currency: string,
  db: Db,
): Promise<StationRevenue> {
  const sold = await db.energyToken.findMany({
    where: { assetId, soldTradeId: { not: null } },
    select: {
      amountKwh: true,
      soldTrade: { select: { id: true, price: true, amountKwh: true, sellerFee: true } },
    },
  });

  let soldKwh = 0;
  let gross = 0;
  let fees = 0;
  for (const batch of sold) {
    const trade = batch.soldTrade;
    if (!trade) continue;
    const kwh = num(batch.amountKwh);
    const tradeKwh = num(trade.amountKwh);
    soldKwh += kwh;
    gross += kwh * num(trade.price);
    fees += tradeKwh > 0 ? num(trade.sellerFee) * (kwh / tradeKwh) : 0;
  }

  soldKwh = roundKwh(soldKwh);
  const grossRounded = roundMoney(gross);
  return {
    soldKwh,
    gross: grossRounded,
    net: roundMoney(gross - fees),
    avgPrice: soldKwh > 0 ? roundPrice(gross / soldKwh) : null,
    currency,
  };
}

/**
 * US-18 — "график за день, неделю, месяц". A day is drawn per settlement
 * interval, a week and a month per day: more points than that is noise on a
 * chart the width of a phone.
 */
export async function generationSeries(
  assetId: string,
  range: SeriesRange,
  now = new Date(),
  db: Db = prisma,
): Promise<GenerationSeries> {
  const from = rangeStart(range, now);
  const readings = await db.meterReading.findMany({
    where: {
      assetId,
      validationStatus: ReadingValidationStatus.VALID,
      intervalStart: { gte: from, lte: now },
    },
    orderBy: { intervalStart: "asc" },
    select: { intervalStart: true, energyKwh: true },
  });

  if (range === "day") {
    return {
      range,
      bucket: "interval",
      from,
      to: now,
      points: readings.map((r) => ({ at: r.intervalStart, kwh: num(r.energyKwh) })),
    };
  }

  const byDay = new Map<number, number>();
  for (const r of readings) {
    const day = Date.UTC(
      r.intervalStart.getUTCFullYear(),
      r.intervalStart.getUTCMonth(),
      r.intervalStart.getUTCDate(),
    );
    byDay.set(day, (byDay.get(day) ?? 0) + num(r.energyKwh));
  }

  return {
    range,
    bucket: "day",
    from,
    to: now,
    points: [...byDay.entries()]
      .sort(([a], [b]) => a - b)
      .map(([day, kwh]) => ({ at: new Date(day), kwh: roundKwh(kwh) })),
  };
}
