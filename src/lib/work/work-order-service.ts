// Work orders — ТЗ §48, US-48 and US-54.
//
// An order belongs to whoever answers for the equipment: a charging network
// for a point, a producer company for a generation asset. It comes from an
// alarm, from a customer's ticket, or from somebody's hand — and whichever it
// was, it remembers, so the same fault never produces two.

import {
  Prisma,
  WorkOrderStatus,
  type WorkOrder,
  type WorkOrderPriority,
  type WorkOrderType,
} from "@prisma/client";
import { sendEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/exchange/audit";
import { pushOpen } from "@/lib/exchange/gates";

export class WorkOrderError extends Error {}

const BASE = process.env.NEXTAUTH_URL ?? "https://poolwatt.com";

/** §48 — новый → назначен → в пути → в работе → ожидает запчасть → выполнен → проверен. */
const NEXT_STATUSES: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  NEW: [WorkOrderStatus.ASSIGNED, WorkOrderStatus.CANCELLED],
  ASSIGNED: [WorkOrderStatus.EN_ROUTE, WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.CANCELLED],
  EN_ROUTE: [WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.CANCELLED],
  IN_PROGRESS: [
    WorkOrderStatus.WAITING_PART,
    WorkOrderStatus.DONE,
    WorkOrderStatus.CANCELLED,
  ],
  WAITING_PART: [WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.CANCELLED],
  DONE: [WorkOrderStatus.VERIFIED, WorkOrderStatus.IN_PROGRESS],
  VERIFIED: [],
  CANCELLED: [],
};

/** What an engineer usually has to bring for each kind of fault (§48). */
const PARTS_BY_ALERT: Record<string, string[]> = {
  TELEMETRY_ANOMALY: ["meter", "communication module"],
  LINK_LOST: ["communication module", "SIM / router"],
  SUSPENDED: ["inspection only"],
};

export const PARTS_BY_PROBLEM: Record<string, string[]> = {
  NO_START: ["power module", "contactor"],
  INTERRUPTED: ["power module", "contactor"],
  DAMAGED_CABLE: ["charging cable", "connector"],
  SCREEN_DEAD: ["display", "control board"],
};

export interface CreateWorkOrderArgs {
  operatorId?: string | null;
  companyId?: string | null;
  pointId?: string | null;
  assetId?: string | null;
  type: WorkOrderType;
  priority?: WorkOrderPriority;
  title: string;
  description: string;
  partsNeeded?: string[];
  photos?: string[];
  sourceAlertId?: string | null;
  sourceTicketId?: string | null;
}

export async function createWorkOrder(args: CreateWorkOrderArgs): Promise<WorkOrder> {
  if (!args.operatorId && !args.companyId) {
    throw new WorkOrderError("A work order needs a network or a company to belong to");
  }
  if (!args.description.trim()) {
    throw new WorkOrderError("A work order needs a description somebody can act on");
  }

  const order = await prisma.workOrder.create({
    data: {
      operatorId: args.operatorId ?? null,
      companyId: args.companyId ?? null,
      pointId: args.pointId ?? null,
      assetId: args.assetId ?? null,
      type: args.type,
      priority: args.priority ?? "NORMAL",
      title: args.title.trim().slice(0, 200),
      description: args.description.trim(),
      partsNeeded: args.partsNeeded ?? [],
      photos: args.photos ?? [],
      sourceAlertId: args.sourceAlertId ?? null,
      sourceTicketId: args.sourceTicketId ?? null,
    },
  });
  await writeAudit(prisma, {
    actor: "system",
    entity: "WorkOrder",
    entityId: order.id,
    action: "workorder.created",
    after: { type: order.type, priority: order.priority, title: order.title },
  });
  return order;
}

/** Narrows a platform-wide sweep to one owner or one asset. */
export interface WorkScope {
  operatorId?: string;
  companyId?: string;
  assetId?: string;
}

/**
 * §30 → §48: every open alarm that has no order yet gets one.
 *
 * The alarm id is unique on the order, so a second pass never doubles it even
 * if two workers run at once. The nightly sweep passes no scope and looks at
 * everything; a caller interested in one asset says so.
 */
export async function openWorkOrdersForAlerts(scope: WorkScope = {}): Promise<number> {
  const alerts = await prisma.assetAlert.findMany({
    where: {
      resolvedAt: null,
      workOrder: { is: null },
      ...(scope.assetId ? { assetId: scope.assetId } : {}),
      ...(scope.companyId ? { asset: { companyId: scope.companyId } } : {}),
    },
    include: {
      asset: {
        select: {
          id: true,
          name: true,
          companyId: true,
          address: true,
          gridZone: { select: { code: true } },
        },
      },
    },
  });

  let opened = 0;
  for (const alert of alerts) {
    try {
      await createWorkOrder({
        companyId: alert.asset.companyId,
        assetId: alert.asset.id,
        type: "REPAIR",
        priority: alert.kind === "LINK_LOST" ? "HIGH" : "URGENT",
        title: `${alert.kind} — ${alert.asset.name}`,
        description: [
          alert.note,
          alert.asset.address ? `Address: ${alert.asset.address}` : null,
          `Zone: ${alert.asset.gridZone.code}`,
          `Detected at ${alert.occurredAt.toISOString()}`,
        ]
          .filter(Boolean)
          .join("\n"),
        partsNeeded: PARTS_BY_ALERT[alert.kind] ?? [],
        sourceAlertId: alert.id,
      });
      opened += 1;
    } catch (err) {
      // A unique violation means somebody else got there first, which is the
      // outcome we wanted anyway.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        continue;
      }
      console.error(`[work-orders] could not open an order for alert ${alert.id}`, err);
    }
  }
  return opened;
}

export async function assignWorkOrder(
  workOrderId: string,
  employeeId: string,
  actorUserId: string,
): Promise<WorkOrder> {
  const order = await prisma.workOrder.findUnique({ where: { id: workOrderId } });
  if (!order) throw new WorkOrderError("Work order not found");

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { role: true },
  });
  if (!employee) throw new WorkOrderError("Employee not found");
  if (!order.operatorId || employee.operatorId !== order.operatorId) {
    throw new WorkOrderError("That person is not on this network");
  }
  if (!employee.role.permissions.includes("workorders.write")) {
    throw new WorkOrderError("That role does not do work orders");
  }

  const updated = await prisma.workOrder.update({
    where: { id: workOrderId },
    data: {
      assigneeId: employeeId,
      status: order.status === WorkOrderStatus.NEW ? WorkOrderStatus.ASSIGNED : order.status,
      // A reassigned order owes its new engineer a word.
      notifiedAt: null,
    },
  });
  await writeAudit(prisma, {
    actor: actorUserId,
    entity: "WorkOrder",
    entityId: workOrderId,
    action: "workorder.assigned",
    before: { assigneeId: order.assigneeId, status: order.status },
    after: { assigneeId: employeeId, status: updated.status },
  });
  return updated;
}

export async function advanceWorkOrder(
  workOrderId: string,
  next: WorkOrderStatus,
  actorUserId: string,
  report: string | null,
): Promise<WorkOrder> {
  const order = await prisma.workOrder.findUnique({ where: { id: workOrderId } });
  if (!order) throw new WorkOrderError("Work order not found");

  if (!NEXT_STATUSES[order.status].includes(next)) {
    throw new WorkOrderError(`A work order cannot go from ${order.status} to ${next}`);
  }

  const updated = await prisma.workOrder.update({
    where: { id: workOrderId },
    data: {
      status: next,
      ...(report?.trim() ? { report: report.trim() } : {}),
      closedAt:
        next === WorkOrderStatus.VERIFIED || next === WorkOrderStatus.CANCELLED
          ? new Date()
          : null,
    },
  });
  await writeAudit(prisma, {
    actor: actorUserId,
    entity: "WorkOrder",
    entityId: workOrderId,
    action: "workorder.status",
    before: { status: order.status },
    after: { status: next, report: updated.report },
  });
  return updated;
}

export interface NotifyWorkOrderOptions {
  sendTo?: (to: string, subject: string, html: string) => Promise<void>;
  /** Platform-wide when absent, which is what the worker wants. */
  scope?: WorkScope;
}

/**
 * US-48 — "наряд приходит в течение минуты". The worker calls this every
 * minute; an order is marked as told only after the mail went out, so a
 * provider outage is retried rather than swallowed.
 */
export async function notifyPendingWorkOrders(
  options: NotifyWorkOrderOptions = {},
): Promise<number> {
  const send =
    options.sendTo ?? ((to: string, subject: string, html: string) => sendEmail({ to, subject, html }));

  const scope = options.scope ?? {};
  const pending = await prisma.workOrder.findMany({
    where: {
      notifiedAt: null,
      status: { notIn: [WorkOrderStatus.VERIFIED, WorkOrderStatus.CANCELLED] },
      ...(scope.operatorId ? { operatorId: scope.operatorId } : {}),
      ...(scope.companyId ? { companyId: scope.companyId } : {}),
      ...(scope.assetId ? { assetId: scope.assetId } : {}),
    },
    orderBy: { createdAt: "asc" },
    include: {
      assignee: { include: { user: { select: { email: true, emailVerified: true } } } },
      operator: { select: { id: true, email: true, claimedBy: { select: { email: true, emailVerified: true } } } },
      company: { select: { contactEmail: true, owner: { select: { email: true, emailVerified: true } } } },
      point: { select: { addressLine: true, city: true, howToFind: true } },
    },
  });

  let notified = 0;
  for (const order of pending) {
    const recipients = new Set<string>();
    const assignee = order.assignee?.user;
    if (assignee?.email && assignee.emailVerified) recipients.add(assignee.email);
    // Nobody assigned yet: whoever answers for the equipment hears about it.
    if (recipients.size === 0) {
      const owner = order.operator?.claimedBy ?? order.company?.owner;
      if (owner?.email && owner.emailVerified) recipients.add(owner.email);
      if (order.operator?.email) recipients.add(order.operator.email);
      if (order.company?.contactEmail) recipients.add(order.company.contactEmail);
    }
    if (recipients.size === 0) continue;

    const where = [order.point?.addressLine, order.point?.city].filter(Boolean).join(", ");
    const subject = `[Poolwatt] ${order.title}`;
    const html = `
      <p><b>${order.title}</b> — ${order.type}, ${order.priority}</p>
      ${where ? `<p>${where}</p>` : ""}
      ${order.point?.howToFind ? `<p>${order.point.howToFind}</p>` : ""}
      <pre style="white-space:pre-wrap">${order.description}</pre>
      ${order.partsNeeded.length > 0 ? `<p>Bring: ${order.partsNeeded.join(", ")}</p>` : ""}
      <p><a href="${BASE}/en/me/work-orders/${order.id}">Open the work order</a></p>
    `;

    try {
      for (const to of recipients) await send(to, subject, html);
      if (pushOpen()) {
        console.warn(`[work-orders] push is open but no provider is wired yet: ${order.id}`);
      }
      await prisma.workOrder.update({
        where: { id: order.id },
        data: { notifiedAt: new Date() },
      });
      notified += 1;
    } catch (err) {
      console.error(`[work-orders] notification failed for ${order.id}`, err);
    }
  }
  return notified;
}
