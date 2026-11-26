// Сеанс зарядки — §16.6, §22.9, US-20.
//
// Два момента §16.6: авторизация с запасом Y % в начале и расчёт по факту в
// конце. Между ними отчёты оборудования, и именно они двигают цифру на экране
// водителя.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConnectorStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ChargeSessionError,
  authorizeSession,
  readActiveSession,
  reportMeter,
} from "./charge-session";
import {
  seedChargePoint,
  wipeChargePoint,
  type ChargePointFixture,
} from "./__fixtures__/charge-point";

const PREFIX = "test_chgses_";
const ZONE_CODE = "TESTCHGSES";

let fx: ChargePointFixture;

beforeAll(async () => {
  await wipeChargePoint(PREFIX, ZONE_CODE);
});

beforeEach(async () => {
  await wipeChargePoint(PREFIX, ZONE_CODE);
  fx = await seedChargePoint({
    prefix: PREFIX,
    zoneCode: ZONE_CODE,
    kwhBalance: 30,
    fiatBalance: 50,
    spotPrice: 0.2,
  });
});

afterAll(async () => {
  await wipeChargePoint(PREFIX, ZONE_CODE);
});

function key(tag: string): string {
  return `${PREFIX}${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("authorizeSession", () => {
  it("holds the connector and records what the driver saw", async () => {
    const session = await authorizeSession({
      userId: fx.driverUserId,
      pointId: fx.pointId,
      connectorId: fx.connectorId,
      plannedKwh: 10,
      idempotencyKey: key("a"),
    });

    expect(session.status).toBe("AUTHORIZED");
    expect(session.plannedKwh).toBe(10);
    // 10 кВт·ч при балансе 30 покрыты балансом целиком: денег не держим.
    expect(session.authorizedFiat).toBe(0);
    expect(session.quote.kwhFromBalance).toBe(10);

    const connector = await prisma.pointConnector.findUniqueOrThrow({
      where: { id: fx.connectorId },
    });
    expect(connector.status).toBe(ConnectorStatus.BUSY);

    const active = await readActiveSession(fx.driverUserId);
    expect(active?.id).toBe(session.id);
  });

  it("reserves money with the §16.6 buffer when energy has to be bought", async () => {
    await prisma.wallet.update({
      where: { id: fx.walletId },
      data: { kwhBalance: 0 },
    });

    const session = await authorizeSession({
      userId: fx.driverUserId,
      pointId: fx.pointId,
      connectorId: fx.connectorId,
      plannedKwh: 5,
      idempotencyKey: key("b"),
    });

    expect(session.authorizedFiat).toBeGreaterThan(0);
    // Запас Y % — авторизуем больше, чем стоит сам расчёт.
    expect(session.authorizedFiat).toBeGreaterThan(session.quote.total);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: fx.walletId } });
    expect(Number(wallet.reservedFiat)).toBeCloseTo(session.authorizedFiat, 2);
  });

  it("refuses a second live session for the same driver", async () => {
    await authorizeSession({
      userId: fx.driverUserId,
      pointId: fx.pointId,
      connectorId: fx.connectorId,
      plannedKwh: 4,
      idempotencyKey: key("c1"),
    });

    await expect(
      authorizeSession({
        userId: fx.driverUserId,
        pointId: fx.pointId,
        connectorId: fx.secondConnectorId,
        plannedKwh: 4,
        idempotencyKey: key("c2"),
      }),
    ).rejects.toThrow(/already have/i);
  });

  it("refuses a connector somebody else is using", async () => {
    await prisma.pointConnector.update({
      where: { id: fx.connectorId },
      data: { status: ConnectorStatus.BUSY },
    });

    await expect(
      authorizeSession({
        userId: fx.driverUserId,
        pointId: fx.pointId,
        connectorId: fx.connectorId,
        plannedKwh: 4,
        idempotencyKey: key("d"),
      }),
    ).rejects.toThrow(/busy/i);
  });

  it("refuses a connector booked by somebody else", async () => {
    await prisma.pointConnector.update({
      where: { id: fx.connectorId },
      data: { status: ConnectorStatus.BOOKED },
    });

    await expect(
      authorizeSession({
        userId: fx.driverUserId,
        pointId: fx.pointId,
        connectorId: fx.connectorId,
        plannedKwh: 4,
        idempotencyKey: key("e"),
      }),
    ).rejects.toThrow(/booked/i);
  });

  it("§32.5 — your own booking is what lets you take a booked connector", async () => {
    await prisma.pointConnector.update({
      where: { id: fx.connectorId },
      data: { status: ConnectorStatus.BOOKED },
    });
    const booking = await prisma.reservation.create({
      data: {
        userId: fx.driverUserId,
        pointId: fx.pointId,
        connectorId: fx.connectorId,
        walletId: fx.walletId,
        eta: new Date(),
        windowStart: new Date(Date.now() - 60_000),
        windowEnd: new Date(Date.now() + 15 * 60_000),
        feeFiat: 0.5,
        guaranteeFiat: 5,
        noShowPenaltyFiat: 3,
        freeCancelMinutes: 30,
        status: "ACTIVE",
      },
    });

    const session = await authorizeSession({
      userId: fx.driverUserId,
      pointId: fx.pointId,
      connectorId: fx.connectorId,
      plannedKwh: 4,
      idempotencyKey: key("f"),
    });

    expect(session.reservationId).toBe(booking.id);
    const after = await prisma.reservation.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after.status).toBe("FULFILLED");
  });

  it("refuses a point that is not published", async () => {
    await prisma.acceptancePoint.update({
      where: { id: fx.pointId },
      data: { status: "SUSPENDED" },
    });

    await expect(
      authorizeSession({
        userId: fx.driverUserId,
        pointId: fx.pointId,
        connectorId: fx.connectorId,
        plannedKwh: 4,
        idempotencyKey: key("g"),
      }),
    ).rejects.toThrow(/not open/i);
  });

  it("returns the same session for a repeated key", async () => {
    const k = key("h");
    const first = await authorizeSession({
      userId: fx.driverUserId,
      pointId: fx.pointId,
      connectorId: fx.connectorId,
      plannedKwh: 6,
      idempotencyKey: k,
    });
    const again = await authorizeSession({
      userId: fx.driverUserId,
      pointId: fx.pointId,
      connectorId: fx.connectorId,
      plannedKwh: 6,
      idempotencyKey: k,
    });

    expect(again.id).toBe(first.id);
    expect(again.idempotentReplay).toBe(true);
    expect(await prisma.chargeSession.count({ where: { idempotencyKey: k } })).toBe(1);
  });

  it("refuses more kWh than the driver can pay the hold for", async () => {
    await prisma.wallet.update({
      where: { id: fx.walletId },
      data: { kwhBalance: 0, fiatBalance: 0 },
    });

    await expect(
      authorizeSession({
        userId: fx.driverUserId,
        pointId: fx.pointId,
        connectorId: fx.connectorId,
        plannedKwh: 20,
        idempotencyKey: key("i"),
      }),
    ).rejects.toThrow(ChargeSessionError);
  });
});
