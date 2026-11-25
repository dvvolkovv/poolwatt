// US-34 — "Как владелец, хочу видеть статистику броней и неявок: отчёт по
// дням, доход от броней и штрафов."
//
// Two things are deliberate here.
//
// A booking is counted on the day it was *for*, taken from `windowStart`, not
// the day it was made: an owner reading this wants to know how busy the
// station was, and a slot booked three weeks ahead tells them nothing about
// the day of the click.
//
// The money comes off each booking row — `feeFiat`, `penaltyFiat`,
// `refundFiat` — and is never recomputed from the current policy. §54 says a
// change to the terms leaves existing bookings alone, so a report that
// recomputed would quietly rewrite a month that is already closed.

import { prisma } from "@/lib/prisma";
import { num } from "@/lib/exchange/decimal";
import { roundMoney } from "@/lib/exchange/precision";

export interface ReservationCounts {
  booked: number;
  /** Still ahead or running: `CREATED` and `ACTIVE`. */
  open: number;
  fulfilled: number;
  cancelled: number;
  noShow: number;
  expired: number;
  feeFiat: number;
  penaltyFiat: number;
  refundFiat: number;
  /** Fees plus penalties, less what was given back. */
  netFiat: number;
}

export interface ReservationDay extends ReservationCounts {
  /** ISO date, the day the booking was for. */
  date: string;
}

export interface ReservationPointRow extends ReservationCounts {
  pointId: string;
  pointName: string;
}

export interface ReservationStatsTotals extends ReservationCounts {
  /** Share of bookings nobody turned up for, or null when there were none. */
  noShowPct: number | null;
}

export interface ReservationStats {
  from: Date;
  to: Date;
  currency: string;
  days: ReservationDay[];
  points: ReservationPointRow[];
  totals: ReservationStatsTotals;
}

function emptyCounts(): ReservationCounts {
  return {
    booked: 0,
    open: 0,
    fulfilled: 0,
    cancelled: 0,
    noShow: 0,
    expired: 0,
    feeFiat: 0,
    penaltyFiat: 0,
    refundFiat: 0,
    netFiat: 0,
  };
}

interface Row {
  status: string;
  feeFiat: number;
  penaltyFiat: number;
  refundFiat: number;
}

function add(counts: ReservationCounts, row: Row): void {
  counts.booked += 1;
  switch (row.status) {
    case "CREATED":
    case "ACTIVE":
      counts.open += 1;
      break;
    case "FULFILLED":
      counts.fulfilled += 1;
      break;
    case "CANCELLED":
      counts.cancelled += 1;
      break;
    case "NO_SHOW":
      counts.noShow += 1;
      break;
    case "EXPIRED":
      counts.expired += 1;
      break;
  }
  counts.feeFiat = roundMoney(counts.feeFiat + row.feeFiat);
  counts.penaltyFiat = roundMoney(counts.penaltyFiat + row.penaltyFiat);
  counts.refundFiat = roundMoney(counts.refundFiat + row.refundFiat);
  counts.netFiat = roundMoney(
    counts.feeFiat + counts.penaltyFiat - counts.refundFiat,
  );
}

/** The day a booking was for. UTC, like the §41 schedule and for the same reason. */
function dayOf(windowStart: Date): string {
  return windowStart.toISOString().slice(0, 10);
}

export async function readReservationStats(args: {
  operatorId: string;
  /** null = every point of the network; a list = what an employee may see. */
  pointIds: string[] | null;
  from: Date;
  to: Date;
}): Promise<ReservationStats> {
  const reservations = await prisma.reservation.findMany({
    where: {
      // The period is half-open [from, to): two neighbouring months must not
      // both claim the same booking.
      windowStart: { gte: args.from, lt: args.to },
      point: {
        operatorId: args.operatorId,
        ...(args.pointIds ? { id: { in: args.pointIds } } : {}),
      },
    },
    orderBy: { windowStart: "asc" },
    select: {
      status: true,
      windowStart: true,
      feeFiat: true,
      penaltyFiat: true,
      refundFiat: true,
      currency: true,
      pointId: true,
      point: { select: { name: true } },
    },
  });

  const byDay = new Map<string, ReservationDay>();
  const byPoint = new Map<string, ReservationPointRow>();
  const totals: ReservationStatsTotals = { ...emptyCounts(), noShowPct: null };

  for (const r of reservations) {
    const row: Row = {
      status: r.status,
      feeFiat: num(r.feeFiat),
      // Null means nothing was taken, which is not the same as zero taken on
      // purpose — but for a sum it is.
      penaltyFiat: r.penaltyFiat == null ? 0 : num(r.penaltyFiat),
      refundFiat: r.refundFiat == null ? 0 : num(r.refundFiat),
    };

    const date = dayOf(r.windowStart);
    let day = byDay.get(date);
    if (!day) {
      day = { date, ...emptyCounts() };
      byDay.set(date, day);
    }
    add(day, row);

    let point = byPoint.get(r.pointId);
    if (!point) {
      point = { pointId: r.pointId, pointName: r.point.name, ...emptyCounts() };
      byPoint.set(r.pointId, point);
    }
    add(point, row);

    add(totals, row);
  }

  totals.noShowPct =
    totals.booked > 0 ? Math.round((totals.noShow / totals.booked) * 10_000) / 100 : null;

  return {
    from: args.from,
    to: args.to,
    // Zones in one network share a currency in practice; the first booking
    // settles it, and an empty period has nothing to disagree about.
    currency: reservations[0]?.currency ?? "EUR",
    days: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    points: [...byPoint.values()].sort((a, b) => a.pointName.localeCompare(b.pointName)),
    totals,
  };
}
