// US-43 — "списывать подарочные кВт·ч только в сети партнёра: при оплате в
// чужой сети подарок не применяется". And §43's other half: the energy under
// a gift comes out of the partner's own wallet, so the sum still adds up.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/exchange/decimal";
import { availableGiftKwh, readMyGifts, spendGrants } from "./grant-spend";

const PREFIX = "test_spend_";
const ZONE_CODE = "TESTSPEND";

let zoneId: string;
let operatorId: string;
let foreignOperatorId: string;
let partnerUserId: string;
let driverUserId: string;
let pointA: string;
let pointB: string;
let foreignPoint: string;
let campaignId: string;
let partnerWalletId: string;
let assetId: string;

async function wipe() {
  await prisma.promoGrant.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.campaign.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.energyToken.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.asset.deleteMany({ where: { company: { regNumber: `${PREFIX}reg` } } });
  await prisma.company.deleteMany({ where: { regNumber: `${PREFIX}reg` } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE_CODE } });
}

/** Batches in the partner's wallet — the energy a gift is actually paid with. */
async function fundPartner(amount: number) {
  await prisma.energyToken.create({
    data: {
      zoneId,
      assetId,
      ownerWalletId: partnerWalletId,
      amountKwh: new Prisma.Decimal(amount),
      intervalStart: new Date(),
      status: "AVAILABLE",
    },
  });
  await prisma.wallet.update({
    where: { id: partnerWalletId },
    data: { kwhBalance: { increment: new Prisma.Decimal(amount) } },
  });
}

async function grant(over: Partial<Prisma.PromoGrantUncheckedCreateInput> = {}) {
  return prisma.promoGrant.create({
    data: {
      campaignId,
      userId: driverUserId,
      operatorId,
      amountKwh: new Prisma.Decimal(10),
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      status: "ACTIVE",
      ...over,
    },
  });
}

beforeAll(async () => {
  await wipe();

  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE_CODE, country: "SK", name: "Grant spend zone", currency: "EUR" },
    })
  ).id;

  const user = async (name: string) =>
    (
      await prisma.user.upsert({
        where: { username: `${PREFIX}${name}` },
        update: {},
        create: { username: `${PREFIX}${name}`, passwordHash: "x" },
      })
    ).id;
  partnerUserId = await user("partner");
  driverUserId = await user("driver");

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: `${PREFIX}net`,
        displayName: "Grant spend network",
        claimedById: partnerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  foreignOperatorId = (
    await prisma.chargerOperator.create({
      data: { slug: `${PREFIX}other`, displayName: "Somebody else" },
    })
  ).id;

  const point = async (operator: string, name: string) =>
    (
      await prisma.acceptancePoint.create({
        data: { operatorId: operator, type: "CHARGING_STATION", name, gridZoneId: zoneId },
      })
    ).id;
  pointA = await point(operatorId, "A");
  pointB = await point(operatorId, "B");
  foreignPoint = await point(foreignOperatorId, "Theirs");

  campaignId = (
    await prisma.campaign.create({
      data: {
        operatorId,
        zoneId,
        name: "Welcome",
        trigger: "FIRST_CHARGE",
        giftKwh: new Prisma.Decimal(10),
        validityDays: 30,
        budgetKwh: new Prisma.Decimal(1000),
        status: "ACTIVE",
      },
    })
  ).id;

  const company = await prisma.company.create({
    data: {
      legalName: "Grant spend producer",
      country: "SK",
      regNumber: `${PREFIX}reg`,
      type: "PRODUCER",
      kybStatus: "APPROVED",
    },
  });
  assetId = (
    await prisma.asset.create({
      data: {
        companyId: company.id,
        gridZoneId: zoneId,
        kind: "SOLAR",
        name: "Grant spend roof",
        capacityKw: new Prisma.Decimal(50),
        status: "ACTIVE",
      },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.promoGrant.deleteMany({ where: { operatorId: { in: [operatorId, foreignOperatorId] } } });
  await prisma.energyToken.deleteMany({ where: { zoneId } });
  await prisma.wallet.deleteMany({ where: { zoneId } });
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "ACTIVE", pauseReason: null, scopePointIds: [] },
  });
  partnerWalletId = (
    await prisma.wallet.create({ data: { ownerUserId: partnerUserId, zoneId } })
  ).id;
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("availableGiftKwh — US-43 'в чужой сети подарок не применяется'", () => {
  it("offers the gift at a point of its own network", async () => {
    await grant();
    expect(await availableGiftKwh(driverUserId, pointA)).toBe(10);
    expect(await availableGiftKwh(driverUserId, pointB)).toBe(10);
  });

  it("offers nothing at somebody else's point", async () => {
    await grant();
    expect(await availableGiftKwh(driverUserId, foreignPoint)).toBe(0);
  });

  it("offers nothing when there is no point at all", async () => {
    await grant();
    expect(await availableGiftKwh(driverUserId, null)).toBe(0);
  });

  it("honours the campaign's own scope inside the network", async () => {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { scopePointIds: [pointB] },
    });
    await grant();
    expect(await availableGiftKwh(driverUserId, pointA)).toBe(0);
    expect(await availableGiftKwh(driverUserId, pointB)).toBe(10);
  });

  it("counts only what is left of a part-spent gift", async () => {
    await grant({ usedKwh: new Prisma.Decimal(4) });
    expect(await availableGiftKwh(driverUserId, pointA)).toBe(6);
  });

  it("ignores an expired, used or revoked gift", async () => {
    await grant({ expiresAt: new Date(Date.now() - 1000) });
    expect(await availableGiftKwh(driverUserId, pointA)).toBe(0);

    await prisma.promoGrant.deleteMany({ where: { operatorId } });
    await grant({ status: "USED", usedKwh: new Prisma.Decimal(10) });
    expect(await availableGiftKwh(driverUserId, pointA)).toBe(0);

    await prisma.promoGrant.deleteMany({ where: { operatorId } });
    await grant({ status: "REVOKED" });
    expect(await availableGiftKwh(driverUserId, pointA)).toBe(0);
  });

  it("ignores a gift whose campaign was paused", async () => {
    await grant();
    await prisma.campaign.update({ where: { id: campaignId }, data: { status: "PAUSED" } });
    expect(await availableGiftKwh(driverUserId, pointA)).toBe(0);
  });

  it("adds up two gifts of the same network", async () => {
    await grant();
    const second = await prisma.campaign.create({
      data: {
        operatorId,
        zoneId,
        name: "Second",
        trigger: "NTH_CHARGE",
        triggerN: 5,
        giftKwh: new Prisma.Decimal(3),
        validityDays: 30,
        budgetKwh: new Prisma.Decimal(100),
        status: "ACTIVE",
      },
    });
    await grant({ campaignId: second.id, amountKwh: new Prisma.Decimal(3) });

    expect(await availableGiftKwh(driverUserId, pointA)).toBe(13);
    await prisma.campaign.delete({ where: { id: second.id } });
  });
});

describe("spendGrants — the partner's own batches pay for the gift", () => {
  it("burns the partner's kWh and leaves the driver's balance alone", async () => {
    await fundPartner(20);
    const g = await grant();

    const result = await prisma.$transaction((tx) =>
      spendGrants(tx, { userId: driverUserId, pointId: pointA, amountKwh: 6 }),
    );

    expect(result.spentKwh).toBe(6);
    expect(result.burnedTokenIds.length).toBeGreaterThan(0);
    expect(result.networkName).toBe("Grant spend network");

    const partnerWallet = await prisma.wallet.findUniqueOrThrow({ where: { id: partnerWalletId } });
    expect(num(partnerWallet.kwhBalance)).toBe(14);

    const after = await prisma.promoGrant.findUniqueOrThrow({ where: { id: g.id } });
    expect(num(after.usedKwh)).toBe(6);
    expect(after.status).toBe("ACTIVE");
    expect(after.lastUsedAt).not.toBeNull();
  });

  it("closes a gift spent to its last kWh", async () => {
    await fundPartner(20);
    const g = await grant();

    await prisma.$transaction((tx) =>
      spendGrants(tx, { userId: driverUserId, pointId: pointA, amountKwh: 10 }),
    );

    const after = await prisma.promoGrant.findUniqueOrThrow({ where: { id: g.id } });
    expect(after.status).toBe("USED");
  });

  it("spends the gift that expires soonest first", async () => {
    await fundPartner(20);
    const later = await grant({ expiresAt: new Date(Date.now() + 40 * 86_400_000) });
    const sooner = await prisma.campaign
      .create({
        data: {
          operatorId,
          zoneId,
          name: "Sooner",
          trigger: "NTH_CHARGE",
          triggerN: 9,
          giftKwh: new Prisma.Decimal(4),
          validityDays: 2,
          budgetKwh: new Prisma.Decimal(100),
          status: "ACTIVE",
        },
      })
      .then((c) =>
        grant({
          campaignId: c.id,
          amountKwh: new Prisma.Decimal(4),
          expiresAt: new Date(Date.now() + 2 * 86_400_000),
        }),
      );

    await prisma.$transaction((tx) =>
      spendGrants(tx, { userId: driverUserId, pointId: pointA, amountKwh: 4 }),
    );

    expect(num((await prisma.promoGrant.findUniqueOrThrow({ where: { id: sooner.id } })).usedKwh)).toBe(4);
    expect(num((await prisma.promoGrant.findUniqueOrThrow({ where: { id: later.id } })).usedKwh)).toBe(0);
  });

  it("spends nothing at somebody else's point, whatever it is asked for", async () => {
    await fundPartner(20);
    await grant();

    const result = await prisma.$transaction((tx) =>
      spendGrants(tx, { userId: driverUserId, pointId: foreignPoint, amountKwh: 6 }),
    );

    expect(result.spentKwh).toBe(0);
    expect(result.burnedTokenIds).toEqual([]);
    const partnerWallet = await prisma.wallet.findUniqueOrThrow({ where: { id: partnerWalletId } });
    expect(num(partnerWallet.kwhBalance)).toBe(20);
  });

  it("pauses the campaign and gives nothing when the partner has no kWh", async () => {
    const g = await grant();

    const result = await prisma.$transaction((tx) =>
      spendGrants(tx, { userId: driverUserId, pointId: pointA, amountKwh: 6 }),
    );

    expect(result.spentKwh).toBe(0);
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(campaign.status).toBe("PAUSED");
    expect(campaign.pauseReason).toMatch(/kWh|energy|balance/i);
    const after = await prisma.promoGrant.findUniqueOrThrow({ where: { id: g.id } });
    expect(num(after.usedKwh)).toBe(0);
  });

  it("spends only as much as the partner can actually cover", async () => {
    await fundPartner(4);
    const g = await grant();

    const result = await prisma.$transaction((tx) =>
      spendGrants(tx, { userId: driverUserId, pointId: pointA, amountKwh: 10 }),
    );

    expect(result.spentKwh).toBe(4);
    const after = await prisma.promoGrant.findUniqueOrThrow({ where: { id: g.id } });
    expect(num(after.usedKwh)).toBe(4);
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(campaign.status).toBe("PAUSED");
  });

  it("writes every spend to the audit log", async () => {
    await fundPartner(20);
    await prisma.$transaction((tx) =>
      spendGrants(tx, { userId: driverUserId, pointId: pointA, amountKwh: 3 }),
    );

    const log = await prisma.auditLog.findFirst({
      where: { entity: "PromoGrant", action: "promo.spent" },
      orderBy: { at: "desc" },
    });
    expect(log).not.toBeNull();
  });

  it("does not let two charges spend one gift twice", async () => {
    await fundPartner(40);
    const g = await grant();

    const spend = () =>
      prisma.$transaction((tx) =>
        spendGrants(tx, { userId: driverUserId, pointId: pointA, amountKwh: 10 }),
      );
    const [a, b] = await Promise.all([spend(), spend()]);

    expect(a.spentKwh + b.spentKwh).toBe(10);
    const after = await prisma.promoGrant.findUniqueOrThrow({ where: { id: g.id } });
    expect(num(after.usedKwh)).toBe(10);
    expect(after.status).toBe("USED");
  });
});

describe("readMyGifts — US-42 'раздел Подарки с партнёром, суммой и сроком'", () => {
  it("lists the live gifts with what is left and where to spend them", async () => {
    await grant();

    const gifts = await readMyGifts(driverUserId);

    expect(gifts).toHaveLength(1);
    expect(gifts[0].networkName).toBe("Grant spend network");
    expect(gifts[0].remainingKwh).toBe(10);
    expect(gifts[0].operatorSlug).toBe(`${PREFIX}net`);
    expect(gifts[0].pointCount).toBe(2);
  });

  it("counts only the campaign's own points when it is scoped", async () => {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { scopePointIds: [pointB] },
    });
    await grant();

    const gifts = await readMyGifts(driverUserId);
    expect(gifts[0].pointCount).toBe(1);
  });

  it("subtracts what has been spent", async () => {
    await grant({ usedKwh: new Prisma.Decimal(3.5) });
    const gifts = await readMyGifts(driverUserId);
    expect(gifts[0].remainingKwh).toBe(6.5);
  });

  it("hides expired, used and revoked gifts", async () => {
    await grant({ expiresAt: new Date(Date.now() - 1000) });
    expect(await readMyGifts(driverUserId)).toHaveLength(0);

    await prisma.promoGrant.deleteMany({ where: { operatorId } });
    await grant({ status: "USED", usedKwh: new Prisma.Decimal(10) });
    expect(await readMyGifts(driverUserId)).toHaveLength(0);
  });

  it("shows nobody else's gifts", async () => {
    await grant();
    expect(await readMyGifts(partnerUserId)).toHaveLength(0);
  });

  it("puts the gift that burns soonest first", async () => {
    const later = await grant({ expiresAt: new Date(Date.now() + 40 * 86_400_000) });
    const second = await prisma.campaign.create({
      data: {
        operatorId,
        zoneId,
        name: "Sooner",
        trigger: "NTH_CHARGE",
        triggerN: 7,
        giftKwh: new Prisma.Decimal(2),
        validityDays: 1,
        budgetKwh: new Prisma.Decimal(10),
        status: "ACTIVE",
      },
    });
    const sooner = await grant({
      campaignId: second.id,
      amountKwh: new Prisma.Decimal(2),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const gifts = await readMyGifts(driverUserId);
    expect(gifts.map((g) => g.id)).toEqual([sooner.id, later.id]);
    await prisma.campaign.delete({ where: { id: second.id } });
  });
});
