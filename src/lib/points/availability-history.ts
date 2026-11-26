// §27 «Полная карточка: … история доступности».
//
// По каждому разъёму — семь суток и доля времени, которое он был свободен.
// Состояние на начало окна берётся из последней записи до него: журнал
// пишется только при смене, поэтому «что было вчера» без этого не узнать.
//
// День, о котором мы ничего не знаем, получает null, а не ноль. Это то же
// правило, по которому фильтр «свободен сейчас» не считает свободным разъём,
// о котором нам не докладывали: неизвестное — не «нет».
//
// Забронированный разъём свободным не считается: место уже обещано.

import { ConnectorStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const HISTORY_DAYS = 7;
const DAY_MS = 86_400_000;

export interface DayShare {
  /** Сутки в UTC, `YYYY-MM-DD`. */
  day: string;
  /** Доля времени «свободен», 0…1; null — об этих сутках мы ничего не знаем. */
  freeShare: number | null;
}

export interface ConnectorHistory {
  connectorId: string;
  type: string;
  powerKw: number;
  days: DayShare[];
  lastChange: { status: string; at: string; source: string } | null;
}

function startOfUtcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

export async function readAvailabilityHistory(
  pointId: string,
  now = new Date(),
): Promise<ConnectorHistory[]> {
  const connectors = await prisma.pointConnector.findMany({
    where: { pointId },
    orderBy: { type: "asc" },
  });
  if (connectors.length === 0) return [];

  const windowStart = new Date(startOfUtcDay(now).getTime() - (HISTORY_DAYS - 1) * DAY_MS);

  const rows = await prisma.connectorStatusLog.findMany({
    where: { pointId, at: { gte: windowStart } },
    orderBy: { at: "asc" },
  });

  // Состояние каждого разъёма на входе в окно — по одной записи до него.
  const carriedIn = new Map<string, ConnectorStatus>();
  await Promise.all(
    connectors.map(async (c) => {
      const before = await prisma.connectorStatusLog.findFirst({
        where: { connectorId: c.id, at: { lt: windowStart } },
        orderBy: { at: "desc" },
      });
      if (before) carriedIn.set(c.id, before.status);
    }),
  );

  return connectors.map((c) => {
    const mine = rows.filter((r) => r.connectorId === c.id);
    const last = mine[mine.length - 1] ?? null;

    const days: DayShare[] = [];
    for (let i = 0; i < HISTORY_DAYS; i += 1) {
      const dayStart = new Date(windowStart.getTime() + i * DAY_MS);
      const dayEnd = new Date(Math.min(dayStart.getTime() + DAY_MS, now.getTime()));
      if (dayEnd <= dayStart) continue;

      // Что было на начало этих суток: последняя запись до них, иначе то, с
      // чем разъём вошёл в окно.
      const beforeDay = mine.filter((r) => r.at < dayStart);
      const atDayStart =
        beforeDay.length > 0 ? beforeDay[beforeDay.length - 1].status : carriedIn.get(c.id);
      const inDay = mine.filter((r) => r.at >= dayStart && r.at < dayEnd);

      if (atDayStart === undefined && inDay.length === 0) {
        days.push({ day: dayStart.toISOString().slice(0, 10), freeShare: null });
        continue;
      }

      let cursor = dayStart.getTime();
      let state = atDayStart;
      let freeMs = 0;
      for (const change of inDay) {
        if (state === ConnectorStatus.FREE) freeMs += change.at.getTime() - cursor;
        cursor = change.at.getTime();
        state = change.status;
      }
      if (state === ConnectorStatus.FREE) freeMs += dayEnd.getTime() - cursor;

      days.push({
        day: dayStart.toISOString().slice(0, 10),
        freeShare: freeMs / (dayEnd.getTime() - dayStart.getTime()),
      });
    }

    return {
      connectorId: c.id,
      type: c.type as string,
      powerKw: Number(c.powerKw),
      days,
      lastChange: last
        ? { status: last.status as string, at: last.at.toISOString(), source: last.source }
        : null,
    };
  });
}
