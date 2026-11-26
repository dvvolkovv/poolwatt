// Сеанс зарядки под одновременностью — §15 (идемпотентность), §16.6.
//
// Три гонки, каждая из которых в жизни случается: два водителя тянутся к
// одному свободному разъёму, палец нажимает «начать» дважды, и «водитель
// завершил» приходит вместе с «станция сообщила об окончании».

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConnectorStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorizeSession, finishSession, reportMeter } from "./charge-session";
import { restCanonicalString, signCanonical } from "./equipment-signature";
import { issuePointKey } from "@/lib/points/point-availability";
import {
  seedChargePoint,
  wipeChargePoint,
  type ChargePointFixture,
} from "./__fixtures__/charge-point";

const PREFIX = "test_chgrace_";
const ZONE_CODE = "TESTCHGRACE";

let fx: ChargePointFixture;

beforeAll(async () => {
  await wipeChargePoint(PREFIX, ZONE_CODE);
});

beforeEach(async () => {
  await wipeChargePoint(PREFIX, ZONE_CODE);
  fx = await seedChargePoint({
    prefix: PREFIX,
    zoneCode: ZONE_CODE,
    kwhBalance: 40,
    fiatBalance: 100,
    spotPrice: 0.2,
    book: { amountKwh: 100, price: 0.2 },
  });
});

afterAll(async () => {
  await wipeChargePoint(PREFIX, ZONE_CODE);
});

async function signedMeter(args: {
  sessionId: string;
  token: string;
  signingSecret: string | null;
  kwhTotal: number;
}) {
  const path = `/v1/charge-sessions/${args.sessionId}/meter`;
  const body = { kwhTotal: args.kwhTotal, powerKw: null };
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = args.signingSecret
    ? signCanonical(
        args.signingSecret,
        restCanonicalString({ timestamp, method: "POST", path, body: JSON.stringify(body) }),
      )
    : null;
  return reportMeter({
    sessionId: args.sessionId,
    token: args.token,
    body,
    signature,
    timestamp,
    path,
  });
}

describe("charge sessions under concurrency", () => {
  it("two drivers racing for one free connector: one wins", async () => {
    const second = await prisma.user.create({
      data: { username: `${PREFIX}driver2`, passwordHash: "x" },
    });
    await prisma.wallet.create({
      data: {
        ownerUserId: second.id,
        zoneId: fx.zoneId,
        kwhBalance: 40,
        fiatBalance: 100,
        currency: "EUR",
      },
    });

    const results = await Promise.allSettled([
      authorizeSession({
        userId: fx.driverUserId,
        pointId: fx.pointId,
        connectorId: fx.connectorId,
        plannedKwh: 5,
        idempotencyKey: `${PREFIX}race-a`,
      }),
      authorizeSession({
        userId: second.id,
        pointId: fx.pointId,
        connectorId: fx.connectorId,
        plannedKwh: 5,
        idempotencyKey: `${PREFIX}race-b`,
      }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await prisma.chargeSession.count({
        where: { connectorId: fx.connectorId, status: { in: ["AUTHORIZED", "ACTIVE"] } },
      }),
    ).toBe(1);
  });

  it("the same key twice gives one session", async () => {
    const k = `${PREFIX}same-key`;
    const results = await Promise.allSettled([
      authorizeSession({
        userId: fx.driverUserId,
        pointId: fx.pointId,
        connectorId: fx.connectorId,
        plannedKwh: 5,
        idempotencyKey: k,
      }),
      authorizeSession({
        userId: fx.driverUserId,
        pointId: fx.pointId,
        connectorId: fx.connectorId,
        plannedKwh: 5,
        idempotencyKey: k,
      }),
    ]);

    const ids = results
      .filter((r): r is PromiseFulfilledResult<{ id: string }> => r.status === "fulfilled")
      .map((r) => r.value.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(1);
    expect(await prisma.chargeSession.count({ where: { idempotencyKey: k } })).toBe(1);
  });

  it("two simultaneous endings pay once", async () => {
    const issued = await issuePointKey(fx.pointId, fx.operatorUserId, "race");
    const session = await authorizeSession({
      userId: fx.driverUserId,
      pointId: fx.pointId,
      connectorId: fx.connectorId,
      plannedKwh: 10,
      idempotencyKey: `${PREFIX}finish`,
    });
    await signedMeter({
      sessionId: session.id,
      token: issued.token,
      signingSecret: issued.signingSecret,
      kwhTotal: 6,
    });

    await Promise.allSettled([
      finishSession({ sessionId: session.id, reason: "driver" }),
      finishSession({ sessionId: session.id, reason: "equipment" }),
    ]);

    expect(await prisma.payment.count({ where: { walletId: fx.walletId } })).toBe(1);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: fx.walletId } });
    expect(Number(wallet.reservedFiat)).toBe(0);

    const connector = await prisma.pointConnector.findUniqueOrThrow({
      where: { id: fx.connectorId },
    });
    expect(connector.status).toBe(ConnectorStatus.FREE);

    const after = await prisma.chargeSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.status).toBe("COMPLETED");
    expect(Number(after.deliveredKwh)).toBe(6);
  });

  it("two meter reports at once leave the higher reading", async () => {
    const issued = await issuePointKey(fx.pointId, fx.operatorUserId, "race2");
    const session = await authorizeSession({
      userId: fx.driverUserId,
      pointId: fx.pointId,
      connectorId: fx.connectorId,
      plannedKwh: 10,
      idempotencyKey: `${PREFIX}ticks`,
    });

    await Promise.allSettled([
      signedMeter({
        sessionId: session.id,
        token: issued.token,
        signingSecret: issued.signingSecret,
        kwhTotal: 2,
      }),
      signedMeter({
        sessionId: session.id,
        token: issued.token,
        signingSecret: issued.signingSecret,
        kwhTotal: 5,
      }),
    ]);

    const after = await prisma.chargeSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(Number(after.deliveredKwh)).toBe(5);
  });
});
