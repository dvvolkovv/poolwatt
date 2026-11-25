// Roaming service — ТЗ §8 "Роуминг", §15 (POST /v1/roaming/quote), §24
// ("межзональный перевод — через правила роуминга"), US-11.
//
// The conversion arithmetic is in roaming.ts; this layer resolves which zones
// are involved, which clearing partner covers the corridor, and how much of
// the debit the user's home-zone balance can cover.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Db } from "./audit";
import { writeAudit } from "./audit";
import { num, numOrNull } from "./decimal";
import { roamingAffordableKwh, roamingQuote, type RoamingQuote } from "./roaming";
import { roundKwh, roundPrice } from "./precision";
import { requireZone } from "./zone-service";

export interface UpsertRoamingAgreementInput {
  homeZone: string;
  visitedZone: string;
  partnerName: string;
  feePct: number;
  dailyLimitKwh?: number | null;
  enabled?: boolean;
  actorUserId: string;
}

/** Operator-side configuration of a clearing corridor (§53). */
export async function upsertRoamingAgreement(
  input: UpsertRoamingAgreementInput,
  db: Db = prisma,
) {
  const home = await requireZone(input.homeZone, db);
  const visited = await requireZone(input.visitedZone, db);
  if (home.id === visited.id) throw new Error("A roaming agreement needs two different zones");

  const data = {
    partnerName: input.partnerName,
    feePct: new Prisma.Decimal(input.feePct),
    enabled: input.enabled ?? true,
    dailyLimitKwh:
      input.dailyLimitKwh == null ? null : new Prisma.Decimal(input.dailyLimitKwh),
  };

  const agreement = await db.roamingAgreement.upsert({
    where: { homeZoneId_visitedZoneId: { homeZoneId: home.id, visitedZoneId: visited.id } },
    update: data,
    create: { homeZoneId: home.id, visitedZoneId: visited.id, ...data },
  });
  await writeAudit(db, {
    actor: input.actorUserId,
    entity: "RoamingAgreement",
    entityId: agreement.id,
    action: "roaming.agreement.upsert",
    after: {
      homeZone: home.code,
      visitedZone: visited.code,
      partnerName: agreement.partnerName,
      feePct: num(agreement.feePct),
      dailyLimitKwh: numOrNull(agreement.dailyLimitKwh),
      enabled: agreement.enabled,
    },
  });
  return agreement;
}

/** Start of the calendar day the §24.2 cap is counted over (UTC). */
function startOfDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * §24.2 — visited-zone kWh this driver already took through this corridor
 * today. The cap is an AML limit per user per day, so it is counted from the
 * sessions that actually happened, not from the size of the one being asked
 * about.
 */
export async function roamingUsedTodayKwh(
  userId: string,
  agreementId: string,
  now: Date = new Date(),
  db: Db = prisma,
): Promise<number> {
  const used = await db.roamingSettlement.aggregate({
    where: { userId, agreementId, createdAt: { gte: startOfDay(now) } },
    _sum: { deliveredKwh: true },
  });
  return roundKwh(num(used._sum.deliveredKwh ?? 0));
}

export interface RoamingLegView {
  agreementId: string;
  partnerName: string;
  homeZoneId: string;
  homeZoneCode: string;
  homeWalletId: string;
  visitedZoneCode: string;
  conversionRate: number;
  feePct: number;
  homeBalanceKwh: number;
  /** What §24.2 still allows today, or null when the corridor has no cap. */
  allowanceKwh: number | null;
  /** Visited-zone kWh this corridor can serve right now. */
  maxKwh: number;
}

/**
 * The corridor a session in `visitedZoneId` can lean on, or null when there is
 * none — no kWh elsewhere, no agreement, no spot reference, or the day's
 * allowance already spent.
 *
 * When several corridors are open, the one that serves the larger part of the
 * session wins, and between two equal ones the cheaper conversion does: the
 * driver should not pay more because we picked a corridor alphabetically.
 */
export async function resolveRoamingLeg(
  input: { userId: string; visitedZoneId: string; now?: Date },
  db: Db = prisma,
): Promise<RoamingLegView | null> {
  const visited = await db.gridZone.findUnique({ where: { id: input.visitedZoneId } });
  if (!visited) return null;
  const visitedSpot = numOrNull(visited.spotPrice);
  if (visitedSpot == null || !(visitedSpot > 0)) return null;

  const wallets = await db.wallet.findMany({
    where: { ownerUserId: input.userId, zoneId: { not: visited.id } },
    include: { zone: true },
  });
  const funded = wallets.filter((w) => num(w.kwhBalance) > 0);
  if (funded.length === 0) return null;

  const agreements = await db.roamingAgreement.findMany({
    where: {
      visitedZoneId: visited.id,
      enabled: true,
      homeZoneId: { in: funded.map((w) => w.zoneId) },
    },
  });
  if (agreements.length === 0) return null;

  const now = input.now ?? new Date();
  const candidates: RoamingLegView[] = [];
  for (const agreement of agreements) {
    const wallet = funded.find((w) => w.zoneId === agreement.homeZoneId);
    if (!wallet) continue;
    const homeSpot = numOrNull(wallet.zone.spotPrice);
    if (homeSpot == null || !(homeSpot > 0)) continue;

    const conversionRate = roundPrice(visitedSpot / homeSpot);
    const feePct = num(agreement.feePct);
    const homeBalanceKwh = num(wallet.kwhBalance);
    const affordableKwh = roamingAffordableKwh(homeBalanceKwh, conversionRate, feePct);

    const limitKwh = numOrNull(agreement.dailyLimitKwh);
    let allowanceKwh: number | null = null;
    if (limitKwh != null) {
      const used = await roamingUsedTodayKwh(input.userId, agreement.id, now, db);
      allowanceKwh = Math.max(0, roundKwh(limitKwh - used));
    }

    const maxKwh =
      allowanceKwh == null ? affordableKwh : roundKwh(Math.min(affordableKwh, allowanceKwh));
    if (!(maxKwh > 0)) continue;

    candidates.push({
      agreementId: agreement.id,
      partnerName: agreement.partnerName,
      homeZoneId: wallet.zoneId,
      homeZoneCode: wallet.zone.code,
      homeWalletId: wallet.id,
      visitedZoneCode: visited.code,
      conversionRate,
      feePct,
      homeBalanceKwh,
      allowanceKwh,
      maxKwh,
    });
  }
  if (candidates.length === 0) return null;

  candidates.sort(
    (a, b) =>
      b.maxKwh - a.maxKwh ||
      a.conversionRate * (1 + a.feePct / 100) - b.conversionRate * (1 + b.feePct / 100),
  );
  return candidates[0];
}

export interface QuoteRoamingInput {
  userId: string;
  /** Zone id or code where the energy will be consumed. */
  visitedZone: string;
  amountKwh: number;
  /** Zone id or code holding the balance. Default: the user's richest wallet. */
  homeZone?: string;
}

export interface RoamingQuoteView {
  homeZoneId: string;
  homeZoneCode: string;
  visitedZoneId: string;
  visitedZoneCode: string;
  partnerName: string;
  feePct: number;
  limitKwh: number | null;
  /** §24.2 — what is left of the daily cap today, null when there is none. */
  allowanceKwh: number | null;
  homeBalanceKwh: number;
  quote: RoamingQuote;
}

/**
 * Price a roaming session for a user. Throws rather than returning a partial
 * answer: US-11 requires the user to see the conversion *before* confirming,
 * so an unpriceable corridor must surface as an error the app can explain,
 * not as a quote with holes in it.
 */
export async function quoteRoaming(
  input: QuoteRoamingInput,
  db: Db = prisma,
): Promise<RoamingQuoteView> {
  const visited = await requireZone(input.visitedZone, db);

  const wallets = await db.wallet.findMany({
    where: { ownerUserId: input.userId },
    include: { zone: true },
    orderBy: { kwhBalance: "desc" },
  });

  let home;
  if (input.homeZone) {
    home = await requireZone(input.homeZone, db);
  } else {
    // The home zone is wherever the kWh actually are: the richest wallet that
    // has a corridor to the visited zone.
    const candidates = wallets.filter((w) => w.zoneId !== visited.id);
    if (candidates.length === 0) {
      if (wallets.some((w) => w.zoneId === visited.id)) {
        throw new Error(
          `Your kWh are already in ${visited.code} — the same zone, no roaming conversion applies`,
        );
      }
      throw new Error("No wallet to roam from — buy kWh in your home zone first");
    }
    const agreements = await db.roamingAgreement.findMany({
      where: {
        visitedZoneId: visited.id,
        enabled: true,
        homeZoneId: { in: candidates.map((w) => w.zoneId) },
      },
      select: { homeZoneId: true },
    });
    const covered = new Set(agreements.map((a) => a.homeZoneId));
    home = candidates.find((w) => covered.has(w.zoneId))?.zone ?? candidates[0].zone;
  }

  if (home.id === visited.id) {
    throw new Error("Home and visited zone are the same zone — no roaming conversion applies");
  }

  const agreement = await db.roamingAgreement.findUnique({
    where: { homeZoneId_visitedZoneId: { homeZoneId: home.id, visitedZoneId: visited.id } },
  });
  if (!agreement || !agreement.enabled) {
    throw new Error(`No roaming agreement from ${home.code} to ${visited.code}`);
  }

  const homeBalanceKwh = num(wallets.find((w) => w.zoneId === home.id)?.kwhBalance ?? 0);
  const quote = roamingQuote({
    amountKwh: input.amountKwh,
    homeSpotPrice: numOrNull(home.spotPrice),
    visitedSpotPrice: numOrNull(visited.spotPrice),
    feePct: numOrNull(agreement.feePct),
    balanceKwh: homeBalanceKwh,
  });
  if (!quote) {
    throw new Error(
      `Cannot price roaming from ${home.code} to ${visited.code}: no spot reference published`,
    );
  }

  // §24.2 — the cap is per user per day, counted from the sessions already
  // settled through this corridor today.
  const limitKwh = numOrNull(agreement.dailyLimitKwh);
  let allowanceKwh: number | null = null;
  if (limitKwh != null) {
    const used = await roamingUsedTodayKwh(input.userId, agreement.id, new Date(), db);
    allowanceKwh = Math.max(0, roundKwh(limitKwh - used));
    if (quote.amountKwh > allowanceKwh) {
      throw new Error(
        `Roaming limit for ${home.code}→${visited.code} leaves ${allowanceKwh} kWh today (daily ${limitKwh} kWh)`,
      );
    }
  }

  return {
    homeZoneId: home.id,
    homeZoneCode: home.code,
    visitedZoneId: visited.id,
    visitedZoneCode: visited.code,
    partnerName: agreement.partnerName,
    feePct: num(agreement.feePct),
    limitKwh,
    allowanceKwh,
    homeBalanceKwh,
    quote,
  };
}
