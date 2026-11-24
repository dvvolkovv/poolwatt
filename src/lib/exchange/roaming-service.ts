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
import { roamingQuote, type RoamingQuote } from "./roaming";
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

  // §24.2 — the agreement's cap applies per session here; cumulative per-day
  // tracking lands with roaming settlement, which records the actual debits.
  const limitKwh = numOrNull(agreement.dailyLimitKwh);
  if (limitKwh != null && quote.amountKwh > limitKwh) {
    throw new Error(
      `Roaming limit for ${home.code}→${visited.code} is ${limitKwh} kWh per session`,
    );
  }

  return {
    homeZoneId: home.id,
    homeZoneCode: home.code,
    visitedZoneId: visited.id,
    visitedZoneCode: visited.code,
    partnerName: agreement.partnerName,
    feePct: num(agreement.feePct),
    limitKwh,
    homeBalanceKwh,
    quote,
  };
}
