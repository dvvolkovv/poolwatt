// The tariff journal — ТЗ §54, "Любое изменение тарифа версионируется: новые
// сделки идут по новой версии, текущие брони и заявки — по старой."
//
// One writer for every tariff in the system. A change is recorded in the same
// transaction as the live table it mirrors, so the journal and the tariff can
// never disagree about whether something happened.
//
// Reading is the other half: `pricingAt` is how a receipt, a booking or a
// payout finds the numbers it was made under, instead of whatever the partner
// has set since.

import type { Prisma, PricingScope } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Db } from "@/lib/exchange/audit";

export class PricingError extends Error {}

export interface PricingChange {
  scope: PricingScope;
  /** The point, network or asset the rule is about. */
  scopeId: string;
  operatorId?: string | null;
  companyId?: string | null;
  /** Whatever the person set, verbatim. A snapshot, never a reference. */
  params: Prisma.InputJsonValue;
  actorId?: string | null;
  note?: string | null;
}

export interface PricingVersion {
  id: string;
  scope: PricingScope;
  scopeId: string;
  operatorId: string | null;
  companyId: string | null;
  version: number;
  params: Prisma.JsonValue;
  activeFrom: Date;
  createdById: string | null;
  note: string | null;
}

/** How many times a lost version race is retried before giving up. */
const VERSION_RETRIES = 5;

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002"
  );
}

/**
 * Append the next version of one rule.
 *
 * `db` is the caller's transaction whenever there is one: a version written
 * next to a live update that then rolls back would claim a price change that
 * never reached anybody.
 *
 * The version number comes from the rows themselves rather than a counter, and
 * the unique index is what settles a tie — two partners saving at the same
 * moment both read version 3 and one of them loses, retries, and becomes 4.
 */
export async function recordPricingChange(
  db: Db,
  change: PricingChange,
): Promise<PricingVersion> {
  if (!change.scopeId) throw new PricingError("A rule has to be about something");
  if (!change.operatorId && !change.companyId) {
    throw new PricingError("A tariff nobody set is not a tariff: name the network or the company");
  }

  for (let attempt = 0; attempt < VERSION_RETRIES; attempt++) {
    const latest = await db.pricingRule.findFirst({
      where: { scope: change.scope, scopeId: change.scopeId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = (latest?.version ?? 0) + 1;

    try {
      return await db.pricingRule.create({
        data: {
          scope: change.scope,
          scopeId: change.scopeId,
          operatorId: change.operatorId ?? null,
          companyId: change.companyId ?? null,
          version,
          params: change.params,
          createdById: change.actorId ?? null,
          note: change.note?.trim() || null,
        },
      });
    } catch (err) {
      // Inside somebody's transaction a failed statement aborts the whole
      // thing, so there is nothing to retry — let it out.
      if (!isUniqueViolation(err) || isTransaction(db)) throw err;
    }
  }

  throw new PricingError("Could not take the next version number; try again");
}

/** A transaction client has no `$transaction` of its own. */
function isTransaction(db: Db): boolean {
  return !("$transaction" in db);
}

/**
 * The version that was in force at a moment, or null if the rule had not been
 * set yet. A moment in the future gets the newest version, which is what
 * "price this new session" means.
 */
export async function pricingAt(
  scope: PricingScope,
  scopeId: string,
  at: Date,
  db: Db = prisma,
): Promise<PricingVersion | null> {
  return db.pricingRule.findFirst({
    where: { scope, scopeId, activeFrom: { lte: at } },
    orderBy: [{ activeFrom: "desc" }, { version: "desc" }],
  });
}

/** One specific version, by number — what a stamped payment or booking cites. */
export async function pricingVersion(
  scope: PricingScope,
  scopeId: string,
  version: number,
  db: Db = prisma,
): Promise<PricingVersion | null> {
  return db.pricingRule.findUnique({
    where: { scope_scopeId_version: { scope, scopeId, version } },
  });
}

/** The current version of one rule, whatever that is now. */
export async function currentPricing(
  scope: PricingScope,
  scopeId: string,
  db: Db = prisma,
): Promise<PricingVersion | null> {
  return db.pricingRule.findFirst({
    where: { scope, scopeId },
    orderBy: { version: "desc" },
  });
}

/** The history of one rule, newest first — what the partner reads. */
export async function readPricingHistory(
  scope: PricingScope,
  scopeId: string,
  take = 100,
): Promise<PricingVersion[]> {
  return prisma.pricingRule.findMany({
    where: { scope, scopeId },
    orderBy: { version: "desc" },
    take,
  });
}

/** Everything one network has ever set, across every scope. */
export async function readNetworkPricing(
  operatorId: string,
  take = 200,
): Promise<PricingVersion[]> {
  return prisma.pricingRule.findMany({
    where: { operatorId },
    orderBy: [{ activeFrom: "desc" }, { version: "desc" }],
    take,
  });
}

/** Everything one company has ever set about its assets (§30 sale rules). */
export async function readCompanyPricing(
  companyId: string,
  take = 200,
): Promise<PricingVersion[]> {
  return prisma.pricingRule.findMany({
    where: { companyId },
    orderBy: [{ activeFrom: "desc" }, { version: "desc" }],
    take,
  });
}
