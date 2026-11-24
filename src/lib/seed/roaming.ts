import { Prisma, type PrismaClient } from "@prisma/client";
import type { SeedResult } from "./producers";

// Clearing corridors between the seeded trading zones (ТЗ §8 "Роуминг",
// US-11). Directional: the fee for spending SK-bought kWh in UA is not the
// same as the reverse, because the clearing risk is not symmetric.
//
// §18 and §26 leave the roaming partners and the exact fees open, so these
// are placeholders with the right shape — the operator edits them once the
// OCPI partners are signed. The UA corridors carry the higher fee the
// Ukrainian legal plan assumes for cross-border settlement.
export type RoamingAgreementSeedRow = {
  homeZoneCode: string;
  visitedZoneCode: string;
  partnerName: string;
  feePct: number;
  dailyLimitKwh: number | null;
};

export const ROAMING_AGREEMENT_SEED: RoamingAgreementSeedRow[] = [
  { homeZoneCode: "SK", visitedZoneCode: "LT", partnerName: "poolwatt-clearing-eu", feePct: 2, dailyLimitKwh: 500 },
  { homeZoneCode: "LT", visitedZoneCode: "SK", partnerName: "poolwatt-clearing-eu", feePct: 2, dailyLimitKwh: 500 },
  { homeZoneCode: "SK", visitedZoneCode: "UA", partnerName: "poolwatt-clearing-ua", feePct: 5, dailyLimitKwh: 200 },
  { homeZoneCode: "UA", visitedZoneCode: "SK", partnerName: "poolwatt-clearing-ua", feePct: 5, dailyLimitKwh: 200 },
  { homeZoneCode: "LT", visitedZoneCode: "UA", partnerName: "poolwatt-clearing-ua", feePct: 5, dailyLimitKwh: 200 },
  { homeZoneCode: "UA", visitedZoneCode: "LT", partnerName: "poolwatt-clearing-ua", feePct: 5, dailyLimitKwh: 200 },
];

/**
 * Idempotent, and tolerant of a zone that is not seeded yet: a corridor to a
 * market Poolwatt has not opened is skipped rather than failing the seed run.
 */
export async function seedRoamingAgreements(
  prisma: PrismaClient,
  rows: RoamingAgreementSeedRow[],
): Promise<SeedResult> {
  let created = 0;
  for (const row of rows) {
    const home = await prisma.gridZone.findUnique({ where: { code: row.homeZoneCode } });
    const visited = await prisma.gridZone.findUnique({ where: { code: row.visitedZoneCode } });
    if (!home || !visited || home.id === visited.id) continue;

    const existing = await prisma.roamingAgreement.findUnique({
      where: { homeZoneId_visitedZoneId: { homeZoneId: home.id, visitedZoneId: visited.id } },
    });
    if (existing) continue;

    await prisma.roamingAgreement.create({
      data: {
        homeZoneId: home.id,
        visitedZoneId: visited.id,
        partnerName: row.partnerName,
        feePct: new Prisma.Decimal(row.feePct),
        dailyLimitKwh: row.dailyLimitKwh == null ? null : new Prisma.Decimal(row.dailyLimitKwh),
      },
    });
    created += 1;
  }
  return { created, skipped: rows.length - created };
}
