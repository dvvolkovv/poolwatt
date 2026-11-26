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
  expireStaleSessions,
  finishSession,
  readActiveSession,
  reportMeter,
  type SessionView,
} from "./charge-session";
import { issuePointKey } from "@/lib/points/point-availability";
import { restCanonicalString, signCanonical } from "./equipment-signature";
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
    book: { amountKwh: 100, price: 0.2 },
  });
});

afterAll(async () => {
  await wipeChargePoint(PREFIX, ZONE_CODE);
});

/**
 * Отчёт оборудования так, как он приходит по-настоящему: с подписью §15.
 * Ключ без секрета подписи в этом окружении не выдаётся (`API_KEY_ENC_KEY`
 * настроен), поэтому неподписанный отчёт здесь и должен отвергаться.
 */
async function signedMeter(args: {
  sessionId: string;
  token: string;
  signingSecret: string | null;
  kwhTotal: number;
  powerKw?: number | null;
}) {
  const path = `/v1/charge-sessions/${args.sessionId}/meter`;
  const body = { kwhTotal: args.kwhTotal, powerKw: args.powerKw ?? null };
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = args.signingSecret
    ? signCanonical(
        args.signingSecret,
        restCanonicalString({
          timestamp,
          method: "POST",
          path,
          body: JSON.stringify(body),
        }),
      )
    : null;
  return reportMeter({
    sessionId: args.sessionId,
    token: args.token,
    body,
    signature,
    timestamp: args.signingSecret ? timestamp : null,
    path,
  });
}

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

  it("reserves money with the §16.6 buffer when energy is bought on the market", async () => {
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

  it("§16.7 — refuses what the book cannot serve instead of promising it", async () => {
    // Раньше расчёт обещал ступень агрегатора, а списание её не исполняло:
    // водитель видел цену, подтверждал, и сеанс падал с «market order could
    // not be filled». Теперь ступень закрыта гейтом, и отказ приходит до
    // того, как что-то занято.
    await prisma.wallet.update({
      where: { id: fx.walletId },
      data: { kwhBalance: 0 },
    });
    await prisma.order.updateMany({
      where: { zoneId: fx.zoneId, side: "SELL" },
      data: { status: "CANCELLED" },
    });

    await expect(
      authorizeSession({
        userId: fx.driverUserId,
        pointId: fx.pointId,
        connectorId: fx.connectorId,
        plannedKwh: 5,
        idempotencyKey: key("agg"),
      }),
    ).rejects.toThrow(/can serve this session/i);

    const connector = await prisma.pointConnector.findUniqueOrThrow({
      where: { id: fx.connectorId },
    });
    expect(connector.status).toBe(ConnectorStatus.FREE);
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
    ).rejects.toThrow(/money balance/i);
  });
});

describe("reportMeter", () => {
  let issued: Awaited<ReturnType<typeof issuePointKey>>;
  let session: SessionView;

  beforeEach(async () => {
    issued = await issuePointKey(fx.pointId, fx.operatorUserId, "test");
    session = await authorizeSession({
      userId: fx.driverUserId,
      pointId: fx.pointId,
      connectorId: fx.connectorId,
      plannedKwh: 10,
      idempotencyKey: key("m"),
    });
  });

  function meter(kwhTotal: number, powerKw?: number) {
    return signedMeter({
      sessionId: session.id,
      token: issued.token,
      signingSecret: issued.signingSecret,
      kwhTotal,
      powerKw: powerKw ?? null,
    });
  }

  it("the first report starts the session", async () => {
    const after = await meter(1.25, 48);

    expect(after.status).toBe("ACTIVE");
    expect(after.deliveredKwh).toBe(1.25);
    expect(after.startedAt).not.toBeNull();

    const ticks = await prisma.chargeSessionTick.findMany({
      where: { sessionId: session.id },
    });
    expect(ticks).toHaveLength(1);
    expect(Number(ticks[0]!.powerKw)).toBe(48);
  });

  it("the meter only goes up", async () => {
    await meter(4);
    await expect(meter(3.5)).rejects.toThrow(/cannot be lower/i);
  });

  it("the same reading twice is not news but not an error", async () => {
    await meter(4);
    const again = await meter(4);
    expect(again.deliveredKwh).toBe(4);
  });

  it("refuses the key of another point", async () => {
    const other = await prisma.chargerOperator.create({
      data: {
        slug: `${PREFIX}other`,
        displayName: `${PREFIX} other`,
        claimedById: fx.operatorUserId,
        claimedAt: new Date(),
      },
    });
    const otherPoint = await prisma.acceptancePoint.create({
      data: { operatorId: other.id, type: "CHARGING_STATION", name: "Theirs" },
    });
    const otherKey = await issuePointKey(otherPoint.id, fx.operatorUserId, "test");

    await expect(
      signedMeter({
        sessionId: session.id,
        token: otherKey.token,
        signingSecret: otherKey.signingSecret,
        kwhTotal: 1,
      }),
    ).rejects.toThrow(/another point/i);
  });

  it("refuses an unknown key", async () => {
    await expect(
      signedMeter({
        sessionId: session.id,
        token: "pwp_nonsense",
        signingSecret: issued.signingSecret,
        kwhTotal: 1,
      }),
    ).rejects.toThrow(/unknown or revoked/i);
  });

  it("refuses the right key without a signature", async () => {
    await expect(
      reportMeter({
        sessionId: session.id,
        token: issued.token,
        body: { kwhTotal: 1 },
        signature: null,
        timestamp: null,
        path: `/v1/charge-sessions/${session.id}/meter`,
      }),
    ).rejects.toThrow(/signature/i);
  });

  it("refuses a session that is already settled", async () => {
    await meter(2);
    await finishSession({ sessionId: session.id, reason: "test" });
    await expect(meter(9)).rejects.toThrow(/not running/i);
  });
});

describe("finishSession", () => {

  it("settles on what was delivered, not on what was planned", async () => {
    const issued = await issuePointKey(fx.pointId, fx.operatorUserId, "test");
    const session = await authorizeSession({
      userId: fx.driverUserId,
      pointId: fx.pointId,
      connectorId: fx.connectorId,
      plannedKwh: 20,
      idempotencyKey: key("f1"),
    });
    await signedMeter({
      sessionId: session.id,
      token: issued.token,
      signingSecret: issued.signingSecret,
      kwhTotal: 7.5,
    });

    const done = await finishSession({
      sessionId: session.id,
      reason: "the equipment reported the end",
    });

    expect(done.status).toBe("COMPLETED");
    expect(done.deliveredKwh).toBe(7.5);
    expect(done.paymentId).not.toBeNull();

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: done.paymentId! },
      include: { receipt: true },
    });
    expect(Number(payment.requestedKwh)).toBe(7.5);
    expect(payment.pointId).toBe(fx.pointId);
    expect(payment.connectorId).toBe(fx.connectorId);
    expect(payment.receipt).not.toBeNull();

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: fx.walletId } });
    expect(Number(wallet.reservedFiat)).toBe(0);
    expect(Number(wallet.kwhBalance)).toBeCloseTo(22.5, 3);

    const connector = await prisma.pointConnector.findUniqueOrThrow({
      where: { id: fx.connectorId },
    });
    expect(connector.status).toBe(ConnectorStatus.FREE);
  });

  it("a session nobody charged costs nothing", async () => {
    const session = await authorizeSession({
      userId: fx.driverUserId,
      pointId: fx.pointId,
      connectorId: fx.connectorId,
      plannedKwh: 10,
      idempotencyKey: key("f2"),
    });

    const done = await finishSession({ sessionId: session.id, reason: "driver cancelled" });

    expect(done.status).toBe("CANCELLED");
    expect(done.paymentId).toBeNull();
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: fx.walletId } });
    expect(Number(wallet.kwhBalance)).toBe(30);
    expect(await prisma.payment.count({ where: { walletId: fx.walletId } })).toBe(0);
  });

  it("settling twice settles once", async () => {
    const issued = await issuePointKey(fx.pointId, fx.operatorUserId, "test");
    const session = await authorizeSession({
      userId: fx.driverUserId,
      pointId: fx.pointId,
      connectorId: fx.connectorId,
      plannedKwh: 10,
      idempotencyKey: key("f3"),
    });
    await signedMeter({
      sessionId: session.id,
      token: issued.token,
      signingSecret: issued.signingSecret,
      kwhTotal: 3,
    });

    const first = await finishSession({ sessionId: session.id, reason: "a" });
    const again = await finishSession({ sessionId: session.id, reason: "b" });

    expect(again.paymentId).toBe(first.paymentId);
    expect(await prisma.payment.count({ where: { walletId: fx.walletId } })).toBe(1);
  });

  it("the balance that dropped mid-session is bought on the market instead", async () => {
    const issued = await issuePointKey(fx.pointId, fx.operatorUserId, "test");
    const session = await authorizeSession({
      userId: fx.driverUserId,
      pointId: fx.pointId,
      connectorId: fx.connectorId,
      plannedKwh: 10,
      idempotencyKey: key("f4"),
    });
    await signedMeter({
      sessionId: session.id,
      token: issued.token,
      signingSecret: issued.signingSecret,
      kwhTotal: 10,
    });

    // Пока шла зарядка, кВт·ч ушли: водопад §16.6 обязан пересчитаться.
    await prisma.energyToken.deleteMany({ where: { ownerWalletId: fx.walletId } });
    await prisma.wallet.update({
      where: { id: fx.walletId },
      data: { kwhBalance: 0 },
    });

    const done = await finishSession({ sessionId: session.id, reason: "end" });

    expect(done.status).toBe("COMPLETED");
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: done.paymentId! },
    });
    expect(Number(payment.kwhFromBalance)).toBe(0);
    expect(Number(payment.amountFiat)).toBeGreaterThan(0);
  });

  it("expires a session the equipment never reported", async () => {
    const session = await authorizeSession({
      userId: fx.driverUserId,
      pointId: fx.pointId,
      connectorId: fx.connectorId,
      plannedKwh: 10,
      idempotencyKey: key("f5"),
    });
    await prisma.chargeSession.update({
      where: { id: session.id },
      data: { createdAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const swept = await expireStaleSessions(new Date());
    expect(swept).toBe(1);

    const after = await prisma.chargeSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(after.status).toBe("EXPIRED");
    const connector = await prisma.pointConnector.findUniqueOrThrow({
      where: { id: fx.connectorId },
    });
    expect(connector.status).toBe(ConnectorStatus.FREE);
    expect(await prisma.payment.count({ where: { walletId: fx.walletId } })).toBe(0);
  });

  it("leaves a young session alone", async () => {
    await authorizeSession({
      userId: fx.driverUserId,
      pointId: fx.pointId,
      connectorId: fx.connectorId,
      plannedKwh: 10,
      idempotencyKey: key("f6"),
    });
    expect(await expireStaleSessions(new Date())).toBe(0);
  });
});
