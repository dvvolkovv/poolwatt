// US-34 — "Отчёт по дням, доход от броней и штрафов."
//
// The money is read off each booking, not recomputed from the policy: §54 says
// a change to the terms leaves existing bookings alone, so a report that
// recomputed would quietly rewrite last month.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readReservationStats } from "./reservation-stats";

const PREFIX = "test_resstat_";
const ZONE_CODE = "TESTRESSTAT";

let zoneId: string;
let operatorId: string;
let otherOperatorId: string;
let pointA: string;
let pointB: string;
let foreignPoint: string;
let connectorA: string;
let connectorB: string;
let foreignConnector: string;
let walletId: string;
let driverUserId: string;

const FROM = new Date(Date.UTC(2026, 4, 1));
const TO = new Date(Date.UTC(2026, 5, 1));

async function wipe() {
  await prisma.reservation.deleteMany({ where: { wallet: { zone: { code: ZONE_CODE } } } });
  await prisma.wallet.deleteMany({ where: { zone: { code: ZONE_CODE } } });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.gridZone.deleteMany({ where: { code: ZONE_CODE } });
}

async function booking(args: {
  connectorId: string;
  pointId: string;
  day: number;
  status: "CREATED" | "ACTIVE" | "FULFILLED" | "CANCELLED" | "NO_SHOW" | "EXPIRED";
  feeFiat?: number;
  penaltyFiat?: number | null;
  refundFiat?: number | null;
  hour?: number;
}) {
  const start = new Date(Date.UTC(2026, 4, args.day, args.hour ?? 10));
  return prisma.reservation.create({
    data: {
      userId: driverUserId,
      pointId: args.pointId,
      connectorId: args.connectorId,
      walletId,
      eta: start,
      windowStart: start,
      windowEnd: new Date(start.getTime() + 30 * 60_000),
      feeFiat: new Prisma.Decimal(args.feeFiat ?? 2),
      guaranteeFiat: new Prisma.Decimal(5),
      noShowPenaltyFiat: new Prisma.Decimal(3),
      freeCancelMinutes: 30,
      status: args.status,
      penaltyFiat: args.penaltyFiat == null ? null : new Prisma.Decimal(args.penaltyFiat),
      refundFiat: args.refundFiat == null ? null : new Prisma.Decimal(args.refundFiat),
    },
  });
}

beforeAll(async () => {
  await wipe();

  zoneId = (
    await prisma.gridZone.create({
      data: { code: ZONE_CODE, country: "SK", name: "Reservation stats zone", currency: "EUR" },
    })
  ).id;
  driverUserId = (
    await prisma.user.upsert({
      where: { username: `${PREFIX}driver` },
      update: {},
      create: { username: `${PREFIX}driver`, passwordHash: "x" },
    })
  ).id;
  walletId = (await prisma.wallet.create({ data: { ownerUserId: driverUserId, zoneId } })).id;

  operatorId = (
    await prisma.chargerOperator.create({
      data: { slug: `${PREFIX}net`, displayName: "Stats network" },
    })
  ).id;
  otherOperatorId = (
    await prisma.chargerOperator.create({
      data: { slug: `${PREFIX}other`, displayName: "Somebody else" },
    })
  ).id;

  const make = async (operator: string, name: string) => {
    const point = await prisma.acceptancePoint.create({
      data: {
        operatorId: operator,
        type: "CHARGING_STATION",
        name,
        gridZoneId: zoneId,
        connectors: {
          create: [{ type: "CCS2", powerKw: new Prisma.Decimal(50), quantity: 1 }],
        },
      },
      include: { connectors: true },
    });
    return { pointId: point.id, connectorId: point.connectors[0]!.id };
  };
  ({ pointId: pointA, connectorId: connectorA } = await make(operatorId, "A"));
  ({ pointId: pointB, connectorId: connectorB } = await make(operatorId, "B"));
  ({ pointId: foreignPoint, connectorId: foreignConnector } = await make(
    otherOperatorId,
    "Theirs",
  ));
});

beforeEach(async () => {
  await prisma.reservation.deleteMany({ where: { walletId } });
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

const stats = (over: Partial<Parameters<typeof readReservationStats>[0]> = {}) =>
  readReservationStats({ operatorId, pointIds: null, from: FROM, to: TO, ...over });

describe("readReservationStats — a row per day", () => {
  it("counts a day's bookings and what they earned", async () => {
    await booking({ connectorId: connectorA, pointId: pointA, day: 3, status: "FULFILLED", feeFiat: 2 });
    await booking({ connectorId: connectorB, pointId: pointB, day: 3, status: "FULFILLED", feeFiat: 3 });

    const report = await stats();

    expect(report.days).toHaveLength(1);
    expect(report.days[0].date).toBe("2026-05-03");
    expect(report.days[0].booked).toBe(2);
    expect(report.days[0].fulfilled).toBe(2);
    expect(report.days[0].feeFiat).toBe(5);
  });

  it("puts a no-show in its own column, with its penalty", async () => {
    await booking({
      connectorId: connectorA,
      pointId: pointA,
      day: 4,
      status: "NO_SHOW",
      feeFiat: 2,
      penaltyFiat: 3,
    });

    const report = await stats();
    expect(report.days[0].noShow).toBe(1);
    expect(report.days[0].penaltyFiat).toBe(3);
    expect(report.totals.penaltyFiat).toBe(3);
  });

  it("subtracts what was given back on a cancellation", async () => {
    await booking({
      connectorId: connectorA,
      pointId: pointA,
      day: 5,
      status: "CANCELLED",
      feeFiat: 2,
      refundFiat: 2,
    });

    const report = await stats();
    expect(report.days[0].cancelled).toBe(1);
    expect(report.days[0].refundFiat).toBe(2);
    // Nothing earned: the fee came back.
    expect(report.days[0].netFiat).toBe(0);
  });

  it("files a booking under the day it was for, not the day it was made", async () => {
    // Made now, for a slot on the 20th.
    await booking({ connectorId: connectorA, pointId: pointA, day: 20, status: "CREATED" });

    const report = await stats();
    expect(report.days[0].date).toBe("2026-05-20");
  });

  it("puts the days in order and leaves out the empty ones", async () => {
    await booking({ connectorId: connectorA, pointId: pointA, day: 10, status: "FULFILLED" });
    await booking({ connectorId: connectorA, pointId: pointA, day: 2, status: "FULFILLED" });
    await booking({ connectorId: connectorA, pointId: pointA, day: 25, status: "FULFILLED" });

    const report = await stats();
    expect(report.days.map((d) => d.date)).toEqual(["2026-05-02", "2026-05-10", "2026-05-25"]);
  });

  it("keeps a booking in the day the station is in, not in UTC's next one", async () => {
    // 23:30 on the 7th stays on the 7th.
    await booking({
      connectorId: connectorA,
      pointId: pointA,
      day: 7,
      hour: 23,
      status: "FULFILLED",
    });
    const report = await stats();
    expect(report.days[0].date).toBe("2026-05-07");
  });
});

describe("totals and the no-show share", () => {
  it("adds the period up and works out how often nobody turns up", async () => {
    await booking({ connectorId: connectorA, pointId: pointA, day: 1, status: "FULFILLED", feeFiat: 2 });
    await booking({ connectorId: connectorA, pointId: pointA, day: 2, status: "FULFILLED", feeFiat: 2 });
    await booking({ connectorId: connectorA, pointId: pointA, day: 3, status: "FULFILLED", feeFiat: 2 });
    await booking({
      connectorId: connectorA,
      pointId: pointA,
      day: 4,
      status: "NO_SHOW",
      feeFiat: 2,
      penaltyFiat: 3,
    });

    const report = await stats();
    expect(report.totals.booked).toBe(4);
    expect(report.totals.fulfilled).toBe(3);
    expect(report.totals.noShow).toBe(1);
    expect(report.totals.feeFiat).toBe(8);
    expect(report.totals.penaltyFiat).toBe(3);
    expect(report.totals.netFiat).toBe(11);
    expect(report.totals.noShowPct).toBe(25);
  });

  it("reports no share at all when there was nothing to turn up for", async () => {
    const report = await stats();
    expect(report.days).toEqual([]);
    expect(report.totals.booked).toBe(0);
    expect(report.totals.noShowPct).toBeNull();
  });
});

describe("whose bookings they are", () => {
  it("leaves out another network's bookings", async () => {
    await booking({
      connectorId: foreignConnector,
      pointId: foreignPoint,
      day: 6,
      status: "FULFILLED",
      feeFiat: 9,
    });

    const report = await stats();
    expect(report.totals.booked).toBe(0);
  });

  it("narrows to the points an employee was given (US-47)", async () => {
    await booking({ connectorId: connectorA, pointId: pointA, day: 8, status: "FULFILLED", feeFiat: 2 });
    await booking({ connectorId: connectorB, pointId: pointB, day: 8, status: "FULFILLED", feeFiat: 7 });

    const all = await stats();
    expect(all.totals.feeFiat).toBe(9);

    const onlyA = await stats({ pointIds: [pointA] });
    expect(onlyA.totals.feeFiat).toBe(2);
  });

  it("leaves out a booking outside the window", async () => {
    await booking({ connectorId: connectorA, pointId: pointA, day: 9, status: "FULFILLED" });

    const april = await readReservationStats({
      operatorId,
      pointIds: null,
      from: new Date(Date.UTC(2026, 3, 1)),
      to: new Date(Date.UTC(2026, 4, 1)),
    });
    expect(april.totals.booked).toBe(0);
  });

  it("breaks the period down by point, so the owner sees which one is used", async () => {
    await booking({ connectorId: connectorA, pointId: pointA, day: 11, status: "FULFILLED", feeFiat: 2 });
    await booking({ connectorId: connectorA, pointId: pointA, day: 12, status: "NO_SHOW", feeFiat: 2, penaltyFiat: 3 });
    await booking({ connectorId: connectorB, pointId: pointB, day: 11, status: "FULFILLED", feeFiat: 7 });

    const report = await stats();
    expect(report.points).toHaveLength(2);
    const a = report.points.find((p) => p.pointId === pointA)!;
    expect(a.pointName).toBe("A");
    expect(a.booked).toBe(2);
    expect(a.noShow).toBe(1);
    expect(a.netFiat).toBe(7);
  });
});
