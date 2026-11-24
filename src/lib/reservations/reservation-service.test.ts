// US-30, US-32, US-33, US-55 — ТЗ §32–§35 and §51.
//
// The rules of §34 are what this file is about: who may book, what has to
// stay free for whoever just turns up, what a change to the terms does to a
// booking that already exists, and what happens when nobody comes.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/exchange/decimal";
import { getOrCreateWallet } from "@/lib/exchange/wallet-service";
import {
  ReservationError,
  cancelReservation,
  cancelReservationsForConnector,
  closeExpiredReservations,
  createReservation,
  notifyClosedReservations,
  readPolicy,
  savePolicy,
} from "./reservation-service";

const PREFIX = "test_resv_";
const SLUG = `${PREFIX}net`;
const ZONE = "TESTRESV";

let operatorId: string;
let ownerUserId: string;
let driverUserId: string;
let strangerUserId: string;
let zoneId: string;
let coopId: string;
let pointId: string;
let connectorA: string;
let connectorB: string;

async function wipe() {
  await prisma.receipt.deleteMany({
    where: { reservation: { point: { operator: { slug: SLUG } } } },
  });
  await prisma.reservation.deleteMany({ where: { point: { operator: { slug: SLUG } } } });
  await prisma.reservationPolicy.deleteMany({
    where: { point: { operator: { slug: SLUG } } },
  });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.coopMember.deleteMany({ where: { coop: { name: { startsWith: PREFIX } } } });
  await prisma.cooperative.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE } } });
  await prisma.company.deleteMany({ where: { legalName: { startsWith: PREFIX } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE } });
}

async function fund(userId: string, amount: number) {
  const wallet = await getOrCreateWallet(userId, zoneId);
  await prisma.wallet.update({
    where: { id: wallet.id },
    data: { fiatBalance: new Prisma.Decimal(amount), reservedFiat: new Prisma.Decimal(0) },
  });
  return wallet.id;
}

async function seedUser(username: string) {
  return (
    await prisma.user.upsert({
      where: { username },
      update: {},
      create: { username, passwordHash: "x" },
    })
  ).id;
}

beforeAll(async () => {
  await wipe();

  ownerUserId = await seedUser(`${PREFIX}owner`);
  driverUserId = await seedUser(`${PREFIX}driver`);
  strangerUserId = await seedUser(`${PREFIX}stranger`);

  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE, country: "SK", name: "Reservation zone", currency: "EUR" },
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
  coopId = (
    await prisma.cooperative.create({
      data: { name: `${PREFIX}coop`, zoneId, companyId: company.id },
    })
  ).id;
  await prisma.coopMember.create({
    data: { coopId, userId: driverUserId, status: "ACTIVE", shares: 1, kycVerifiedAt: new Date() },
  });

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "Reservation test network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.receipt.deleteMany({
    where: { reservation: { point: { operator: { slug: SLUG } } } },
  });
  await prisma.reservation.deleteMany({ where: { point: { operatorId } } });
  await prisma.acceptancePoint.deleteMany({ where: { operatorId } });

  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId,
      type: "CHARGING_STATION",
      name: "Reservation point",
      status: "PUBLISHED",
      publishedAt: new Date(),
      country: "SK",
      city: "Barcelona",
      addressLine: "Carrer Gran 9",
      latitude: 41.4,
      longitude: 2.17,
      howToFind: "level -1",
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
    feeFiat: 0.5,
    guaranteeFiat: 5,
    noShowPenaltyFiat: 3,
    waitMinutes: 15,
    freeCancelMinutes: 30,
    maxAheadHours: 24,
  });

  await fund(driverUserId, 50);
  await fund(strangerUserId, 50);
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000);

describe("savePolicy and readPolicy — §33, US-32", () => {
  it("answers with sensible defaults before the owner has set anything", async () => {
    const other = await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "Untouched" },
    });

    const policy = await readPolicy(other.id);

    expect(policy.enabled).toBe(false);
    expect(policy.waitMinutes).toBeGreaterThan(0);
  });

  it("refuses to take settings from somebody else's network", async () => {
    await expect(
      savePolicy(pointId, strangerUserId, { feeFiat: 0 }),
    ).rejects.toThrow(/not your/i);
  });

  it("applies a change to new bookings and leaves the old one alone (US-32)", async () => {
    const before = await createReservation({
      userId: driverUserId,
      connectorId: connectorA,
      eta: inAnHour(),
    });

    await savePolicy(pointId, ownerUserId, { feeFiat: 2, guaranteeFiat: 20, noShowPenaltyFiat: 15 });

    // A different driver, because §34 allows one live booking each.
    const other = await seedUser(`${PREFIX}driver2`);
    await prisma.coopMember.upsert({
      where: { coopId_userId: { coopId, userId: other } },
      update: { status: "ACTIVE", kycVerifiedAt: new Date() },
      create: { coopId, userId: other, status: "ACTIVE", shares: 1, kycVerifiedAt: new Date() },
    });
    await fund(other, 50);

    const after = await createReservation({
      userId: other,
      connectorId: connectorB,
      eta: inAnHour(),
    });

    const stored = await prisma.reservation.findUniqueOrThrow({ where: { id: before.id } });
    expect(num(stored.feeFiat)).toBe(0.5);
    expect(num(stored.guaranteeFiat)).toBe(5);
    expect(num(after.feeFiat)).toBe(2);
    expect(num(after.guaranteeFiat)).toBe(20);
  });
});

describe("createReservation — §34, US-30", () => {
  it("takes the fee, holds the guarantee and marks the connector booked", async () => {
    const reservation = await createReservation({
      userId: driverUserId,
      connectorId: connectorA,
      eta: inAnHour(),
    });

    expect(reservation.status).toBe("ACTIVE");
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: reservation.walletId } });
    expect(num(wallet.fiatBalance)).toBe(49.5); // 50 − 0.50 fee
    expect(num(wallet.reservedFiat)).toBe(5); // the guarantee
    const connector = await prisma.pointConnector.findUniqueOrThrow({ where: { id: connectorA } });
    expect(connector.status).toBe("BOOKED");
  });

  it("sets the window from the estimated arrival and the waiting time", async () => {
    const eta = inAnHour();
    const reservation = await createReservation({
      userId: driverUserId,
      connectorId: connectorA,
      eta,
    });

    expect(reservation.windowStart.getTime()).toBe(eta.getTime());
    expect(reservation.windowEnd.getTime()).toBe(eta.getTime() + 15 * 60 * 1000);
  });

  it("refuses somebody who has not passed KYC (§34)", async () => {
    await expect(
      createReservation({ userId: strangerUserId, connectorId: connectorA, eta: inAnHour() }),
    ).rejects.toThrow(/kyc/i);
  });

  it("refuses a connector that is already booked", async () => {
    await createReservation({ userId: driverUserId, connectorId: connectorA, eta: inAnHour() });
    const second = await seedUser(`${PREFIX}second`);
    await prisma.coopMember.create({
      data: { coopId, userId: second, status: "ACTIVE", shares: 1, kycVerifiedAt: new Date() },
    });
    await fund(second, 50);

    await expect(
      createReservation({ userId: second, connectorId: connectorA, eta: inAnHour() }),
    ).rejects.toThrow(/not free/i);
  });

  it("keeps the walk-up connectors free (§33)", async () => {
    // Both connectors, one of which must stay free for whoever turns up.
    await savePolicy(pointId, ownerUserId, { walkUpConnectors: 1 });
    await createReservation({ userId: driverUserId, connectorId: connectorA, eta: inAnHour() });

    const second = await seedUser(`${PREFIX}third`);
    await prisma.coopMember.create({
      data: { coopId, userId: second, status: "ACTIVE", shares: 1, kycVerifiedAt: new Date() },
    });
    await fund(second, 50);

    await expect(
      createReservation({ userId: second, connectorId: connectorB, eta: inAnHour() }),
    ).rejects.toThrow(/walk-up/i);
  });

  it("refuses a booking further ahead than the owner allows", async () => {
    await expect(
      createReservation({
        userId: driverUserId,
        connectorId: connectorA,
        eta: new Date(Date.now() + 48 * 60 * 60 * 1000),
      }),
    ).rejects.toThrow(/ahead/i);
  });

  it("refuses a second live booking by the same driver (§34)", async () => {
    await createReservation({ userId: driverUserId, connectorId: connectorA, eta: inAnHour() });
    await expect(
      createReservation({ userId: driverUserId, connectorId: connectorB, eta: inAnHour() }),
    ).rejects.toThrow(/already/i);
  });

  it("refuses when the wallet cannot cover the fee and the guarantee", async () => {
    await fund(driverUserId, 1);
    await expect(
      createReservation({ userId: driverUserId, connectorId: connectorA, eta: inAnHour() }),
    ).rejects.toThrow(/funds/i);
  });

  it("refuses when the owner has not opened booking at all", async () => {
    await savePolicy(pointId, ownerUserId, { enabled: false });
    await expect(
      createReservation({ userId: driverUserId, connectorId: connectorA, eta: inAnHour() }),
    ).rejects.toThrow(/not open/i);
  });

  it("confirms well inside the three seconds US-30 allows", async () => {
    const started = Date.now();
    await createReservation({ userId: driverUserId, connectorId: connectorA, eta: inAnHour() });
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe("cancelReservation — §32.7", () => {
  it("gives the fee back when the driver cancels in good time", async () => {
    const reservation = await createReservation({
      userId: driverUserId,
      connectorId: connectorA,
      eta: new Date(Date.now() + 4 * 60 * 60 * 1000),
    });

    await cancelReservation(reservation.id, driverUserId);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: reservation.walletId } });
    expect(num(wallet.fiatBalance)).toBe(50);
    expect(num(wallet.reservedFiat)).toBe(0);
    const connector = await prisma.pointConnector.findUniqueOrThrow({ where: { id: connectorA } });
    expect(connector.status).toBe("FREE");
  });

  it("keeps the fee when the driver cancels too late — the place was held", async () => {
    const reservation = await createReservation({
      userId: driverUserId,
      connectorId: connectorA,
      eta: new Date(Date.now() + 10 * 60 * 1000),
    });

    await cancelReservation(reservation.id, driverUserId);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: reservation.walletId } });
    expect(num(wallet.fiatBalance)).toBe(49.5);
    expect(num(wallet.reservedFiat)).toBe(0);
  });

  it("refuses to cancel somebody else's booking", async () => {
    const reservation = await createReservation({
      userId: driverUserId,
      connectorId: connectorA,
      eta: inAnHour(),
    });
    await expect(cancelReservation(reservation.id, strangerUserId)).rejects.toThrow(
      ReservationError,
    );
  });
});

describe("closeExpiredReservations — US-33", () => {
  it("charges the no-show penalty out of the guarantee and leaves a receipt", async () => {
    const reservation = await createReservation({
      userId: driverUserId,
      connectorId: connectorA,
      eta: inAnHour(),
    });
    // The window has come and gone.
    await prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        windowStart: new Date(Date.now() - 60 * 60 * 1000),
        windowEnd: new Date(Date.now() - 30 * 60 * 1000),
      },
    });

    const closed = await closeExpiredReservations();

    expect(closed).toBe(1);
    const stored = await prisma.reservation.findUniqueOrThrow({
      where: { id: reservation.id },
      include: { receipt: true },
    });
    expect(stored.status).toBe("NO_SHOW");
    expect(num(stored.penaltyFiat!)).toBe(3);
    expect(stored.receipt).not.toBeNull();
    expect(num(stored.receipt!.totalFiat)).toBe(3);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: reservation.walletId } });
    // 50 − 0.50 fee − 3 penalty; the rest of the guarantee came back.
    expect(num(wallet.fiatBalance)).toBe(46.5);
    expect(num(wallet.reservedFiat)).toBe(0);
    const connector = await prisma.pointConnector.findUniqueOrThrow({ where: { id: connectorA } });
    expect(connector.status).toBe("FREE");
  });

  it("leaves a booking whose window is still open alone", async () => {
    await createReservation({ userId: driverUserId, connectorId: connectorA, eta: inAnHour() });
    expect(await closeExpiredReservations()).toBe(0);
  });
});

describe("cancelReservationsForConnector — US-55", () => {
  it("gives everything back when the station breaks, with no penalty", async () => {
    const reservation = await createReservation({
      userId: driverUserId,
      connectorId: connectorA,
      eta: inAnHour(),
    });

    const cancelled = await cancelReservationsForConnector(connectorA, "the cable is cut");

    expect(cancelled).toBe(1);
    const stored = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } });
    expect(stored.status).toBe("CANCELLED");
    expect(stored.penaltyFiat).toBeNull();
    expect(stored.closeReason).toContain("cable");

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: reservation.walletId } });
    expect(num(wallet.fiatBalance)).toBe(50); // fee refunded in full
    expect(num(wallet.reservedFiat)).toBe(0);
  });

  it("says nothing about a connector nobody booked", async () => {
    expect(await cancelReservationsForConnector(connectorB, "x")).toBe(0);
  });
});

describe("notifyClosedReservations — US-33 and US-55", () => {
  /** A letter can only go to a confirmed address, so the driver gets one. */
  async function withEmail() {
    await prisma.user.update({
      where: { id: driverUserId },
      data: { email: `${PREFIX}driver@example.test`, emailVerified: new Date() },
    });
  }

  function collector() {
    const sent: { to: string; subject: string; html: string }[] = [];
    return {
      sent,
      sendTo: async (to: string, subject: string, html: string) => {
        sent.push({ to, subject, html });
      },
    };
  }

  it("tells the driver what the no-show cost, and tells them once", async () => {
    await withEmail();
    const reservation = await createReservation({
      userId: driverUserId,
      connectorId: connectorA,
      eta: inAnHour(),
    });
    await prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        windowStart: new Date(Date.now() - 60 * 60 * 1000),
        windowEnd: new Date(Date.now() - 30 * 60 * 1000),
      },
    });
    await closeExpiredReservations();

    const mail = collector();
    expect(await notifyClosedReservations({ userIds: [driverUserId], sendTo: mail.sendTo })).toBe(1);
    expect(mail.sent[0].to).toContain(PREFIX);
    expect(mail.sent[0].html).toContain("3.00");

    // The second sweep a minute later must stay quiet.
    const again = collector();
    expect(await notifyClosedReservations({ userIds: [driverUserId], sendTo: again.sendTo })).toBe(0);
  });

  it("offers the nearest working points when the station broke (US-55)", async () => {
    await withEmail();
    const neighbour = await prisma.acceptancePoint.create({
      data: {
        operatorId,
        type: "CHARGING_STATION",
        name: "Reservation neighbour",
        status: "PUBLISHED",
        publishedAt: new Date(),
        country: "SK",
        city: "Barcelona",
        addressLine: "Carrer Gran 11",
        latitude: 41.41,
        longitude: 2.18,
        energySource: "SOLAR",
        open24: true,
        paymentMethods: ["TOKEN"],
        gridZoneId: zoneId,
        connectors: {
          create: [
            {
              type: "CCS2",
              powerKw: new Prisma.Decimal(150),
              currentAc: false,
              quantity: 1,
              status: "FREE",
            },
          ],
        },
      },
    });

    await createReservation({ userId: driverUserId, connectorId: connectorA, eta: inAnHour() });
    await cancelReservationsForConnector(connectorA, "the cable is cut");

    const mail = collector();
    expect(await notifyClosedReservations({ userIds: [driverUserId], sendTo: mail.sendTo })).toBe(1);
    expect(mail.sent[0].html).toContain(neighbour.name);
  });

  it("stays quiet about a booking the driver cancelled themselves", async () => {
    await withEmail();
    const reservation = await createReservation({
      userId: driverUserId,
      connectorId: connectorA,
      eta: inAnHour(),
    });
    await cancelReservation(reservation.id, driverUserId);

    const mail = collector();
    expect(await notifyClosedReservations({ userIds: [driverUserId], sendTo: mail.sendTo })).toBe(0);
  });
});
