// Spending promo kWh — ТЗ §43, US-43 ("при оплате в чужой сети подарок не
// применяется").
//
// Two halves, deliberately apart:
//
//   `availableGiftKwh` answers "how much may this driver spend here" and is
//   called before anything moves, so the charge plan can put the gift first.
//
//   `spendGrants` runs inside the capture transaction: it takes the grants
//   under a row lock, and burns the matching batches out of the wallet that
//   funds the campaign. The partner gives away their own generation; the
//   driver pays nothing. Nothing is invented and the kWh still add up.
//
// A partner whose wallet cannot cover the gift gets the campaign paused with
// a reason, and the driver pays as usual. That is the honest outcome: we
// cannot hand over energy nobody owns.

import { prisma } from "@/lib/prisma";
import { type Db, writeAudit } from "@/lib/exchange/audit";
import { num, numOrNull } from "@/lib/exchange/decimal";
import { isKwhDust, roundKwh } from "@/lib/exchange/precision";
import { burnTokens } from "@/lib/exchange/token-registry";

export interface GrantSpend {
  /** kWh actually taken off gifts. */
  spentKwh: number;
  /** Batches burned out of the partner's wallet. */
  burnedTokenIds: string[];
  /** For the §46 receipt line: whose gift this was. */
  networkName: string | null;
  grantIds: string[];
}

const EMPTY: GrantSpend = { spentKwh: 0, burnedTokenIds: [], networkName: null, grantIds: [] };

/**
 * The grants this driver may spend at this point: the right network, the
 * campaign's own scope, still alive, soonest expiry first (§43 — a gift that
 * burns tomorrow is worth less than one that burns in a month).
 */
async function liveGrantsAt(db: Db, userId: string, pointId: string) {
  const point = await db.acceptancePoint.findUnique({
    where: { id: pointId },
    select: { id: true, operatorId: true },
  });
  if (!point) return [];

  const grants = await db.promoGrant.findMany({
    where: {
      userId,
      // §43 "привязан к сети партнёра" — this is US-43, in one clause.
      operatorId: point.operatorId,
      status: "ACTIVE",
      expiresAt: { gt: new Date() },
      campaign: { status: "ACTIVE" },
    },
    orderBy: [{ expiresAt: "asc" }, { issuedAt: "asc" }],
    include: {
      campaign: { select: { id: true, scopePointIds: true, zoneId: true, operatorId: true } },
      operator: { select: { displayName: true, claimedById: true } },
    },
  });

  // §42 "Где действует: вся сеть партнёра или выбранные пункты".
  return grants.filter(
    (g) =>
      g.campaign.scopePointIds.length === 0 || g.campaign.scopePointIds.includes(point.id),
  );
}

/**
 * How many promo kWh this driver may put into a session at this point.
 *
 * Zero for a charge with no point of ours and for a charge in another
 * network — that is the acceptance criterion of US-43, read before any money
 * moves rather than caught afterwards.
 */
export async function availableGiftKwh(
  userId: string,
  pointId: string | null,
  db: Db = prisma,
): Promise<number> {
  if (!pointId) return 0;
  const grants = await liveGrantsAt(db, userId, pointId);
  return roundKwh(
    grants.reduce((sum, g) => sum + Math.max(0, num(g.amountKwh) - num(g.usedKwh)), 0),
  );
}

/**
 * Spend up to `amountKwh` of gifts, inside the caller's transaction.
 *
 * Takes each grant with `FOR UPDATE` in the same order for everyone, the way
 * the order book does, so two sessions cannot both see the same remainder.
 */
export async function spendGrants(
  tx: Db,
  args: { userId: string; pointId: string | null; amountKwh: number },
): Promise<GrantSpend> {
  const want = roundKwh(args.amountKwh);
  if (!args.pointId || isKwhDust(want)) return EMPTY;

  const candidates = await liveGrantsAt(tx, args.userId, args.pointId);
  if (candidates.length === 0) return EMPTY;

  let remaining = want;
  let spentKwh = 0;
  const burnedTokenIds: string[] = [];
  const grantIds: string[] = [];
  let networkName: string | null = null;

  for (const candidate of candidates) {
    if (isKwhDust(remaining)) break;

    const [locked] = await tx.$queryRaw<
      { id: string; amount: string; used: string; status: string }[]
    >`
      SELECT id, "amountKwh"::text AS amount, "usedKwh"::text AS used, status::text AS status
      FROM "PromoGrant" WHERE id = ${candidate.id} FOR UPDATE
    `;
    if (!locked || locked.status !== "ACTIVE") continue;

    const left = roundKwh(Number(locked.amount) - Number(locked.used));
    if (isKwhDust(left)) continue;

    const take = roundKwh(Math.min(left, remaining));

    // §42 "Источник финансирования … из его выработки (токенов)" — the energy
    // leaves the partner's wallet, in the campaign's zone.
    const fundingUserId = candidate.operator.claimedById;
    if (!fundingUserId) {
      await pauseCampaign(tx, candidate.campaign.id, "The network has no owner to fund the gift");
      continue;
    }

    const fundingWallet = await tx.wallet.findUnique({
      where: {
        ownerUserId_zoneId: { ownerUserId: fundingUserId, zoneId: candidate.campaign.zoneId },
      },
      select: { id: true, kwhBalance: true },
    });
    // There is no reserve on kWh the way there is on money: a batch is either
    // in the wallet or sold.
    const covered = fundingWallet
      ? roundKwh(Math.min(take, Math.max(0, num(fundingWallet.kwhBalance))))
      : 0;

    if (isKwhDust(covered)) {
      await pauseCampaign(
        tx,
        candidate.campaign.id,
        "Not enough kWh in the funding wallet to cover the gift",
      );
      continue;
    }

    const ids = await burnTokens(tx, { walletId: fundingWallet!.id, amountKwh: covered });
    burnedTokenIds.push(...ids);

    const nowUsed = roundKwh(Number(locked.used) + covered);
    await tx.promoGrant.update({
      where: { id: candidate.id },
      data: {
        usedKwh: nowUsed,
        lastUsedAt: new Date(),
        ...(roundKwh(Number(locked.amount) - nowUsed) <= 0 ? { status: "USED" as const } : {}),
      },
    });

    await writeAudit(tx, {
      actor: args.userId,
      entity: "PromoGrant",
      entityId: candidate.id,
      action: "promo.spent",
      after: {
        campaignId: candidate.campaign.id,
        pointId: args.pointId,
        spentKwh: covered,
        usedKwh: nowUsed,
        fundingWalletId: fundingWallet!.id,
        burnedTokenIds: ids.length,
      },
    });

    spentKwh = roundKwh(spentKwh + covered);
    remaining = roundKwh(remaining - covered);
    grantIds.push(candidate.id);
    networkName ??= candidate.operator.displayName;

    // The partner covered part of the slice and no more. The driver pays for
    // the rest as usual, and the campaign stops rather than keep promising
    // energy the wallet does not hold.
    if (covered < take) {
      await pauseCampaign(
        tx,
        candidate.campaign.id,
        "Not enough kWh in the funding wallet to cover the gift",
      );
      break;
    }
  }

  if (isKwhDust(spentKwh)) return EMPTY;
  return { spentKwh, burnedTokenIds, networkName, grantIds };
}

/** §42's budget runs out quietly; an empty wallet is worth saying out loud. */
async function pauseCampaign(tx: Db, campaignId: string, reason: string): Promise<void> {
  await tx.campaign.update({
    where: { id: campaignId },
    data: { status: "PAUSED", pauseReason: reason },
  });
  await writeAudit(tx, {
    actor: "system",
    entity: "Campaign",
    entityId: campaignId,
    action: "campaign.paused",
    after: { reason },
  });
}

export interface MyGift {
  id: string;
  networkName: string;
  operatorId: string;
  operatorSlug: string;
  amountKwh: number;
  remainingKwh: number;
  expiresAt: Date;
  campaignName: string;
  /** US-12 — a gift of §42 or cashback for paying in tokens. */
  kind: "gift" | "cashback";
  /** The share that earned it, for a cashback. */
  cashbackPct: number | null;
  /** The charge that earned it, so its receipt can be opened from history. */
  receiptId: string | null;
  /** How many stations this gift is good at, for the "show me" button. */
  pointCount: number;
  /** Null when the gift is good across the whole network. */
  scopePointIds: string[];
}

/**
 * US-42 — "Раздел «Подарки» с партнёром, суммой, сроком и кнопкой «Показать
 * станции»". Soonest to burn first: that is the one worth using.
 */
export async function readMyGifts(userId: string): Promise<MyGift[]> {
  const grants = await prisma.promoGrant.findMany({
    where: {
      userId,
      status: "ACTIVE",
      expiresAt: { gt: new Date() },
      campaign: { status: { in: ["ACTIVE", "PAUSED", "EXHAUSTED"] } },
    },
    orderBy: [{ expiresAt: "asc" }, { issuedAt: "asc" }],
    include: {
      operator: { select: { id: true, slug: true, displayName: true } },
      campaign: {
        select: { name: true, scopePointIds: true, trigger: true, cashbackPct: true },
      },
      payment: { select: { receipt: { select: { id: true } } } },
    },
  });

  return Promise.all(
    grants.map(async (g) => {
      // Where it can be spent: the campaign's own points, or every published
      // point of the network.
      const pointCount =
        g.campaign.scopePointIds.length > 0
          ? await prisma.acceptancePoint.count({
              where: { id: { in: g.campaign.scopePointIds } },
            })
          : await prisma.acceptancePoint.count({ where: { operatorId: g.operatorId } });

      return {
        id: g.id,
        networkName: g.operator.displayName,
        operatorId: g.operator.id,
        operatorSlug: g.operator.slug,
        amountKwh: num(g.amountKwh),
        remainingKwh: roundKwh(Math.max(0, num(g.amountKwh) - num(g.usedKwh))),
        expiresAt: g.expiresAt,
        campaignName: g.campaign.name,
        kind: g.campaign.trigger === "TOKEN_PAYMENT" ? ("cashback" as const) : ("gift" as const),
        cashbackPct: numOrNull(g.campaign.cashbackPct),
        receiptId: g.payment?.receipt?.id ?? null,
        pointCount,
        scopePointIds: g.campaign.scopePointIds,
      };
    }),
  );
}
