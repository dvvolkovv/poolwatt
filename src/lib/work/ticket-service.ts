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
import { setConnectorStatus } from "@/lib/points/connector-status";
import { systemMessage } from "./ticket-conversation";
import { saveTicketPhotos, type IncomingPhoto } from "./ticket-photos";

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

/**
 * §51 asks for thirty seconds, and a thumb that is not sure whether the tap
 * registered taps again. Two tickets about one cable waste a support agent's
 * morning, so a signed-in driver repeating the same point and the same
 * problem inside this window gets the ticket they already opened.
 *
 * An anonymous report is never glued to another: without a reporter "the
 * same person" cannot be told from "somebody else standing at the same
 * broken station", and merging two people's reports loses one of them.
 */
export const DEDUPE_WINDOW_MINUTES = 5;

export interface ReportProblemArgs {
  pointId: string;
  connectorId?: string | null;
  reporterId?: string | null;
  problemType: TicketProblemType;
  comment?: string | null;
  photos?: IncomingPhoto[];
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

  const { ticket, fresh } = await findOrCreateTicket(args, point.operatorId, connector?.id ?? null, priority);

  if (!fresh) {
    // Тот же палец, то же нажатие: заявка уже есть, и всё, что она должна
    // была сделать, уже сделано.
    return {
      ticket,
      workOrder: ticket.workOrderId
        ? await prisma.workOrder.findUnique({ where: { id: ticket.workOrderId } })
        : null,
      alternatives: await offerAlternatives(point.id, connector?.type ?? point.connectors[0]?.type ?? null),
    };
  }

  await writeAudit(prisma, {
    actor: args.reporterId ?? "anonymous",
    entity: "Ticket",
    entityId: ticket.id,
    action: "ticket.reported",
    after: { pointId: point.id, problemType: args.problemType, technical },
  });

  // §51.4 — фотографии с места. Отказ по файлу не должен терять заявку:
  // жалоба важнее снимка.
  let photoKeys: string[] = [];
  if (args.photos && args.photos.length > 0) {
    try {
      photoKeys = await saveTicketPhotos(ticket.id, args.photos);
    } catch {
      photoKeys = [];
    }
  }

  // Комментарий клиента — первая реплика разговора, а не отдельное поле:
  // §51.5 обещает переписку, и она должна читаться с начала.
  if (args.comment?.trim()) {
    await prisma.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        authorKind: "CUSTOMER",
        authorId: args.reporterId ?? null,
        body: args.comment.trim(),
      },
    });
  }

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
      photos: photoKeys,
      sourceTicketId: ticket.id,
    });
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { workOrderId: workOrder.id, status: "IN_PROGRESS" },
    });
    // §51.5 — клиент видит, что по его заявке уже поехали. Это сообщение
    // системы, а не ответ поддержки: срок реакции §48 закрывает человек.
    await systemMessage(prisma, ticket.id, "A repair order has been opened on this report.");

    // §51 — "пункт или разъём помечается в навигаторе как неработающий".
    if (connector) {
      await setConnectorStatus(prisma, connector.id, ConnectorStatus.OUT_OF_SERVICE, "ticket");
      // US-55 — a booking on a connector that just broke is cancelled with
      // the fee back and no penalty.
      await cancelReservationsForConnector(connector.id, `reported ${args.problemType}`);
    }
  }

  return {
    ticket: await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } }),
    workOrder,
    alternatives: await offerAlternatives(point.id, connector?.type ?? point.connectors[0]?.type ?? null),
  };
}

function offerAlternatives(pointId: string, connectorType: string | null) {
  return nearestWorkingPoints(pointId, connectorType as never);
}

/**
 * Одна заявка на одно нажатие. Строка заявителя берётся под блокировку,
 * поэтому два одновременных нажатия одного человека встают в очередь, а не
 * заводят две заявки каждое по своему пустому поиску.
 */
async function findOrCreateTicket(
  args: ReportProblemArgs,
  operatorId: string,
  connectorId: string | null,
  priority: WorkOrderPriority,
): Promise<{ ticket: Ticket; fresh: boolean }> {
  const create = () =>
    prisma.ticket.create({
      data: {
        operatorId,
        pointId: args.pointId,
        connectorId,
        reporterId: args.reporterId ?? null,
        source: args.source ?? "app",
        problemType: args.problemType,
        comment: args.comment?.trim() || null,
        photos: [],
        priority,
        respondBy: new Date(Date.now() + SLA_MINUTES[args.problemType] * 60 * 1000),
      },
    });

  if (!args.reporterId) return { ticket: await create(), fresh: true };

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${args.reporterId} FOR UPDATE`;
    const since = new Date(Date.now() - DEDUPE_WINDOW_MINUTES * 60 * 1000);
    const existing = await tx.ticket.findFirst({
      where: {
        reporterId: args.reporterId,
        pointId: args.pointId,
        problemType: args.problemType,
        status: { in: ["OPEN", "IN_PROGRESS"] },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return { ticket: existing, fresh: false };
    const ticket = await tx.ticket.create({
      data: {
        operatorId,
        pointId: args.pointId,
        connectorId,
        reporterId: args.reporterId,
        source: args.source ?? "app",
        problemType: args.problemType,
        comment: args.comment?.trim() || null,
        photos: [],
        priority,
        respondBy: new Date(Date.now() + SLA_MINUTES[args.problemType] * 60 * 1000),
      },
    });
    return { ticket, fresh: true };
  });
}

export { nearestWorkingPoints };
