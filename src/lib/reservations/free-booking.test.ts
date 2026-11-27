// §42 "бесплатная бронь" — the gift that pays the booking fee of §33.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/exchange/decimal";
import { getOrCreateWallet } from "@/lib/exchange/wallet-service";
import { createReservation, cancelReservation, extendReservation, savePolicy } from "./reservation-service";

const PREFIX = "test_fbook_";
const SLUG = `${PREFIX}net`;
const OTHER_SLUG = `${PREFIX}other`;
const ZONE = "TESTFBOOK";

let operatorId: string;
let otherOperatorId: string;
let ownerUserId: string;
let driverUserId: string;
let zoneId: string;
let pointId: string;
let connectorA: string;
let connectorB: string;
let walletId: string;

async function wipe() {
  await prisma.promoGrant.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.campaign.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.receipt.deleteMany({
    where: { reservation: { point: { operator: { slug: { startsWith: PREFIX } } } } },
  });
  await prisma.reservation.deleteMany({
    where: { point: { operator: { slug: { startsWith: PREFIX } } } },
  });
  await prisma.reservationPolicy.deleteMany({
    where: { point: { operator: { slug: { startsWith: PREFIX } } } },
  });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.coopMember.deleteMany({ where: { coop: { name: { startsWith: PREFIX } } } });
  await prisma.cooperative.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
}

/** A live free-booking gift of this network, as the constructor would issue. */
async function bookingGift(operator = operatorId) {
  const campaign = await prisma.campaign.create({
    data: {
      operatorId: operator,
      zoneId,
      name: "A booking on us",
      trigger: "FIRST_CHARGE",
      giftKwh: new Prisma.Decimal(0),
      freeBooking: true,
      validityDays: 30,
      budgetKwh: new Prisma.Decimal(0),
      budgetGrants: 10,
      status: "ACTIVE",
    },
  });
  return prisma.promoGrant.create({
    data: {
      campaignId: campaign.id,
      userId: driverUserId,
      operatorId: operator,
      kind: "FREE_BOOKING",
      amountKwh: new Prisma.Decimal(0),
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    },
  });
}

beforeAll(async () => {
  await wipe();

  const seedUser = async (name: string) =>
    (
      await prisma.user.upsert({
        where: { username: `${PREFIX}${name}` },
        update: {},
        create: { username: `${PREFIX}${name}`, passwordHash: "x" },
      })
    ).id;
  ownerUserId = await seedUser("owner");
  driverUserId = await seedUser("driver");

  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE, country: "SK", name: "Free booking zone", currency: "EUR" },
    })
  ).id;

  // §34 — booking needs KYC, which lives on cooperative membership.
  const company = await prisma.company.create({
    data: {
      legalName: `${PREFIX}coopco`,
      country: "SK",
      regNumber: `${PREFIX}reg`,
      type: "COOPERATIVE",
      kybStatus: "APPROVED",
      ownerUserId,
    },
  });
  const coop = await prisma.cooperative.create({
    data: { name: `${PREFIX}coop`, zoneId, companyId: company.id },
  });
  await prisma.coopMember.create({
    data: { coopId: coop.id, userId: driverUserId, status: "ACTIVE", shares: 1, kycVerifiedAt: new Date() },
  });

  operatorId = (
    await prisma.chargerOperator.create({
      data: { slug: SLUG, displayName: "Free booking network", claimedById: ownerUserId, claimedAt: new Date() },
    })
  ).id;
  otherOperatorId = (
    await prisma.chargerOperator.create({
      data: { slug: OTHER_SLUG, displayName: "Another network" },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.promoGrant.deleteMany({ where: { operatorId: { in: [operatorId, otherOperatorId] } } });
  await prisma.campaign.deleteMany({ where: { operatorId: { in: [operatorId, otherOperatorId] } } });
  await prisma.reservation.deleteMany({ where: { point: { operatorId } } });
  await prisma.acceptancePoint.deleteMany({ where: { operatorId } });

  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId,
      type: "CHARGING_STATION",
      name: "Free booking point",
      status: "PUBLISHED",
      publishedAt: new Date(),
      country: "SK",
      city: "Košice",
      addressLine: "Hlavná 1",
      latitude: 48.7,
      longitude: 21.25,
      howToFind: "by the gate",
      energySource: "SOLAR",
      open24: true,
      paymentMethods: ["TOKEN"],
      gridZoneId: zoneId,
      connectors: {
        create: [
          { type: "CCS2", powerKw: new Prisma.Decimal(150), currentAc: false, quantity: 1, status: "FREE" },
          { type: "TYPE2", powerKw: new Prisma.Decimal(22), currentAc: true, quantity: 1, status: "FREE" },
        ],
      },
    },
    include: { connectors: { orderBy: { type: "asc" } } },
  });
  pointId = point.id;
  connectorA = point.connectors.find((c) => c.type === "CCS2")!.id;
  connectorB = point.connectors.find((c) => c.type === "TYPE2")!.id;

  await savePolicy(pointId, ownerUserId, {
    enabled: true,
    walkUpConnectors: 0,
    feeFiat: 2,
    guaranteeFiat: 5,
    noShowPenaltyFiat: 3,
    waitMinutes: 15,
    freeCancelMinutes: 30,
    maxAheadHours: 24,
    extendAllowed: true,
    extendFeeFiat: 1,
  });

  const wallet = await getOrCreateWallet(driverUserId, zoneId);
  walletId = wallet.id;
  await prisma.wallet.update({
    where: { id: wallet.id },
    data: { fiatBalance: new Prisma.Decimal(50), reservedFiat: new Prisma.Decimal(0) },
  });
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000);

describe("createReservation with a free-booking gift", () => {
  it("takes no fee and spends the gift", async () => {
    const gift = await bookingGift();

    const reservation = await createReservation({
      userId: driverUserId,
      connectorId: connectorA,
      eta: inAnHour(),
    });

    expect(num(reservation.feeFiat)).toBe(0);
    expect(reservation.promoGrantId).toBe(gift.id);
    const after = await prisma.promoGrant.findUniqueOrThrow({ where: { id: gift.id } });
    expect(after.status).toBe("USED");
    expect(after.usedCount).toBe(1);
  });

  it("still holds the guarantee, which is the driver's own money back", async () => {
    await bookingGift();

    await createReservation({ userId: driverUserId, connectorId: connectorA, eta: inAnHour() });

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    // The fee would have taken 2 off the balance; the guarantee only reserves.
    expect(num(wallet.fiatBalance)).toBe(50);
    expect(num(wallet.reservedFiat)).toBe(5);
  });

  it("charges the listed fee for the next booking, the gift being spent", async () => {
    await bookingGift();
    const first = await createReservation({
      userId: driverUserId,
      connectorId: connectorA,
      eta: inAnHour(),
    });
    await cancelReservation(first.id, driverUserId);

    const second = await createReservation({
      userId: driverUserId,
      connectorId: connectorA,
      eta: inAnHour(),
    });

    expect(num(second.feeFiat)).toBe(2);
    expect(second.promoGrantId).toBeNull();
  });

  it("ignores a gift of another network", async () => {
    await bookingGift(otherOperatorId);

    const reservation = await createReservation({
      userId: driverUserId,
      connectorId: connectorA,
      eta: inAnHour(),
    });

    expect(num(reservation.feeFiat)).toBe(2);
    expect(reservation.promoGrantId).toBeNull();
  });

  it("charges for the extension, which the gift does not cover", async () => {
    await bookingGift();
    const reservation = await createReservation({
      userId: driverUserId,
      connectorId: connectorA,
      eta: new Date(Date.now() + 60_000),
    });

    const extended = await extendReservation({ reservationId: reservation.id, userId: driverUserId });

    expect(extended.extendCount).toBe(1);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    // The booking itself was free; the extension took its 1.
    expect(num(wallet.fiatBalance)).toBe(49);
  });

  it("gives one free booking, not two, when two taps arrive together", async () => {
    const gift = await bookingGift();

    const results = await Promise.allSettled([
      createReservation({ userId: driverUserId, connectorId: connectorA, eta: inAnHour() }),
      createReservation({ userId: driverUserId, connectorId: connectorB, eta: inAnHour() }),
    ]);

    const made = results.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createReservation>>> =>
        r.status === "fulfilled",
    );
    const free = made.filter((r) => num(r.value.feeFiat) === 0);
    expect(free).toHaveLength(1);
    const after = await prisma.promoGrant.findUniqueOrThrow({ where: { id: gift.id } });
    expect(after.usedCount).toBe(1);
  });
});
