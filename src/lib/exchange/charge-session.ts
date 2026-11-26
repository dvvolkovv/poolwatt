// Сеанс зарядки — §16.6, §22.9, US-20.
//
// §16.6 описывает два момента: «сумма авторизуется с запасом Y %» в начале и
// «списывается по факту» в конце. До этого файла зарядка была одним неделимым
// вызовом `chargeSession`, поэтому показать её ход было нечем, а водителю
// некуда нажать (US-20 «не начата» именно поэтому).
//
// Команд станции здесь нет. Оборудование отчитывается само — тем же ключом
// пункта и подписью HMAC, которыми оно сообщает занятость разъёмов; мост OCPP
// стоит за закрытым гейтом `ocppOpen`.

import { createHash } from "node:crypto";
import {
  ChargeSessionStatus,
  ConnectorStatus,
  PointStatus,
  Prisma,
  ReservationStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { open } from "@/lib/crypto-box";
import { num } from "./decimal";
import { roundKwh, roundMoney } from "./precision";
import { quoteCharge, chargeSession as settleCharge } from "./payment-service";
import { getOrCreateWallet } from "./wallet-service";
import { writeAudit } from "./audit";
import { restCanonicalString, verifySignature } from "./equipment-signature";
import { notifyChargeSession, notifyWallets } from "./realtime-notify";
import type { ChargePlan } from "./charge";

export class ChargeSessionError extends Error {}

/** Сколько минут сеанс без единого отчёта считается живым. */
export const SESSION_TTL_MINUTES = 15;

const LIVE: ChargeSessionStatus[] = [
  ChargeSessionStatus.AUTHORIZED,
  ChargeSessionStatus.ACTIVE,
];

const WITH_NAMES = {
  point: { select: { name: true, addressLine: true, city: true } },
  connector: { select: { type: true, powerKw: true } },
} as const;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface SessionView {
  id: string;
  userId: string;
  status: ChargeSessionStatus;
  pointId: string;
  pointName: string;
  pointAddress: string;
  connectorId: string;
  connectorType: string;
  connectorPowerKw: number;
  zoneId: string;
  plannedKwh: number;
  deliveredKwh: number;
  authorizedFiat: number;
  currency: string;
  quote: ChargePlan;
  reservationId: string | null;
  paymentId: string | null;
  startedAt: Date | null;
  lastMeterAt: Date | null;
  endedAt: Date | null;
  closeReason: string | null;
  idempotentReplay: boolean;
}

type SessionRow = Prisma.ChargeSessionGetPayload<{ include: typeof WITH_NAMES }>;

function view(row: SessionRow, idempotentReplay = false): SessionView {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status,
    pointId: row.pointId,
    pointName: row.point.name,
    pointAddress: [row.point.addressLine, row.point.city].filter(Boolean).join(", "),
    connectorId: row.connectorId,
    connectorType: String(row.connector.type),
    connectorPowerKw: num(row.connector.powerKw),
    zoneId: row.zoneId,
    plannedKwh: num(row.plannedKwh),
    deliveredKwh: num(row.deliveredKwh),
    authorizedFiat: num(row.authorizedFiat),
    currency: row.currency,
    quote: row.quote as unknown as ChargePlan,
    reservationId: row.reservationId,
    paymentId: row.paymentId,
    startedAt: row.startedAt,
    lastMeterAt: row.lastMeterAt,
    endedAt: row.endedAt,
    closeReason: row.closeReason,
    idempotentReplay,
  };
}

export async function readActiveSession(userId: string): Promise<SessionView | null> {
  const row = await prisma.chargeSession.findFirst({
    where: { userId, status: { in: LIVE } },
    orderBy: { createdAt: "desc" },
    include: WITH_NAMES,
  });
  return row ? view(row) : null;
}

export async function readSession(id: string): Promise<SessionView | null> {
  const row = await prisma.chargeSession.findUnique({ where: { id }, include: WITH_NAMES });
  return row ? view(row) : null;
}

/** Последний отчёт счётчика — мощность для экрана зарядки. */
export async function readLastTick(
  sessionId: string,
): Promise<{ at: Date; kwhTotal: number; powerKw: number | null } | null> {
  const tick = await prisma.chargeSessionTick.findFirst({
    where: { sessionId },
    orderBy: { at: "desc" },
  });
  return tick
    ? {
        at: tick.at,
        kwhTotal: num(tick.kwhTotal),
        powerKw: tick.powerKw == null ? null : num(tick.powerKw),
      }
    : null;
}

/**
 * Сеанс, закончившийся только что. Нужен экрану зарядки: водитель отсоединил
 * кабель, живого сеанса больше нет, и первое, что он должен увидеть, — чем
 * всё кончилось и где чек, а не снова кнопку «сканировать».
 */
export async function readJustFinishedSession(
  userId: string,
  withinMinutes = 10,
): Promise<SessionView | null> {
  const since = new Date(Date.now() - withinMinutes * 60_000);
  const row = await prisma.chargeSession.findFirst({
    where: {
      userId,
      status: { notIn: LIVE },
      endedAt: { gte: since },
      deliveredKwh: { gt: 0 },
    },
    orderBy: { endedAt: "desc" },
    include: WITH_NAMES,
  });
  return row ? view(row) : null;
}

export interface AuthorizeArgs {
  userId: string;
  pointId: string;
  connectorId: string;
  plannedKwh: number;
  idempotencyKey: string;
}

/**
 * Первый момент §16.6. Разъём занимается под блокировкой строки, деньги
 * держатся тем же `reservedFiat`, что держит средства под заявкой на покупку,
 * а снимок расчёта остаётся в сеансе — чтобы спор «мне считали другое»
 * разбирался по тому, что водитель видел на экране.
 */
export async function authorizeSession(args: AuthorizeArgs): Promise<SessionView> {
  const plannedKwh = roundKwh(args.plannedKwh);
  if (!(plannedKwh > 0)) throw new ChargeSessionError("Planned kWh must be positive");

  const existing = await prisma.chargeSession.findUnique({
    where: { idempotencyKey: args.idempotencyKey },
    include: WITH_NAMES,
  });
  if (existing) return view(existing, true);

  const point = await prisma.acceptancePoint.findUnique({
    where: { id: args.pointId },
    select: { id: true, status: true, gridZoneId: true },
  });
  if (!point) throw new ChargeSessionError("No such point");
  if (point.status !== PointStatus.PUBLISHED) {
    throw new ChargeSessionError("This point is not open for charging");
  }
  if (!point.gridZoneId) {
    throw new ChargeSessionError("This point has no grid zone, so energy cannot be priced");
  }
  const zoneId = point.gridZoneId;

  const connector = await prisma.pointConnector.findUnique({
    where: { id: args.connectorId },
    select: { id: true, pointId: true },
  });
  if (!connector || connector.pointId !== point.id) {
    throw new ChargeSessionError("That connector belongs to a different point");
  }

  const wallet = await getOrCreateWallet(args.userId, zoneId);

  // Расчёт до всякой записи: сумма авторизации должна быть известна раньше,
  // чем мы что-то займём.
  const plan = await quoteCharge({
    userId: args.userId,
    zoneId,
    requestedKwh: plannedKwh,
    pointId: point.id,
    connectorId: connector.id,
  });
  if (!plan.feasible) {
    throw new ChargeSessionError(
      "Neither the balance, the order book nor the aggregator can serve this session",
    );
  }
  const authorizedFiat = roundMoney(plan.authorizedFiat);

  const created = await prisma.$transaction(async (tx) => {
    // Два водителя на один свободный разъём должны разойтись, а не поделить
    // его: состояние разъёма читается под блокировкой строки.
    const locked = await tx.$queryRaw<{ id: string; status: ConnectorStatus }[]>`
      SELECT id, status FROM "PointConnector" WHERE id = ${connector.id} FOR UPDATE`;
    const current = locked[0];
    if (!current) throw new ChargeSessionError("That connector is gone");

    // §32.5 — своя бронь на этом разъёме и есть разрешение его занять.
    const booking = await tx.reservation.findFirst({
      where: {
        userId: args.userId,
        connectorId: connector.id,
        status: { in: [ReservationStatus.CREATED, ReservationStatus.ACTIVE] },
      },
      orderBy: { windowStart: "asc" },
    });

    if (current.status === ConnectorStatus.OUT_OF_SERVICE) {
      throw new ChargeSessionError("This connector is out of service");
    }
    if (current.status === ConnectorStatus.BUSY) {
      throw new ChargeSessionError("This connector is busy right now");
    }
    if (current.status === ConnectorStatus.BOOKED && !booking) {
      throw new ChargeSessionError("This connector is booked by somebody else");
    }

    const live = await tx.chargeSession.findFirst({
      where: { userId: args.userId, status: { in: LIVE } },
      select: { id: true },
    });
    if (live) throw new ChargeSessionError("You already have a charging session running");

    if (authorizedFiat > 0) {
      const w = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      const free = roundMoney(num(w.fiatBalance) - num(w.reservedFiat));
      if (free + 0.005 < authorizedFiat) {
        throw new ChargeSessionError(
          `Money balance is ${free.toFixed(2)} ${w.currency}, the session needs ${authorizedFiat.toFixed(2)}`,
        );
      }
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { reservedFiat: { increment: new Prisma.Decimal(authorizedFiat) } },
      });
    }

    await tx.pointConnector.update({
      where: { id: connector.id },
      data: { status: ConnectorStatus.BUSY, statusAt: new Date() },
    });

    if (booking) {
      await tx.reservation.update({
        where: { id: booking.id },
        data: {
          status: ReservationStatus.FULFILLED,
          closedAt: new Date(),
          closeReason: "charging started",
        },
      });
    }

    const row = await tx.chargeSession.create({
      data: {
        userId: args.userId,
        walletId: wallet.id,
        zoneId,
        pointId: point.id,
        connectorId: connector.id,
        reservationId: booking?.id ?? null,
        plannedKwh: new Prisma.Decimal(plannedKwh),
        authorizedFiat: new Prisma.Decimal(authorizedFiat),
        currency: plan.currency,
        quote: plan as unknown as Prisma.InputJsonValue,
        idempotencyKey: args.idempotencyKey,
      },
      include: WITH_NAMES,
    });

    await writeAudit(tx, {
      actor: args.userId,
      entity: "ChargeSession",
      entityId: row.id,
      action: "charge.session.authorized",
      after: {
        plannedKwh,
        authorizedFiat,
        pointId: point.id,
        connectorId: connector.id,
        reservationId: booking?.id ?? null,
      },
    });

    return row;
  });

  const result = view(created);
  await notifyChargeSession(args.userId, "charge.started", result);
  if (authorizedFiat > 0) await notifyWallets([args.userId]);
  return result;
}

export interface MeterReport {
  sessionId: string;
  token: string;
  body: { kwhTotal: number; powerKw?: number | null };
  signature: string | null;
  timestamp: string | null;
  /** Маршрут так, как он подписан. */
  path: string;
  now?: Date;
}

/**
 * Оборудование говорит, сколько кВт·ч уже выдало. Чей это сеанс, решает не
 * заголовок, а то, что ключ принадлежит пункту сеанса: ключ соседнего пункта
 * той же сети не подойдёт.
 */
export async function reportMeter(report: MeterReport): Promise<SessionView> {
  const session = await prisma.chargeSession.findUnique({
    where: { id: report.sessionId },
    include: WITH_NAMES,
  });
  if (!session) throw new ChargeSessionError("No such session");

  const key = await prisma.pointApiKey.findUnique({
    where: { tokenHash: sha256(report.token) },
    select: {
      id: true,
      pointId: true,
      revokedAt: true,
      signingSecretEnc: true,
      signingSecretIv: true,
    },
  });
  if (!key || key.revokedAt) throw new ChargeSessionError("Unknown or revoked key");
  if (key.pointId !== session.pointId) {
    throw new ChargeSessionError("This key belongs to another point");
  }

  if (key.signingSecretEnc && key.signingSecretIv) {
    const secret = open(key.signingSecretEnc, key.signingSecretIv);
    const verdict = verifySignature({
      secret,
      signature: report.signature,
      timestamp: report.timestamp,
      canonical: restCanonicalString({
        timestamp: report.timestamp ?? "",
        method: "POST",
        path: report.path,
        body: JSON.stringify(report.body),
      }),
      now: report.now,
    });
    if (!verdict.ok) throw new ChargeSessionError(`Bad signature: ${verdict.reason}`);
  }

  if (!LIVE.includes(session.status)) {
    throw new ChargeSessionError("This session is not running");
  }

  const kwhTotal = roundKwh(report.body.kwhTotal);
  if (!(kwhTotal >= 0)) throw new ChargeSessionError("kwhTotal must not be negative");

  const now = report.now ?? new Date();
  const updated = await prisma.$transaction(async (tx) => {
    // Счётчик только растёт — и проверять это надо под блокировкой строки.
    // Иначе два отчёта, пришедшие вместе, оба видят прежнее значение, и
    // меньший записывается последним: 5 кВт·ч превращаются в 2.
    const locked = await tx.$queryRaw<{ deliveredKwh: string; status: ChargeSessionStatus }[]>`
      SELECT "deliveredKwh", status FROM "ChargeSession" WHERE id = ${session.id} FOR UPDATE`;
    const current = locked[0];
    if (!current) throw new ChargeSessionError("No such session");
    if (!LIVE.includes(current.status)) {
      throw new ChargeSessionError("This session is not running");
    }
    const already = Number(current.deliveredKwh);
    if (kwhTotal + 0.0005 < already) {
      throw new ChargeSessionError(
        `The meter cannot be lower than it was: ${kwhTotal} after ${already}`,
      );
    }

    await tx.chargeSessionTick.create({
      data: {
        sessionId: session.id,
        at: now,
        kwhTotal: new Prisma.Decimal(kwhTotal),
        powerKw:
          report.body.powerKw != null ? new Prisma.Decimal(report.body.powerKw) : null,
      },
    });
    await tx.pointApiKey.update({ where: { id: key.id }, data: { lastUsedAt: now } });
    return await tx.chargeSession.update({
      where: { id: session.id },
      data: {
        deliveredKwh: new Prisma.Decimal(kwhTotal),
        lastMeterAt: now,
        status: ChargeSessionStatus.ACTIVE,
        startedAt: session.startedAt ?? now,
      },
      include: WITH_NAMES,
    });
  });

  const result = view(updated);
  await notifyChargeSession(session.userId, "charge.tick", result, {
    powerKw: report.body.powerKw ?? null,
  });
  return result;
}

export interface FinishArgs {
  sessionId: string;
  reason: string;
  now?: Date;
}

/**
 * Второй момент §16.6 — «списывается по факту». Водопад считается заново
 * против настоящего баланса, настоящей книги и настоящей цены, потому что
 * между согласием и концом зарядки прошло время. Сеанс, в котором не выдали
 * ни одного кВт·ч, стоит ноль и не оставляет чека.
 */
export async function finishSession(args: FinishArgs): Promise<SessionView> {
  const now = args.now ?? new Date();

  // Блокировка сеанса: «водитель нажал завершить» и «станция сообщила об
  // окончании» приходят одновременно чаще, чем кажется, и платёж должен
  // родиться один.
  const claimed = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string; status: ChargeSessionStatus }[]>`
      SELECT id, status FROM "ChargeSession" WHERE id = ${args.sessionId} FOR UPDATE`;
    const row = locked[0];
    if (!row) return null;
    if (!LIVE.includes(row.status)) return "already" as const;

    // Резерв снимается и разъём освобождается здесь же: сам расчёт проверяет,
    // хватает ли свободных денег, а зарезервированные им же считаются
    // занятыми.
    const session = await tx.chargeSession.findUniqueOrThrow({
      where: { id: args.sessionId },
      select: { authorizedFiat: true, walletId: true, connectorId: true },
    });
    const hold = num(session.authorizedFiat);
    if (hold > 0) {
      await tx.wallet.update({
        where: { id: session.walletId },
        data: { reservedFiat: { decrement: new Prisma.Decimal(hold) } },
      });
    }
    await tx.pointConnector.update({
      where: { id: session.connectorId },
      data: { status: ConnectorStatus.FREE, statusAt: now },
    });
    // SETTLING-состояния нет: сеанс уходит сразу в своё окончание, а тот, кто
    // проиграл гонку, видит статус вне LIVE и возвращает готовое.
    return await tx.chargeSession.update({
      where: { id: args.sessionId },
      data: {
        authorizedFiat: new Prisma.Decimal(0),
        status: ChargeSessionStatus.CANCELLED,
        endedAt: now,
        closeReason: args.reason,
      },
      select: { id: true, userId: true, zoneId: true, pointId: true, connectorId: true, deliveredKwh: true, startedAt: true },
    });
  });

  if (claimed === null) throw new ChargeSessionError("No such session");
  if (claimed === "already") {
    const row = await prisma.chargeSession.findUniqueOrThrow({
      where: { id: args.sessionId },
      include: WITH_NAMES,
    });
    return view(row, true);
  }

  const delivered = roundKwh(num(claimed.deliveredKwh));

  if (delivered <= 0) {
    const row = await prisma.chargeSession.findUniqueOrThrow({
      where: { id: args.sessionId },
      include: WITH_NAMES,
    });
    const result = view(row);
    await notifyChargeSession(claimed.userId, "charge.completed", result);
    return result;
  }

  const payment = await settleCharge({
    userId: claimed.userId,
    zoneId: claimed.zoneId,
    requestedKwh: delivered,
    pointId: claimed.pointId,
    connectorId: claimed.connectorId,
    startedAt: claimed.startedAt,
    endedAt: now,
    idempotencyKey: `charge-session:${claimed.id}`,
  });

  const row = await prisma.chargeSession.update({
    where: { id: claimed.id },
    data: {
      status:
        payment.status === "FAILED"
          ? ChargeSessionStatus.FAILED
          : ChargeSessionStatus.COMPLETED,
      paymentId: payment.paymentId,
    },
    include: WITH_NAMES,
  });

  await writeAudit(prisma, {
    actor: claimed.userId,
    entity: "ChargeSession",
    entityId: claimed.id,
    action: "charge.session.settled",
    after: {
      deliveredKwh: delivered,
      paymentId: payment.paymentId,
      status: payment.status,
      reason: args.reason,
    },
  });

  const result = view(row);
  await notifyChargeSession(claimed.userId, "charge.completed", result);
  return result;
}

/**
 * Сеанс, о котором оборудование не отчиталось ни разу за TTL, снимается:
 * иначе разъём занят навсегда, а деньги водителя — в резерве.
 */
export async function expireStaleSessions(now = new Date()): Promise<number> {
  const deadline = new Date(now.getTime() - SESSION_TTL_MINUTES * 60_000);
  const stale = await prisma.chargeSession.findMany({
    where: {
      status: ChargeSessionStatus.AUTHORIZED,
      lastMeterAt: null,
      createdAt: { lt: deadline },
    },
    select: { id: true },
  });

  let swept = 0;
  for (const row of stale) {
    try {
      const done = await finishSession({
        sessionId: row.id,
        reason: `no meter report within ${SESSION_TTL_MINUTES} minutes`,
        now,
      });
      if (!done.idempotentReplay) {
        await prisma.chargeSession.update({
          where: { id: row.id },
          data: { status: ChargeSessionStatus.EXPIRED },
        });
        swept += 1;
      }
    } catch (err) {
      console.error("[charge-session] could not expire", row.id, err);
    }
  }
  return swept;
}
