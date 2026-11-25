// Issuing and burning promo kWh — ТЗ §42 (the gift constructor), §43 (the
// promo token), US-41.
//
// A grant is a right, not a balance: see the comment on `PromoGrant` in the
// schema. This file only decides *whether* a driver has earned one and what
// happens when it runs out of time; spending it is `grant-spend.ts`.

import { type Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { type Db, writeAudit } from "@/lib/exchange/audit";
import { num } from "@/lib/exchange/decimal";
import { roundKwh } from "@/lib/exchange/precision";

/** How many captured charges the worker looks at in one pass. */
const SWEEP_BATCH = 200;

type CampaignRow = {
  id: string;
  operatorId: string;
  trigger: "FIRST_CHARGE" | "NTH_CHARGE" | "VOLUME_PERIOD";
  triggerN: number | null;
  triggerPeriodDays: number | null;
  giftKwh: Prisma.Decimal;
  scopePointIds: string[];
  validityDays: number;
  oncePerClient: boolean;
  budgetKwh: Prisma.Decimal;
  issuedKwh: Prisma.Decimal;
};

/**
 * Has this driver earned this campaign's gift with this charge?
 *
 * Every trigger is counted over the captured charges at the points of the
 * campaign's own network — a charge somewhere else is not this partner's
 * business, which is the issue-time half of US-43.
 */
async function triggerFired(
  db: Db,
  campaign: CampaignRow,
  args: { userId: string; paymentId: string; capturedAt: Date },
): Promise<boolean> {
  const inNetwork = {
    wallet: { ownerUserId: args.userId },
    status: "CAPTURED" as const,
    point: {
      operatorId: campaign.operatorId,
      ...(campaign.scopePointIds.length > 0 ? { id: { in: campaign.scopePointIds } } : {}),
    },
  };

  if (campaign.trigger === "VOLUME_PERIOD") {
    const days = campaign.triggerPeriodDays ?? 30;
    const target = campaign.triggerN ?? 0;
    const since = new Date(args.capturedAt.getTime() - days * 86_400_000);
    const sum = await db.payment.aggregate({
      where: { ...inNetwork, capturedAt: { gte: since, lte: args.capturedAt } },
      _sum: { kwhFromBalance: true, kwhBought: true },
    });
    const total = num(sum._sum.kwhFromBalance ?? 0) + num(sum._sum.kwhBought ?? 0);
    return target > 0 && total >= target;
  }

  // Charges up to and including this one. Counting by `capturedAt` would tie
  // on two sessions captured in the same millisecond, so the payment's own id
  // breaks the tie the same way for both.
  const count = await db.payment.count({
    where: {
      ...inNetwork,
      OR: [
        { capturedAt: { lt: args.capturedAt } },
        { capturedAt: args.capturedAt, id: { lte: args.paymentId } },
      ],
    },
  });

  if (campaign.trigger === "FIRST_CHARGE") return count === 1;
  return count === (campaign.triggerN ?? 1);
}

/**
 * US-41 — look at the campaigns of the network a charge just happened in, and
 * issue whatever the driver earned. Returns the ids of the grants created.
 *
 * Safe to call twice: the payment carries the mark that it was looked at, and
 * "once per client" is a unique index rather than a check two simultaneous
 * charges could both pass.
 */
export async function awardAfterCharge(paymentId: string): Promise<string[]> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      status: true,
      capturedAt: true,
      campaignsEvaluatedAt: true,
      pointId: true,
      point: { select: { id: true, operatorId: true } },
      wallet: { select: { ownerUserId: true } },
    },
  });
  if (!payment) return [];
  if (payment.campaignsEvaluatedAt) return [];

  // Not a charge, or a charge in nobody's network: §42's triggers have
  // nothing to count and §43 has no network to bind a grant to.
  if (payment.status !== "CAPTURED" || !payment.point || !payment.capturedAt) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { campaignsEvaluatedAt: new Date() },
    });
    return [];
  }

  const now = new Date();
  const userId = payment.wallet.ownerUserId;
  const candidates = await prisma.campaign.findMany({
    where: {
      operatorId: payment.point.operatorId,
      status: "ACTIVE",
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    orderBy: { createdAt: "asc" },
  });

  const granted: string[] = [];

  for (const campaign of candidates) {
    // §42 "Где действует" — the whole network, or named points.
    if (
      campaign.scopePointIds.length > 0 &&
      !campaign.scopePointIds.includes(payment.point.id)
    ) {
      continue;
    }

    if (!(await triggerFired(prisma, campaign, {
      userId,
      paymentId: payment.id,
      capturedAt: payment.capturedAt,
    }))) {
      continue;
    }

    const grantId = await issueGrant(campaign, userId, payment.id);
    if (grantId) granted.push(grantId);
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { campaignsEvaluatedAt: new Date() },
  });

  return granted;
}

/**
 * One grant, budget and all, in a single transaction.
 *
 * §42 "кампания останавливается при исчерпании": the campaign's own counter is
 * the budget, so the check and the increment have to be the same write — two
 * drivers finishing at once must not both fit into the last 5 kWh.
 */
async function issueGrant(
  campaign: CampaignRow,
  userId: string,
  paymentId: string,
): Promise<string | null> {
  try {
    return await prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string; issued: string; budget: string; status: string }[]>`
        SELECT id, "issuedKwh"::text AS issued, "budgetKwh"::text AS budget, status::text AS status
        FROM "Campaign" WHERE id = ${campaign.id} FOR UPDATE
      `;
      if (!locked || locked.status !== "ACTIVE") return null;

      const gift = num(campaign.giftKwh);
      const issued = Number(locked.issued);
      const budget = Number(locked.budget);
      if (roundKwh(issued + gift) > roundKwh(budget)) {
        // Nothing left to promise. Say so once, so the partner sees why.
        await tx.campaign.update({
          where: { id: campaign.id },
          data: { status: "EXHAUSTED" },
        });
        return null;
      }

      const expiresAt = new Date(Date.now() + campaign.validityDays * 86_400_000);
      const grant = await tx.promoGrant.create({
        data: {
          campaignId: campaign.id,
          userId,
          operatorId: campaign.operatorId,
          amountKwh: campaign.giftKwh,
          expiresAt,
        },
      });

      const nowIssued = roundKwh(issued + gift);
      await tx.campaign.update({
        where: { id: campaign.id },
        data: {
          issuedKwh: nowIssued,
          // Exhausted the moment the next gift would not fit.
          ...(roundKwh(nowIssued + gift) > roundKwh(budget)
            ? { status: "EXHAUSTED" as const }
            : {}),
        },
      });

      await writeAudit(tx, {
        actor: "system",
        entity: "PromoGrant",
        entityId: grant.id,
        action: "promo.granted",
        after: {
          campaignId: campaign.id,
          userId,
          paymentId,
          amountKwh: gift,
          expiresAt: expiresAt.toISOString(),
          issuedKwh: nowIssued,
          budgetKwh: budget,
        },
      });

      return grant.id;
    });
  } catch (err) {
    // §42 "Один раз на клиента" is the unique index; losing that race is the
    // rule working, not a failure.
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "P2002"
  );
}

/**
 * US-41 "начисление в течение минуты" — the inline attempt after a charge can
 * fail (a deadlock, a restart), so the worker looks for captured charges
 * nobody has looked at. Returns the payments it touched.
 */
export async function sweepPendingAwards(): Promise<string[]> {
  const pending = await prisma.payment.findMany({
    where: { status: "CAPTURED", campaignsEvaluatedAt: null, pointId: { not: null } },
    orderBy: { capturedAt: "asc" },
    take: SWEEP_BATCH,
    select: { id: true },
  });

  const touched: string[] = [];
  for (const p of pending) {
    try {
      await awardAfterCharge(p.id);
      touched.push(p.id);
    } catch (err) {
      console.error("[campaigns] award failed for", p.id, err);
    }
  }
  return touched;
}

/**
 * §43 — "Сгорает по истечении срока; сгоревший объём возвращается в бюджет
 * кампании партнёра." Returns the grants that burned.
 */
export async function expireGrants(now: Date = new Date()): Promise<string[]> {
  const due = await prisma.promoGrant.findMany({
    where: { status: "ACTIVE", expiresAt: { lte: now } },
    take: SWEEP_BATCH,
    select: { id: true },
  });

  const expired: string[] = [];
  for (const { id } of due) {
    const burned = await prisma.$transaction(async (tx) => {
      // Re-read under a lock: a charge may be spending this very grant.
      const [grant] = await tx.$queryRaw<
        { id: string; campaignId: string; amount: string; used: string; status: string }[]
      >`
        SELECT id, "campaignId", "amountKwh"::text AS amount, "usedKwh"::text AS used,
               status::text AS status
        FROM "PromoGrant" WHERE id = ${id} FOR UPDATE
      `;
      if (!grant || grant.status !== "ACTIVE") return null;

      const remainder = roundKwh(Number(grant.amount) - Number(grant.used));
      await tx.promoGrant.update({ where: { id }, data: { status: "EXPIRED" } });

      if (remainder > 0) {
        const campaign = await tx.campaign.findUnique({
          where: { id: grant.campaignId },
          select: { id: true, issuedKwh: true, budgetKwh: true, giftKwh: true, status: true },
        });
        if (campaign) {
          const issued = roundKwh(Math.max(0, num(campaign.issuedKwh) - remainder));
          const fitsAgain =
            roundKwh(issued + num(campaign.giftKwh)) <= roundKwh(num(campaign.budgetKwh));
          await tx.campaign.update({
            where: { id: campaign.id },
            data: {
              issuedKwh: issued,
              // A campaign stopped only because the budget was spent may run
              // again now that it is not.
              ...(campaign.status === "EXHAUSTED" && fitsAgain
                ? { status: "ACTIVE" as const }
                : {}),
            },
          });
        }
      }

      await writeAudit(tx, {
        actor: "system",
        entity: "PromoGrant",
        entityId: id,
        action: "promo.expired",
        after: { campaignId: grant.campaignId, returnedKwh: remainder },
      });

      return id;
    });
    if (burned) expired.push(burned);
  }

  return expired;
}
