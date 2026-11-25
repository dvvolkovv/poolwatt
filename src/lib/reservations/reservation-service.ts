// Booking a connector — ТЗ §32–§35, US-30, US-32, US-33, and §51's US-55.
//
// Money moves on the wallet, not on a card: §33 asks for a hold on a card,
// and there is no card processing yet (it is one of the owner's open
// questions). The wallet already holds money against an exchange order the
// same way, so the guarantee is held the same way here. When processing
// exists the hold moves to the card; the rule about how much stays.

import {
  ConnectorStatus,
  Prisma,
  ReservationStatus,
  type Reservation,
  type ReservationPolicy,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/exchange/audit";
import { num } from "@/lib/exchange/decimal";
import { hasVerifiedKyc } from "@/lib/exchange/membership";
import { roundMoney } from "@/lib/exchange/precision";
import { getOrCreateWallet } from "@/lib/exchange/wallet-service";
import { nearestWorkingPoints } from "@/lib/points/point-search";
import { receiptStamp } from "@/lib/receipts/receipt-number";
import { recordPricingChange } from "@/lib/pricing/pricing-service";

export class ReservationError extends Error {}

/** A booking is alive while it is one of these. */
const LIVE: ReservationStatus[] = [ReservationStatus.CREATED, ReservationStatus.ACTIVE];

export interface PolicyView {
  pointId: string;
  enabled: boolean;
  bookableConnectorIds: string[];
  walkUpConnectors: number;
  feeFiat: number;
  feeTokens: number;
  currency: string;
  feeCountsTowards: boolean;
  guaranteeFiat: number;
  noShowPenaltyFiat: number;
  waitMinutes: number;
  freeCancelMinutes: number;
  maxAheadHours: number;
  extendAllowed: boolean;
  extendFeeFiat: number;
  coopFree: boolean;
}

const DEFAULTS: Omit<PolicyView, "pointId"> = {
  enabled: false,
  bookableConnectorIds: [],
  walkUpConnectors: 1,
  feeFiat: 0,
  feeTokens: 0,
  currency: "EUR",
  feeCountsTowards: true,
  guaranteeFiat: 0,
  noShowPenaltyFiat: 0,
  waitMinutes: 15,
  freeCancelMinutes: 30,
  maxAheadHours: 24,
  extendAllowed: true,
  extendFeeFiat: 0,
  coopFree: false,
};

function toView(pointId: string, row: ReservationPolicy | null): PolicyView {
  if (!row) return { pointId, ...DEFAULTS };
  return {
    pointId,
    enabled: row.enabled,
    bookableConnectorIds: row.bookableConnectorIds,
    walkUpConnectors: row.walkUpConnectors,
    feeFiat: num(row.feeFiat),
    feeTokens: num(row.feeTokens),
    currency: row.currency,
    feeCountsTowards: row.feeCountsTowards,
    guaranteeFiat: num(row.guaranteeFiat),
    noShowPenaltyFiat: num(row.noShowPenaltyFiat),
    waitMinutes: row.waitMinutes,
    freeCancelMinutes: row.freeCancelMinutes,
    maxAheadHours: row.maxAheadHours,
    extendAllowed: row.extendAllowed,
    extendFeeFiat: num(row.extendFeeFiat),
    coopFree: row.coopFree,
  };
}

export async function readPolicy(pointId: string): Promise<PolicyView> {
  const row = await prisma.reservationPolicy.findUnique({ where: { pointId } });
  return toView(pointId, row);
}

export type PolicyInput = Partial<Omit<PolicyView, "pointId">>;

export async function savePolicy(
  pointId: string,
  actorUserId: string,
  input: PolicyInput,
): Promise<PolicyView> {
  const point = await prisma.acceptancePoint.findUnique({
    where: { id: pointId },
    include: { operator: { select: { claimedById: true } } },
  });
  if (!point) throw new ReservationError("Point not found");
  if (point.operator.claimedById !== actorUserId) {
    throw new ReservationError("Not your network");
  }

  const before = await prisma.reservationPolicy.findUnique({ where: { pointId } });
  const data = {
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.bookableConnectorIds ? { bookableConnectorIds: input.bookableConnectorIds } : {}),
    ...(input.walkUpConnectors !== undefined
      ? { walkUpConnectors: Math.max(0, Math.trunc(input.walkUpConnectors)) }
      : {}),
    ...(input.feeFiat !== undefined ? { feeFiat: new Prisma.Decimal(input.feeFiat) } : {}),
    ...(input.feeTokens !== undefined ? { feeTokens: new Prisma.Decimal(input.feeTokens) } : {}),
    ...(input.currency ? { currency: input.currency } : {}),
    ...(input.feeCountsTowards !== undefined
      ? { feeCountsTowards: input.feeCountsTowards }
      : {}),
    ...(input.guaranteeFiat !== undefined
      ? { guaranteeFiat: new Prisma.Decimal(input.guaranteeFiat) }
      : {}),
    ...(input.noShowPenaltyFiat !== undefined
      ? { noShowPenaltyFiat: new Prisma.Decimal(input.noShowPenaltyFiat) }
      : {}),
    ...(input.waitMinutes !== undefined ? { waitMinutes: input.waitMinutes } : {}),
    ...(input.freeCancelMinutes !== undefined
      ? { freeCancelMinutes: input.freeCancelMinutes }
      : {}),
    ...(input.maxAheadHours !== undefined ? { maxAheadHours: input.maxAheadHours } : {}),
    ...(input.extendAllowed !== undefined ? { extendAllowed: input.extendAllowed } : {}),
    ...(input.extendFeeFiat !== undefined
      ? { extendFeeFiat: new Prisma.Decimal(input.extendFeeFiat) }
      : {}),
    ...(input.coopFree !== undefined ? { coopFree: input.coopFree } : {}),
  };

  const row = await prisma.$transaction(async (tx) => {
    const saved = await tx.reservationPolicy.upsert({
      where: { pointId },
      update: data,
      create: { pointId, ...data },
    });

    // §54 — the booking terms a driver is quoted have to be reconstructible
    // after the owner changes them.
    await recordPricingChange(tx, {
      scope: "RESERVATION_POLICY",
      scopeId: pointId,
      operatorId: point.operatorId,
      params: toView(pointId, saved) as unknown as Prisma.InputJsonValue,
      actorId: actorUserId,
    });

    await writeAudit(tx, {
      actor: actorUserId,
      entity: "ReservationPolicy",
      entityId: saved.id,
      action: "reservation.policy.saved",
      before: before ? toView(pointId, before) : null,
      after: toView(pointId, saved),
    });

    return saved;
  });
  return toView(pointId, row);
}

export interface CreateReservationArgs {
  userId: string;
  connectorId: string;
  eta: Date;
}

/**
 * US-30. Everything the §34 rules ask is checked inside one transaction, so
 * two drivers cannot take the last connector at the same moment.
 */
export async function createReservation(
  args: CreateReservationArgs,
): Promise<Reservation> {
  const connector = await prisma.pointConnector.findUnique({
    where: { id: args.connectorId },
    include: { point: { select: { id: true, gridZoneId: true, status: true } } },
  });
  if (!connector) throw new ReservationError("Connector not found");
  if (connector.point.status !== "PUBLISHED") {
    throw new ReservationError("This point is not open to drivers");
  }

  const policy = await readPolicy(connector.point.id);
  if (!policy.enabled) throw new ReservationError("Booking is not open at this point");
  if (
    policy.bookableConnectorIds.length > 0 &&
    !policy.bookableConnectorIds.includes(connector.id)
  ) {
    throw new ReservationError("This connector is not open to booking");
  }

  // §34 — only a driver who has passed KYC.
  if (!(await hasVerifiedKyc(prisma, args.userId))) {
    throw new ReservationError("Booking needs a completed KYC");
  }

  const now = new Date();
  if (args.eta.getTime() < now.getTime() - 60_000) {
    throw new ReservationError("That arrival time is in the past");
  }
  if (args.eta.getTime() > now.getTime() + policy.maxAheadHours * 3_600_000) {
    throw new ReservationError(
      `This point takes bookings up to ${policy.maxAheadHours} h ahead`,
    );
  }

  const zoneId = connector.point.gridZoneId;
  if (!zoneId) throw new ReservationError("This point has no grid zone, so it has no wallet");
  const wallet = await getOrCreateWallet(args.userId, zoneId);

  const fee = roundMoney(policy.feeFiat);
  const guarantee = roundMoney(policy.guaranteeFiat);

  return prisma.$transaction(async (tx) => {
    // §34 — one live booking per driver.
    const live = await tx.reservation.findFirst({
      where: { userId: args.userId, status: { in: LIVE } },
      select: { id: true },
    });
    if (live) throw new ReservationError("You already have a booking");

    const fresh = await tx.pointConnector.findUniqueOrThrow({
      where: { id: args.connectorId },
    });
    if (fresh.status !== ConnectorStatus.FREE && fresh.status !== ConnectorStatus.UNKNOWN) {
      throw new ReservationError("That connector is not free");
    }

    // §33 "Резерв без брони" — some connectors always stay for walk-ups.
    if (policy.walkUpConnectors > 0) {
      const all = await tx.pointConnector.count({ where: { pointId: connector.point.id } });
      const booked = await tx.pointConnector.count({
        where: { pointId: connector.point.id, status: ConnectorStatus.BOOKED },
      });
      if (all - booked - 1 < policy.walkUpConnectors) {
        throw new ReservationError(
          `This point keeps ${policy.walkUpConnectors} connector(s) for walk-up drivers`,
        );
      }
    }

    const walletRow = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    const available = roundMoney(num(walletRow.fiatBalance) - num(walletRow.reservedFiat));
    if (available < roundMoney(fee + guarantee)) {
      throw new ReservationError("Not enough funds for the fee and the guarantee");
    }

    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        fiatBalance: { decrement: new Prisma.Decimal(fee) },
        reservedFiat: { increment: new Prisma.Decimal(guarantee) },
      },
    });

    const reservation = await tx.reservation.create({
      data: {
        userId: args.userId,
        pointId: connector.point.id,
        connectorId: connector.id,
        walletId: wallet.id,
        eta: args.eta,
        windowStart: args.eta,
        windowEnd: new Date(args.eta.getTime() + policy.waitMinutes * 60_000),
        // US-32 — the terms are copied in, so a later change leaves this one
        // where it is.
        feeFiat: new Prisma.Decimal(fee),
        guaranteeFiat: new Prisma.Decimal(guarantee),
        noShowPenaltyFiat: new Prisma.Decimal(roundMoney(policy.noShowPenaltyFiat)),
        freeCancelMinutes: policy.freeCancelMinutes,
        currency: policy.currency,
        status: ReservationStatus.ACTIVE,
      },
    });

    await tx.pointConnector.update({
      where: { id: connector.id },
      data: { status: ConnectorStatus.BOOKED, statusAt: new Date() },
    });

    await writeAudit(tx, {
      actor: args.userId,
      entity: "Reservation",
      entityId: reservation.id,
      action: "reservation.created",
      after: { connectorId: connector.id, fee, guarantee, windowEnd: reservation.windowEnd },
    });

    return reservation;
  });
}

/** §32.7 — free before the owner's threshold, otherwise the fee is kept. */
export async function cancelReservation(
  reservationId: string,
  userId: string,
): Promise<Reservation> {
  const reservation = await prisma.reservation.findUnique({ where: { id: reservationId } });
  if (!reservation) throw new ReservationError("Booking not found");
  if (reservation.userId !== userId) throw new ReservationError("Not your booking");
  if (!LIVE.includes(reservation.status)) {
    throw new ReservationError(`This booking is already ${reservation.status}`);
  }

  const minutesToWindow =
    (reservation.windowStart.getTime() - Date.now()) / 60_000;
  const refundFee = minutesToWindow >= reservation.freeCancelMinutes;

  return closeReservation(reservation.id, {
    status: ReservationStatus.CANCELLED,
    refundFee,
    penalty: 0,
    reason: refundFee ? "cancelled in good time" : "cancelled late, fee kept",
    actor: userId,
    notify: false,
  });
}

/**
 * US-33 — the window closed and nobody came. Runs from the worker every
 * minute; the penalty comes out of the guarantee, the rest goes back.
 */
export async function closeExpiredReservations(now = new Date()): Promise<number> {
  const due = await prisma.reservation.findMany({
    where: { status: { in: LIVE }, windowEnd: { lt: now } },
    select: { id: true, noShowPenaltyFiat: true },
  });

  let closed = 0;
  for (const reservation of due) {
    try {
      await closeReservation(reservation.id, {
        status: ReservationStatus.NO_SHOW,
        refundFee: false,
        penalty: num(reservation.noShowPenaltyFiat),
        reason: "nobody arrived before the window closed",
        actor: "system",
        receipt: true,
      });
      closed += 1;
    } catch (err) {
      console.error(`[reservations] could not close ${reservation.id}`, err);
    }
  }
  return closed;
}

/**
 * US-55 and §34 — the station broke, so every booking on that connector is
 * cancelled, the fee comes back in full and no penalty is charged.
 */
export async function cancelReservationsForConnector(
  connectorId: string,
  reason: string,
): Promise<number> {
  const live = await prisma.reservation.findMany({
    where: { connectorId, status: { in: LIVE } },
    select: { id: true },
  });

  let cancelled = 0;
  for (const reservation of live) {
    try {
      await closeReservation(reservation.id, {
        status: ReservationStatus.CANCELLED,
        refundFee: true,
        penalty: 0,
        reason: `station out of service: ${reason}`,
        actor: "system",
        freeConnector: false,
      });
      cancelled += 1;
    } catch (err) {
      console.error(`[reservations] could not cancel ${reservation.id}`, err);
    }
  }
  return cancelled;
}

interface CloseArgs {
  status: ReservationStatus;
  refundFee: boolean;
  penalty: number;
  reason: string;
  actor: string;
  receipt?: boolean;
  /** False when the connector is out of service and must stay that way. */
  freeConnector?: boolean;
  /** False when the driver did it themselves and already knows. */
  notify?: boolean;
}

/** The one place money moves back: every ending goes through here. */
async function closeReservation(
  reservationId: string,
  args: CloseArgs,
): Promise<Reservation> {
  return prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUniqueOrThrow({
      where: { id: reservationId },
    });
    if (!LIVE.includes(reservation.status)) {
      throw new ReservationError(`This booking is already ${reservation.status}`);
    }

    const guarantee = num(reservation.guaranteeFiat);
    const penalty = Math.min(roundMoney(args.penalty), guarantee);
    const fee = num(reservation.feeFiat);
    const refund = args.refundFee ? fee : 0;

    // Release the hold, give back the fee if it is owed, take the penalty.
    await tx.wallet.update({
      where: { id: reservation.walletId },
      data: {
        reservedFiat: { decrement: new Prisma.Decimal(guarantee) },
        fiatBalance: { increment: new Prisma.Decimal(roundMoney(refund - penalty)) },
      },
    });

    const closed = await tx.reservation.update({
      where: { id: reservationId },
      data: {
        status: args.status,
        penaltyFiat: penalty > 0 ? new Prisma.Decimal(penalty) : null,
        refundFiat: new Prisma.Decimal(roundMoney(refund)),
        closedAt: new Date(),
        closeReason: args.reason,
        // A driver who cancelled from their own screen needs no letter about
        // it; marking it told keeps the worker from sending one.
        ...(args.notify === false ? { notifiedAt: new Date() } : {}),
      },
    });

    if (args.freeConnector !== false) {
      const connector = await tx.pointConnector.findUniqueOrThrow({
        where: { id: reservation.connectorId },
      });
      if (connector.status === ConnectorStatus.BOOKED) {
        await tx.pointConnector.update({
          where: { id: reservation.connectorId },
          data: { status: ConnectorStatus.FREE, statusAt: new Date() },
        });
      }
    }

    // US-33 — "чек и уведомление"; the notification is the worker's job.
    if (args.receipt && penalty > 0) {
      await tx.receipt.create({
        data: {
          ...(await receiptStamp(tx)),
          reservationId,
          burnedTokenIds: [],
          totalKwh: new Prisma.Decimal(0),
          totalFiat: new Prisma.Decimal(penalty),
          currency: reservation.currency,
          breakdown: {
            kind: "reservation.no_show",
            fee,
            guarantee,
            penalty,
            windowEnd: reservation.windowEnd.toISOString(),
          } as Prisma.InputJsonValue,
        },
      });
    }

    await writeAudit(tx, {
      actor: args.actor,
      entity: "Reservation",
      entityId: reservationId,
      action: `reservation.${args.status.toLowerCase()}`,
      before: { status: reservation.status },
      after: { penalty, refund, reason: args.reason },
    });

    return closed;
  });
}

export interface NotifyReservationOptions {
  sendTo?: (to: string, subject: string, html: string) => Promise<void>;
  userIds?: string[];
}

/**
 * US-33 and US-55 — "чек и уведомление" / "автоматический возврат и
 * уведомление". The worker calls this on the same minute sweep; a booking
 * counts as told only once the mail is out.
 */
export async function notifyClosedReservations(
  options: NotifyReservationOptions = {},
): Promise<number> {
  const { sendEmail } = await import("@/lib/email");
  const send =
    options.sendTo ??
    ((to: string, subject: string, html: string) => sendEmail({ to, subject, html }));

  const closed = await prisma.reservation.findMany({
    where: {
      notifiedAt: null,
      status: { in: [ReservationStatus.NO_SHOW, ReservationStatus.CANCELLED] },
      closedAt: { not: null },
      ...(options.userIds ? { userId: { in: options.userIds } } : {}),
    },
    orderBy: { closedAt: "asc" },
    include: {
      user: { select: { email: true, emailVerified: true } },
      point: { select: { id: true, name: true, city: true } },
      connector: { select: { type: true } },
    },
  });

  let notified = 0;
  for (const reservation of closed) {
    const to = reservation.user.email;
    if (!to || !reservation.user.emailVerified) {
      // Nobody to tell; do not keep retrying forever.
      await prisma.reservation.update({
        where: { id: reservation.id },
        data: { notifiedAt: new Date() },
      });
      continue;
    }

    const noShow = reservation.status === ReservationStatus.NO_SHOW;

    // US-55 — the station let the driver down, so the letter says where to
    // go instead: the same search US-53 shows on screen.
    const alternatives = noShow
      ? []
      : await nearestWorkingPoints(reservation.point.id, reservation.connector.type);
    const whereInstead =
      alternatives.length > 0
        ? `<p>Nearest working points with a free ${reservation.connector.type}:</p><ul>` +
          alternatives
            .map(
              (p) =>
                `<li><b>${p.name}</b>${p.addressLine ? `, ${p.addressLine}` : ""}` +
                `${p.distanceM !== null ? ` — ${(p.distanceM / 1000).toFixed(1)} km away` : ""}</li>`,
            )
            .join("") +
          "</ul>"
        : "";
    const subject = noShow
      ? `[Poolwatt] Booking missed — ${reservation.point.name}`
      : `[Poolwatt] Booking cancelled — ${reservation.point.name}`;
    const html = noShow
      ? `<p>Nobody arrived before the booking window closed at
           ${reservation.windowEnd.toISOString()}.</p>
         <p>Charged from the guarantee: ${num(reservation.penaltyFiat ?? new Prisma.Decimal(0)).toFixed(2)}
            ${reservation.currency}. The rest is back on your balance.</p>`
      : `<p>Your booking at <b>${reservation.point.name}</b> was cancelled.</p>
         <p>${reservation.closeReason ?? ""}</p>
         <p>Refunded: ${num(reservation.refundFiat ?? new Prisma.Decimal(0)).toFixed(2)}
            ${reservation.currency}. No penalty was charged.</p>
         ${whereInstead}`;

    try {
      await send(to, subject, html);
      await prisma.reservation.update({
        where: { id: reservation.id },
        data: { notifiedAt: new Date() },
      });
      notified += 1;
    } catch (err) {
      console.error(`[reservations] notification failed for ${reservation.id}`, err);
    }
  }
  return notified;
}

/**
 * §32.4 / US-31 — "при опоздании предлагает продлить или перенести бронь".
 *
 * Two extensions and no more: a connector held open indefinitely is a
 * connector taken away from everybody who turns up, and §33's walk-up reserve
 * exists for exactly that reason.
 */
export const MAX_EXTENSIONS = 2;

/** US-31 — "push за 10 минут до конца окна с кнопкой «Продлить»". */
export const EXTEND_REMINDER_MINUTES = 10;

export async function extendReservation(args: {
  reservationId: string;
  userId: string;
}): Promise<Reservation> {
  const reservation = await prisma.reservation.findUnique({
    where: { id: args.reservationId },
  });
  if (!reservation) throw new ReservationError("Booking not found");
  if (reservation.userId !== args.userId) throw new ReservationError("Not your booking");
  if (!LIVE.includes(reservation.status)) {
    throw new ReservationError(`This booking is already ${reservation.status}`);
  }
  if (reservation.windowEnd.getTime() <= Date.now()) {
    // Past the window there is nothing to extend: the worker is about to close
    // it as a no-show, and pretending otherwise would take the penalty twice.
    throw new ReservationError("The booking window has already closed");
  }
  if (reservation.extendCount >= MAX_EXTENSIONS) {
    throw new ReservationError(
      `A booking can be extended ${MAX_EXTENSIONS} times; this one already has been`,
    );
  }

  const policy = await readPolicy(reservation.pointId);
  if (!policy.extendAllowed) {
    throw new ReservationError("The owner of this point does not allow extending a booking");
  }

  const fee = roundMoney(policy.extendFeeFiat);
  const addMinutes = policy.waitMinutes;

  return prisma.$transaction(async (tx) => {
    // Re-read under the transaction: the worker closes expired bookings every
    // minute, and the two must not cross.
    const fresh = await tx.reservation.findUniqueOrThrow({
      where: { id: reservation.id },
    });
    if (!LIVE.includes(fresh.status)) {
      throw new ReservationError(`This booking is already ${fresh.status}`);
    }

    if (fee > 0) {
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: fresh.walletId } });
      const available = roundMoney(num(wallet.fiatBalance) - num(wallet.reservedFiat));
      if (available < fee) {
        throw new ReservationError("Not enough funds for the extension fee");
      }
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { fiatBalance: { decrement: new Prisma.Decimal(fee) } },
      });
    }

    const windowEnd = new Date(fresh.windowEnd.getTime() + addMinutes * 60_000);
    const extended = await tx.reservation.update({
      where: { id: fresh.id },
      data: {
        windowEnd,
        extendCount: { increment: 1 },
        // The driver has been told once already; a new window earns a new
        // reminder of its own.
        extendRemindedAt: null,
      },
    });

    await writeAudit(tx, {
      actor: args.userId,
      entity: "Reservation",
      entityId: fresh.id,
      action: "reservation.extended",
      before: { windowEnd: fresh.windowEnd, extendCount: fresh.extendCount },
      after: { windowEnd, extendCount: extended.extendCount, feeFiat: fee },
    });

    return extended;
  });
}

/**
 * US-31 — the bookings whose window closes within ten minutes and whose
 * driver has not been told yet. The worker sweeps these; push is behind
 * `pushOpen()`, so today the driver gets a letter.
 */
export async function dueForExtendReminder(now = new Date()): Promise<Reservation[]> {
  return prisma.reservation.findMany({
    where: {
      status: { in: LIVE },
      extendRemindedAt: null,
      windowEnd: {
        gt: now,
        lte: new Date(now.getTime() + EXTEND_REMINDER_MINUTES * 60_000),
      },
    },
    orderBy: { windowEnd: "asc" },
    take: 200,
  });
}

export async function markExtendReminded(reservationId: string): Promise<void> {
  await prisma.reservation.update({
    where: { id: reservationId },
    data: { extendRemindedAt: new Date() },
  });
}

/**
 * US-31 — "Push за 10 минут до конца окна с кнопкой «Продлить»".
 *
 * Push needs APNs and FCM keys, which are the owner's to obtain, so what
 * reaches the driver today is a letter with the same button. The gate being
 * closed costs nothing: the booking page carries the button either way.
 */
export async function remindAboutClosingWindow(
  options: NotifyReservationOptions = {},
): Promise<number> {
  const { sendEmail } = await import("@/lib/email");
  const { emailLink, emailText } = await import("@/lib/email-i18n");
  const send =
    options.sendTo ??
    ((to: string, subject: string, html: string) => sendEmail({ to, subject, html }));

  const base = process.env.NEXTAUTH_URL ?? "https://poolwatt.com";
  const due = await dueForExtendReminder();

  let told = 0;
  for (const reservation of due) {
    const full = await prisma.reservation.findUnique({
      where: { id: reservation.id },
      include: {
        user: { select: { email: true, emailVerified: true, preferredLocale: true } },
        point: { select: { name: true, city: true } },
      },
    });
    if (!full) continue;

    const to = full.user.emailVerified ? full.user.email : null;
    if (!to) {
      // Nothing to retry.
      await markExtendReminded(reservation.id);
      continue;
    }

    try {
      const t = await emailText(full.user.preferredLocale);
      const minutes = Math.max(
        1,
        Math.round((reservation.windowEnd.getTime() - Date.now()) / 60_000),
      );
      const subject = t.text("reservationClosing.subject", { point: full.point.name });
      const html = t.layout(
        t.html("reservationClosing.body", {
          point: full.point.name,
          city: full.point.city ?? "",
          minutes: String(minutes),
        }),
        ...emailLink(`${base}/${t.locale}/me/bookings`, t.html("reservationClosing.cta")),
      );
      await send(to, subject, html);
      await markExtendReminded(reservation.id);
      told += 1;
    } catch (err) {
      // Left owing: the sweep comes round again in a minute.
      console.error("[reservations] closing reminder failed for", reservation.id, err);
    }
  }
  return told;
}
