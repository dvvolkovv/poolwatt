// §44 "Аналитика кампаний" — US-44.
//
// Two groups of numbers, kept apart on purpose: what the campaign's gifts did
// (grants, clients, returning share, cost, revenue) and what the content did
// (shows, clicks, video views). ТЗ describes campaigns (§42) and content (§41)
// separately and never links one to the other, so joining them into a single
// row would invent a relation the partner never set.

import { prisma } from "@/lib/prisma";
import type { Db } from "@/lib/exchange/audit";
import { num } from "@/lib/exchange/decimal";
import { roundKwh, roundMoney } from "@/lib/exchange/precision";
import { CampaignError } from "./campaign-service";

const DAY_MS = 86_400_000;

async function requireNetwork(operatorId: string, userId: string, db: Db) {
  const op = await db.chargerOperator.findUnique({
    where: { id: operatorId },
    select: { id: true, claimedById: true },
  });
  if (!op) throw new CampaignError("No such network");
  if (!op.claimedById || op.claimedById !== userId) {
    throw new CampaignError("This network belongs to somebody else");
  }
  return op;
}

export interface RevenueWindow {
  fiat: number;
  kwh: number;
}

export interface CampaignAnalyticsRow {
  campaignId: string;
  name: string;
  status: string;
  trigger: string;
  /** §42 budget and what of it is promised. */
  budgetKwh: number;
  issuedKwh: number;
  usedKwh: number;
  expiredKwh: number;
  /** Everybody the campaign gave a right to. */
  clients: number;
  /** Of them, those whose charge that earned it was their first in the network. */
  newClients: number;
  /** Of them, those who charged in the network again afterwards. */
  returned: number;
  /** `returned / clients`, or null when there is nobody to divide by. */
  returningShare: number | null;
  /** §44 "стоимость привлечения одного клиента", in kWh of budget. */
  costPerClientKwh: number | null;
  revenue30: RevenueWindow;
  revenue90: RevenueWindow;
}

/**
 * The §44 dashboard, one row per campaign.
 *
 * The cost of a client is in kWh, not money: a campaign's budget in money
 * waits for the EMI (§42), and valuing the gifted kWh at the zone's spot
 * price would be a cost the partner never paid.
 */
export async function readCampaignAnalytics(
  operatorId: string,
  userId: string,
  now = new Date(),
  db: Db = prisma,
): Promise<CampaignAnalyticsRow[]> {
  await requireNetwork(operatorId, userId, db);

  const campaigns = await db.campaign.findMany({
    where: { operatorId },
    orderBy: { createdAt: "desc" },
    include: {
      grants: {
        select: {
          userId: true,
          amountKwh: true,
          usedKwh: true,
          status: true,
          issuedAt: true,
          paymentId: true,
        },
      },
    },
  });
  if (campaigns.length === 0) return [];

  const rows: CampaignAnalyticsRow[] = [];
  for (const campaign of campaigns) {
    let issuedKwh = 0;
    let usedKwh = 0;
    let expiredKwh = 0;
    const clientIds = new Set<string>();
    for (const g of campaign.grants) {
      const amount = num(g.amountKwh);
      const used = num(g.usedKwh);
      issuedKwh += amount;
      usedKwh += used;
      if (g.status === "EXPIRED") expiredKwh += Math.max(0, amount - used);
      clientIds.add(g.userId);
    }

    const clients = clientIds.size;
    let newClients = 0;
    let returned = 0;

    for (const clientId of clientIds) {
      // The earliest grant of this campaign for this client — the moment the
      // campaign reached them.
      const theirGrants = campaign.grants
        .filter((g) => g.userId === clientId)
        .sort((a, b) => a.issuedAt.getTime() - b.issuedAt.getTime());
      const firstGrant = theirGrants[0];

      const chargesBefore = await db.payment.count({
        where: {
          wallet: { ownerUserId: clientId },
          status: "CAPTURED",
          point: { operatorId },
          capturedAt: { lt: firstGrant.issuedAt },
          ...(firstGrant.paymentId ? { id: { not: firstGrant.paymentId } } : {}),
        },
      });
      // §44 "новые клиенты, пришедшие по кампании": the charge that earned the
      // gift was their first one in this network.
      if (chargesBefore === 0) newClients += 1;

      const chargesAfter = await db.payment.count({
        where: {
          wallet: { ownerUserId: clientId },
          status: "CAPTURED",
          point: { operatorId },
          capturedAt: { gt: firstGrant.issuedAt },
        },
      });
      if (chargesAfter > 0) returned += 1;
    }

    const revenue = async (days: number): Promise<RevenueWindow> => {
      if (clientIds.size === 0) return { fiat: 0, kwh: 0 };
      const sum = await db.payment.aggregate({
        where: {
          wallet: { ownerUserId: { in: [...clientIds] } },
          status: "CAPTURED",
          point: { operatorId },
          capturedAt: { gte: new Date(now.getTime() - days * DAY_MS), lte: now },
        },
        _sum: { amountFiat: true, kwhFromBalance: true, kwhFromRoaming: true, kwhBought: true },
      });
      return {
        fiat: roundMoney(num(sum._sum.amountFiat ?? 0)),
        kwh: roundKwh(
          num(sum._sum.kwhFromBalance ?? 0) +
            num(sum._sum.kwhFromRoaming ?? 0) +
            num(sum._sum.kwhBought ?? 0),
        ),
      };
    };

    rows.push({
      campaignId: campaign.id,
      name: campaign.name,
      status: campaign.status,
      trigger: campaign.trigger,
      budgetKwh: num(campaign.budgetKwh),
      issuedKwh: roundKwh(issuedKwh),
      usedKwh: roundKwh(usedKwh),
      expiredKwh: roundKwh(expiredKwh),
      clients,
      newClients,
      returned,
      returningShare: clients > 0 ? Math.round((returned / clients) * 10_000) / 10_000 : null,
      costPerClientKwh: clients > 0 ? roundKwh(issuedKwh / clients) : null,
      revenue30: await revenue(30),
      revenue90: await revenue(90),
    });
  }

  return rows;
}

export interface ContentAnalyticsRow {
  contentId: string;
  title: string;
  type: string;
  status: string;
  impressions: number;
  clicks: number;
  videoViews: number;
  /** Clicks per show, or null without a single show. */
  ctr: number | null;
}

/** §44 "Показы и клики по контенту, просмотры видео", per piece of content. */
export async function readContentAnalytics(
  operatorId: string,
  userId: string,
  db: Db = prisma,
): Promise<ContentAnalyticsRow[]> {
  await requireNetwork(operatorId, userId, db);

  const contents = await db.marketingContent.findMany({
    where: { operatorId },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, type: true, status: true },
  });
  if (contents.length === 0) return [];

  const counts = await db.contentEvent.groupBy({
    by: ["contentId", "kind"],
    where: { contentId: { in: contents.map((c) => c.id) } },
    _count: { _all: true },
  });

  const countOf = (contentId: string, kind: string) =>
    counts.find((c) => c.contentId === contentId && c.kind === kind)?._count._all ?? 0;

  return contents.map((c) => {
    const impressions = countOf(c.id, "IMPRESSION");
    const clicks = countOf(c.id, "CLICK");
    return {
      contentId: c.id,
      title: c.title,
      type: c.type,
      status: c.status,
      impressions,
      clicks,
      videoViews: countOf(c.id, "VIDEO_VIEW"),
      ctr: impressions > 0 ? Math.round((clicks / impressions) * 10_000) / 10_000 : null,
    };
  });
}
