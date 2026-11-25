// §44 "Аналитика кампаний", US-44: the numbers the partner's dashboard shows,
// against the real database.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readCampaignAnalytics, readContentAnalytics } from "./campaign-analytics";
import { recordContentEvent } from "./content-events";

const PREFIX = "test_can_";
const ZONE = "TESTCAN";

let zoneId: string;
let operatorId: string;
let ownerUserId: string;
let pointId: string;
let campaignId: string;
let contentId: string;
let newcomerId: string;
let regularId: string;

async function wipe() {
  await prisma.contentEvent.deleteMany({
    where: { content: { operator: { slug: { startsWith: PREFIX } } } },
  });
  await prisma.marketingContent.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.receipt.deleteMany({ where: { payment: { zone: { code: ZONE } } } });
  await prisma.promoGrant.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.payment.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.campaign.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
}

async function charge(userId: string, kwh: number, fiat: number, at: Date) {
  const wallet = await prisma.wallet.upsert({
    where: { ownerUserId_zoneId: { ownerUserId: userId, zoneId } },
    update: {},
    create: { ownerUserId: userId, zoneId },
  });
  return prisma.payment.create({
    data: {
      walletId: wallet.id,
      zoneId,
      pointId,
      requestedKwh: new Prisma.Decimal(kwh),
      kwhFromBalance: new Prisma.Decimal(kwh),
      amountFiat: new Prisma.Decimal(fiat),
      status: "CAPTURED",
      capturedAt: at,
      createdAt: at,
    },
  });
}

async function grant(userId: string, kwh: number, usedKwh: number, paymentId: string | null, issuedAt: Date) {
  return prisma.promoGrant.create({
    data: {
      campaignId,
      userId,
      operatorId,
      paymentId,
      amountKwh: new Prisma.Decimal(kwh),
      usedKwh: new Prisma.Decimal(usedKwh),
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      issuedAt,
    },
  });
}

beforeAll(async () => {
  await wipe();
  const user = async (name: string) =>
    (
      await prisma.user.upsert({
        where: { username: `${PREFIX}${name}` },
        update: {},
        create: { username: `${PREFIX}${name}`, passwordHash: "x" },
      })
    ).id;
  ownerUserId = await user("owner");
  newcomerId = await user("newcomer");
  regularId = await user("regular");

  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE, country: "SK", name: "Analytics zone", currency: "EUR" },
    })
  ).id;
  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: `${PREFIX}net`,
        displayName: "Analytics network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  pointId = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "P", gridZoneId: zoneId },
    })
  ).id;
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

beforeEach(async () => {
  await prisma.contentEvent.deleteMany({ where: { content: { operatorId } } });
  await prisma.marketingContent.deleteMany({ where: { operatorId } });
  await prisma.promoGrant.deleteMany({ where: { operatorId } });
  await prisma.payment.deleteMany({ where: { zoneId } });
  await prisma.campaign.deleteMany({ where: { operatorId } });

  campaignId = (
    await prisma.campaign.create({
      data: {
        operatorId,
        zoneId,
        name: "Welcome",
        trigger: "FIRST_CHARGE",
        giftKwh: new Prisma.Decimal(10),
        validityDays: 30,
        budgetKwh: new Prisma.Decimal(100),
        status: "ACTIVE",
      },
    })
  ).id;
  contentId = (
    await prisma.marketingContent.create({
      data: { operatorId, type: "VIDEO", title: "Clip", status: "APPROVED" },
    })
  ).id;
});

describe("readCampaignAnalytics — §44", () => {
  it("is all zeros for a campaign nobody has earned anything from", async () => {
    const [row] = await readCampaignAnalytics(operatorId, ownerUserId);
    expect(row.clients).toBe(0);
    expect(row.newClients).toBe(0);
    expect(row.returningShare).toBeNull();
    expect(row.costPerClientKwh).toBeNull();
    expect(row.issuedKwh).toBe(0);
    expect(row.revenue30.fiat).toBe(0);
  });

  it("counts the clients the campaign gave to, and the gift it cost", async () => {
    const now = new Date();
    const first = await charge(newcomerId, 10, 2, new Date(now.getTime() - 5 * 86_400_000));
    await grant(newcomerId, 10, 4, first.id, new Date(now.getTime() - 5 * 86_400_000));
    const other = await charge(regularId, 8, 1.6, new Date(now.getTime() - 4 * 86_400_000));
    await grant(regularId, 10, 0, other.id, new Date(now.getTime() - 4 * 86_400_000));

    const [row] = await readCampaignAnalytics(operatorId, ownerUserId);
    expect(row.clients).toBe(2);
    expect(row.issuedKwh).toBe(20);
    expect(row.usedKwh).toBe(4);
    // §44 "стоимость привлечения одного клиента", in kWh of budget.
    expect(row.costPerClientKwh).toBe(10);
  });

  it("separates the newcomers from the clients who were already charging", async () => {
    const now = new Date();
    // The regular had charged in this network long before the campaign.
    await charge(regularId, 5, 1, new Date(now.getTime() - 40 * 86_400_000));

    const nFirst = await charge(newcomerId, 10, 2, new Date(now.getTime() - 3 * 86_400_000));
    await grant(newcomerId, 10, 0, nFirst.id, new Date(now.getTime() - 3 * 86_400_000));
    const rNext = await charge(regularId, 10, 2, new Date(now.getTime() - 3 * 86_400_000));
    await grant(regularId, 10, 0, rNext.id, new Date(now.getTime() - 3 * 86_400_000));

    const [row] = await readCampaignAnalytics(operatorId, ownerUserId);
    expect(row.clients).toBe(2);
    expect(row.newClients).toBe(1);
  });

  it("counts the share who came back to charge again after the gift", async () => {
    const now = new Date();
    const a = await charge(newcomerId, 10, 2, new Date(now.getTime() - 6 * 86_400_000));
    await grant(newcomerId, 10, 0, a.id, new Date(now.getTime() - 6 * 86_400_000));
    // Came back two days later.
    await charge(newcomerId, 7, 1.4, new Date(now.getTime() - 4 * 86_400_000));

    const b = await charge(regularId, 9, 1.8, new Date(now.getTime() - 6 * 86_400_000));
    await grant(regularId, 10, 0, b.id, new Date(now.getTime() - 6 * 86_400_000));

    const [row] = await readCampaignAnalytics(operatorId, ownerUserId);
    expect(row.clients).toBe(2);
    expect(row.returned).toBe(1);
    expect(row.returningShare).toBe(0.5);
  });

  it("adds up what the campaign's clients spent in 30 and 90 days", async () => {
    const now = new Date();
    const p = await charge(newcomerId, 10, 2.5, new Date(now.getTime() - 2 * 86_400_000));
    await grant(newcomerId, 10, 0, p.id, new Date(now.getTime() - 2 * 86_400_000));
    // Inside 90 days but outside 30.
    await charge(newcomerId, 20, 5, new Date(now.getTime() - 45 * 86_400_000));

    const [row] = await readCampaignAnalytics(operatorId, ownerUserId);
    expect(row.revenue30.fiat).toBe(2.5);
    expect(row.revenue30.kwh).toBe(10);
    expect(row.revenue90.fiat).toBe(7.5);
    expect(row.revenue90.kwh).toBe(30);
  });

  it("belongs to the network that owns it", async () => {
    const stranger = await prisma.user.upsert({
      where: { username: `${PREFIX}stranger` },
      update: {},
      create: { username: `${PREFIX}stranger`, passwordHash: "x" },
    });
    await expect(readCampaignAnalytics(operatorId, stranger.id)).rejects.toThrow();
  });
});

describe("readContentAnalytics — §44 'показы и клики'", () => {
  it("counts shows, clicks, video views and the click-through rate", async () => {
    for (let i = 0; i < 4; i += 1) {
      await recordContentEvent({ contentId, kind: "IMPRESSION", userId: null });
    }
    await recordContentEvent({ contentId, kind: "CLICK", userId: null });
    await recordContentEvent({ contentId, kind: "VIDEO_VIEW", userId: null });

    const [row] = await readContentAnalytics(operatorId, ownerUserId);
    expect(row.title).toBe("Clip");
    expect(row.impressions).toBe(4);
    expect(row.clicks).toBe(1);
    expect(row.videoViews).toBe(1);
    expect(row.ctr).toBe(0.25);
  });

  it("has no rate to report without a single show", async () => {
    const [row] = await readContentAnalytics(operatorId, ownerUserId);
    expect(row.impressions).toBe(0);
    expect(row.ctr).toBeNull();
  });
});
