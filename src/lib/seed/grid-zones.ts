import { Prisma, type PrismaClient } from "@prisma/client";
import type { SeedResult } from "./producers";

// Trading zones for the exchange (ТЗ §13 GridZone, §18 "Первая торговая зона").
//
// §18 leaves the first trading zone and its spot source open. These are the
// markets Poolwatt already has partners or a legal plan for: Slovakia and
// Lithuania (the EMI licence seat) plus Ukraine, which the Ukrainian legal
// plan covers. `spotPrice` is a placeholder reference until the ENTSO-E feed
// is wired; the corridor (§16.5) is therefore deliberately wide.
export type GridZoneSeedRow = {
  code: string;
  country: string;
  name: string;
  currency: string;
  spotSource: string;
  intervalMinutes: number;
  corridorPct: number;
  spotPrice: number;
  aggregatorName: string;
};

export const GRID_ZONE_SEED: GridZoneSeedRow[] = [
  {
    code: "SK",
    country: "SK",
    name: "Slovakia",
    currency: "EUR",
    spotSource: "entsoe:10YSK-SEPS-----K",
    intervalMinutes: 15,
    corridorPct: 30,
    spotPrice: 0.18,
    aggregatorName: "sk-aggregator",
  },
  {
    code: "LT",
    country: "LT",
    name: "Lithuania",
    currency: "EUR",
    spotSource: "entsoe:10YLT-1001A0008Q",
    intervalMinutes: 15,
    corridorPct: 30,
    spotPrice: 0.16,
    aggregatorName: "lt-aggregator",
  },
  {
    code: "UA",
    country: "UA",
    name: "Ukraine",
    currency: "EUR",
    spotSource: "oree:ua-ips",
    intervalMinutes: 60,
    corridorPct: 40,
    spotPrice: 0.11,
    aggregatorName: "ua-aggregator",
  },
];

export async function seedGridZones(
  prisma: PrismaClient,
  rows: GridZoneSeedRow[],
): Promise<SeedResult> {
  let created = 0;
  for (const row of rows) {
    const existing = await prisma.gridZone.findUnique({ where: { code: row.code } });
    if (existing) continue;
    await prisma.gridZone.create({
      data: {
        code: row.code,
        country: row.country,
        name: row.name,
        currency: row.currency,
        spotSource: row.spotSource,
        intervalMinutes: row.intervalMinutes,
        corridorPct: new Prisma.Decimal(row.corridorPct),
        spotPrice: new Prisma.Decimal(row.spotPrice),
        spotPriceAt: new Date(),
        aggregatorName: row.aggregatorName,
      },
    });
    created += 1;
  }
  return { created, skipped: rows.length - created };
}

// §16.8 / §53 — platform commission per participant type.
export type FeePlanSeedRow = {
  name: string;
  participantType: "PRODUCER" | "WHOLESALE" | "COOPERATIVE" | "OPERATOR" | null;
  tradeFeePct: number;
  chargeFeePct: number;
  isDefault: boolean;
};

export const FEE_PLAN_SEED: FeePlanSeedRow[] = [
  { name: "standard", participantType: null, tradeFeePct: 1, chargeFeePct: 2, isDefault: true },
  { name: "producer", participantType: "PRODUCER", tradeFeePct: 0.5, chargeFeePct: 2, isDefault: false },
  { name: "wholesale", participantType: "WHOLESALE", tradeFeePct: 0.25, chargeFeePct: 1, isDefault: false },
  { name: "cooperative", participantType: "COOPERATIVE", tradeFeePct: 0.25, chargeFeePct: 1, isDefault: false },
];

export async function seedFeePlans(
  prisma: PrismaClient,
  rows: FeePlanSeedRow[],
): Promise<SeedResult> {
  let created = 0;
  for (const row of rows) {
    const existing = await prisma.feePlan.findUnique({ where: { name: row.name } });
    if (existing) continue;
    await prisma.feePlan.create({
      data: {
        name: row.name,
        participantType: row.participantType,
        tradeFeePct: new Prisma.Decimal(row.tradeFeePct),
        chargeFeePct: new Prisma.Decimal(row.chargeFeePct),
        isDefault: row.isDefault,
      },
    });
    created += 1;
  }
  return { created, skipped: rows.length - created };
}
