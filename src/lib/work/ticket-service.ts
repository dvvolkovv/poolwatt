// A customer reports a breakdown — ТЗ §51, US-52, US-53, US-54.
//
// The whole point of §51 is speed: the station is already known, the type is
// one tap, everything else is optional. A technical fault then does three
// things by itself — opens a work order, takes the connector out of service
// so the map stops promising it, and offers the driver somewhere else to go.

import {
  ConnectorStatus,
  TicketProblemType,
  type Ticket,
  type WorkOrder,
  type WorkOrderPriority,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/exchange/audit";
import { nearestWorkingPoints, type FoundPoint } from "@/lib/points/point-search";
import { cancelReservationsForConnector } from "@/lib/reservations/reservation-service";
import { PARTS_BY_PROBLEM, createWorkOrder } from "./work-order-service";

export class TicketError extends Error {}

/** §51 — a broken cable is a repair; a blocked bay is somebody's bad parking. */
const TECHNICAL: ReadonlySet<TicketProblemType> = new Set([
  TicketProblemType.NO_START,
  TicketProblemType.INTERRUPTED,
  TicketProblemType.DAMAGED_CABLE,
  TicketProblemType.SCREEN_DEAD,
]);

/** §48 "SLA по приоритету", in minutes to a first response. */
const SLA_MINUTES: Record<TicketProblemType, number> = {
  NO_START: 30,
  INTERRUPTED: 30,
  DAMAGED_CABLE: 30,
  SCREEN_DEAD: 60,
  BLOCKED: 120,
  WRONG_PRICE: 480,
  OTHER: 480,
};

/** How far around the broken point to look for somewhere else to charge. */

export interface ReportProblemArgs {
  pointId: string;
  connectorId?: string | null;
  reporterId?: string | null;
  problemType: TicketProblemType;
  comment?: string | null;
  photos?: string[];
  source?: string;
}

export interface ReportProblemResult {
  ticket: Ticket;
  workOrder: WorkOrder | null;
  /** US-53 — somewhere to go instead, offered straight away. */
  alternatives: FoundPoint[];
}

export async function reportProblem(
  args: ReportProblemArgs,
): Promise<ReportProblemResult> {
  const point = await prisma.acceptancePoint.findUnique({
    where: { id: args.pointId },
    include: { connectors: true },
  });
  if (!point) throw new TicketError("Point not found");

  const connector = args.connectorId
    ? point.connectors.find((c) => c.id === args.connectorId) ?? null
    : null;

  const technical = TECHNICAL.has(args.problemType);
  const priority: WorkOrderPriority = technical
    ? "URGENT"
    : args.problemType === TicketProblemType.BLOCKED
      ? "HIGH"
      : "NORMAL";

  const ticket = await prisma.ticket.create({
    data: {
      operatorId: point.operatorId,
      pointId: point.id,
      connectorId: connector?.id ?? null,
      reporterId: args.reporterId ?? null,
      source: args.source ?? "app",
      problemType: args.problemType,
      comment: args.comment?.trim() || null,
      photos: args.photos ?? [],
      priority,
      respondBy: new Date(Date.now() + SLA_MINUTES[args.problemType] * 60 * 1000),
    },
  });
  await writeAudit(prisma, {
    actor: args.reporterId ?? "anonymous",
    entity: "Ticket",
    entityId: ticket.id,
    action: "ticket.reported",
    after: { pointId: point.id, problemType: args.problemType, technical },
  });

  let workOrder: WorkOrder | null = null;
  if (technical) {
    // US-54 — the order carries what the engineer needs: what broke, the
    // customer's photos, and which connector it was.
    workOrder = await createWorkOrder({
      operatorId: point.operatorId,
      pointId: point.id,
      type: "REPAIR",
      priority,
      title: `${args.problemType} — ${point.name}`,
      description: [
        `Reported by a customer: ${args.problemType}`,
        connector ? `Connector: ${connector.type}, ${connector.powerKw} kW` : null,
        args.comment?.trim() || null,
        point.howToFind ? `How to find it: ${point.howToFind}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      partsNeeded: PARTS_BY_PROBLEM[args.problemType] ?? [],
      photos: args.photos ?? [],
      sourceTicketId: ticket.id,
    });
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { workOrderId: workOrder.id, status: "IN_PROGRESS" },
    });

    // §51 — "пункт или разъём помечается в навигаторе как неработающий".
    if (connector) {
      await prisma.pointConnector.update({
        where: { id: connector.id },
        data: { status: ConnectorStatus.OUT_OF_SERVICE, statusAt: new Date() },
      });
      // US-55 — a booking on a connector that just broke is cancelled with
      // the fee back and no penalty.
      await cancelReservationsForConnector(connector.id, `reported ${args.problemType}`);
    }
  }

  const alternatives = connector
    ? await nearestWorkingPoints(point.id, connector.type)
    : await nearestWorkingPoints(point.id, point.connectors[0]?.type ?? null);

  return {
    ticket: await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } }),
    workOrder,
    alternatives,
  };
}

export { nearestWorkingPoints };
