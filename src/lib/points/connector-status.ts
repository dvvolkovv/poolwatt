// §27 «Значок пункта показывает тип и доступность», §29.7 «статус
// доступности обновляется автоматически по OCPP и телеметрии».
//
// Занятость разъёма меняли пять мест, каждое своим `pointConnector.update`,
// и истории не вёл никто. Теперь путь один, и он же ведёт журнал — только
// когда состояние действительно изменилось: оборудование отчитывается раз в
// минуту, и «всё так же свободно» за сутки дало бы тысячу четыреста
// бессмысленных строк.

import type { ConnectorStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Db } from "@/lib/exchange/audit";

export type StatusSource =
  | "equipment"
  | "booking"
  | "booking-release"
  | "session-start"
  | "session-end"
  | "ticket";

/**
 * Единственный путь, которым меняется занятость разъёма.
 * Возвращает true, если состояние поменялось, — и это ровно то, что
 * означает «обновлено» для отчёта оборудования.
 */
export async function setConnectorStatus(
  db: Db,
  connectorId: string,
  status: ConnectorStatus,
  source: StatusSource,
  at: Date = new Date(),
): Promise<boolean> {
  const row = await db.pointConnector.findUnique({
    where: { id: connectorId },
    select: { id: true, pointId: true, status: true },
  });
  if (!row || row.status === status) return false;

  await db.pointConnector.update({
    where: { id: connectorId },
    data: { status, statusAt: at },
  });
  await db.connectorStatusLog.create({
    data: { connectorId, pointId: row.pointId, status, at, source },
  });
  return true;
}

/** Карточка показывает семь дней; держим тридцать и чистим остальное. */
export const LOG_KEEP_DAYS = 30;

export async function purgeConnectorStatusLog(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - LOG_KEEP_DAYS * 86_400_000);
  const { count } = await prisma.connectorStatusLog.deleteMany({
    where: { at: { lt: cutoff } },
  });
  return count;
}
