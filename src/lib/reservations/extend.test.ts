// US-31 — "Как водитель, хочу продлить бронь, если опаздываю."
//
// §32.4: "в пути приложение пересчитывает время прибытия; при опоздании
// предлагает продлить или перенести бронь." The window moves, the connector
// stays held, and the owner's own terms decide whether it may move at all and
// what it costs.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/exchange/decimal";
import {
  ReservationError,
  extendReservation,
  savePolicy,
} from "./reservation-service";

const PREFIX = "test_extend_";
const ZONE_CODE = "TESTEXTEND";

let zoneId: string;
let operatorId: string;
let ownerUserId: string;
let driverUserId: string;
let strangerUserId: string;
let pointId: string;
let connectorId: string;
let walletId: string;
let coopId: string;

async function wipe() {
  await prisma.reservation.deleteMany({ where: { wallet: { zone: { code: ZONE_CODE } } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.coopMember.deleteMany({ where: { coop: { name: { startsWith: PREFIX } } } });
  await prisma.cooperative.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.reservationPolicy.deleteMany({
    where: { point: { operator: { slug: { startsWith: PREFIX } } } },
  });
  await prisma.pricingRule.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.company.deleteMany({ where: { regNumber: `${PREFIX}reg` } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE_CODE } });
}

/** A live booking whose window ends in `minutes`. */
async function booking(args: {
  endsInMinutes: number;
  extendCount?: number;
  status?: "ACTIVE" | "FULFILLED";
}) {
  const end = new Date(Date.now() + args.endsInMinutes * 60_000);
  const start = new Date(end.getTime() - 15 * 60_000);
  await prisma.pointConnector.update({
    where: { id: connectorId },
    data: { status: "BOOKED" },
  });
  return prisma.reservation.create({
    data: {
      userId: driverUserId,
      pointId,
      connectorId,
      walletId,
      eta: start,
      windowStart: start,
      windowEnd: end,
      feeFiat: new Prisma.Decimal(2),
      guaranteeFiat: new Prisma.Decimal(5),
      noShowPenaltyFiat: new Prisma.Decimal(3),
      freeCancelMinutes: 30,
      currency: "EUR",
      status: args.status ?? "ACTIVE",
      extendCount: args.extendCount ?? 0,
    },
  });
}

beforeAll(async () => {
  await wipe();

  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE_CODE, country: "SK", name: "Extend zone", currency: "EUR" },
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
  ownerUserId = await user("owner");
  driverUserId = await user("driver");
  strangerUserId = await user("stranger");

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: `${PREFIX}net`,
        displayName: "Extend network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;

  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId,
      type: "CHARGING_STATION",
      name: "Extend point",
      status: "PUBLISHED",
      gridZoneId: zoneId,
      connectors: {
        create: [{ type: "CCS2", powerKw: new Prisma.Decimal(50), quantity: 1 }],
      },
    },
    include: { connectors: true },
  });
  pointId = point.id;
  connectorId = point.connectors[0]!.id;

  walletId = (
    await prisma.wallet.create({
      data: { ownerUserId: driverUserId, zoneId, fiatBalance: new Prisma.Decimal(50) },
    })
  ).id;

  // §34 needs a KYC-verified driver for booking; the same holds for extending.
  const company = await prisma.company.create({
    data: {
      legalName: "Extend coop company",
      country: "SK",
      regNumber: `${PREFIX}reg`,
      type: "COOPERATIVE",
      kybStatus: "APPROVED",
    },
  });
  coopId = (
    await prisma.cooperative.create({
      data: { companyId: company.id, zoneId, name: `${PREFIX}coop` },
    })
  ).id;
  await prisma.coopMember.create({
    data: {
      coopId,
      userId: driverUserId,
      shares: 1,
      status: "ACTIVE",
      kycVerifiedAt: new Date(),
    },
  });
});

beforeEach(async () => {
  await prisma.reservation.deleteMany({ where: { walletId } });
  await prisma.wallet.update({
    where: { id: walletId },
    data: { fiatBalance: new Prisma.Decimal(50), reservedFiat: new Prisma.Decimal(0) },
  });
  await savePolicy(pointId, ownerUserId, {
    enabled: true,
    extendAllowed: true,
    extendFeeFiat: 1,
    waitMinutes: 15,
  });
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("extendReservation — the window moves", () => {
  it("moves the end of the window by the owner's wait window", async () => {
    const r = await booking({ endsInMinutes: 5 });

    const extended = await extendReservation({
      reservationId: r.id,
      userId: driverUserId,
    });

    const minutes = Math.round(
      (extended.windowEnd.getTime() - r.windowEnd.getTime()) / 60_000,
    );
    expect(minutes).toBe(15);
    expect(extended.extendCount).toBe(1);
  });

  it("takes the owner's extension fee off the balance", async () => {
    const r = await booking({ endsInMinutes: 5 });
    await extendReservation({ reservationId: r.id, userId: driverUserId });

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    expect(num(wallet.fiatBalance)).toBe(49);
  });

  it("keeps the connector held — the point of extending", async () => {
    const r = await booking({ endsInMinutes: 5 });
    await extendReservation({ reservationId: r.id, userId: driverUserId });

    const connector = await prisma.pointConnector.findUniqueOrThrow({
      where: { id: connectorId },
    });
    expect(connector.status).toBe("BOOKED");
  });

  it("writes the extension to the audit log", async () => {
    const r = await booking({ endsInMinutes: 5 });
    await extendReservation({ reservationId: r.id, userId: driverUserId });

    const log = await prisma.auditLog.findFirst({
      where: { entity: "Reservation", entityId: r.id, action: "reservation.extended" },
    });
    expect(log).not.toBeNull();
  });

  it("extends free when the owner asks for nothing", async () => {
    await savePolicy(pointId, ownerUserId, { extendFeeFiat: 0 });
    const r = await booking({ endsInMinutes: 5 });
    await extendReservation({ reservationId: r.id, userId: driverUserId });

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    expect(num(wallet.fiatBalance)).toBe(50);
  });
});

describe("what the owner's terms refuse", () => {
  it("refuses when the owner does not allow extending", async () => {
    await savePolicy(pointId, ownerUserId, { extendAllowed: false });
    const r = await booking({ endsInMinutes: 5 });

    await expect(
      extendReservation({ reservationId: r.id, userId: driverUserId }),
    ).rejects.toThrow(/extend/i);
  });

  it("refuses when there is not enough money for the fee", async () => {
    await prisma.wallet.update({
      where: { id: walletId },
      data: { fiatBalance: new Prisma.Decimal(0.5) },
    });
    const r = await booking({ endsInMinutes: 5 });

    await expect(
      extendReservation({ reservationId: r.id, userId: driverUserId }),
    ).rejects.toThrow(/funds/i);
  });

  it("refuses more extensions than the owner allows", async () => {
    const r = await booking({ endsInMinutes: 5, extendCount: 2 });

    await expect(
      extendReservation({ reservationId: r.id, userId: driverUserId }),
    ).rejects.toThrow(/twice|already|more/i);
  });

  it("refuses a booking that is already over", async () => {
    const r = await booking({ endsInMinutes: -5, status: "FULFILLED" });

    await expect(
      extendReservation({ reservationId: r.id, userId: driverUserId }),
    ).rejects.toThrow(ReservationError);
  });

  it("refuses to extend a window that has already closed", async () => {
    const r = await booking({ endsInMinutes: -1 });

    await expect(
      extendReservation({ reservationId: r.id, userId: driverUserId }),
    ).rejects.toThrow(/closed|over|passed/i);
  });

  it("refuses somebody else's booking", async () => {
    const r = await booking({ endsInMinutes: 5 });

    await expect(
      extendReservation({ reservationId: r.id, userId: strangerUserId }),
    ).rejects.toThrow(/your/i);
  });

  it("refuses a booking that does not exist", async () => {
    await expect(
      extendReservation({ reservationId: "no-such-booking", userId: driverUserId }),
    ).rejects.toThrow(ReservationError);
  });
});

describe("the reminder US-31 asks for", () => {
  it("names the bookings whose window closes within ten minutes", async () => {
    const soon = await booking({ endsInMinutes: 8 });
    const { dueForExtendReminder } = await import("./reservation-service");

    const due = await dueForExtendReminder();
    expect(due.map((r) => r.id)).toContain(soon.id);
  });

  it("leaves alone a booking with plenty of time left", async () => {
    const later = await booking({ endsInMinutes: 40 });
    const { dueForExtendReminder } = await import("./reservation-service");

    const due = await dueForExtendReminder();
    expect(due.map((r) => r.id)).not.toContain(later.id);
  });

  it("does not remind twice about the same booking", async () => {
    const soon = await booking({ endsInMinutes: 8 });
    const { dueForExtendReminder, markExtendReminded } = await import("./reservation-service");

    await markExtendReminded(soon.id);
    const due = await dueForExtendReminder();
    expect(due.map((r) => r.id)).not.toContain(soon.id);
  });
});
