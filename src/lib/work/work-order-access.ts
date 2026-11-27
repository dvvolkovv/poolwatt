// Кому можно смотреть наряд и кому можно в нём работать — §48 и §47.
//
// До этой работы один вопрос решался в трёх местах: `mayTouch` в действиях
// кабинета, `readEngineerStock` в снимке склада и `mayReadThroughWorkOrder` в
// маршруте фотографии заявки. Три ответа на один вопрос однажды расходятся —
// и расходятся в сторону «да», как это было с `tickets.write` до N-1.
//
// Наряд принадлежит либо сети (пункт), либо компании (объект генерации) —
// ровно одному из двух, как сказано в схеме. Поэтому и ответов два: владелец
// сети со своими сотрудниками §47, и владелец компании.

import type { WorkOrder } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can, readEmployee } from "@/lib/staff/staff-service";

export interface WorkOrderView {
  order: WorkOrder;
  canRead: true;
  /** Отмечать пункты, фотографировать, подписывать, закрывать. */
  canWork: boolean;
  /** Сотрудник сети, если смотрящий — сотрудник: им подписывают и отмечают. */
  employeeId: string | null;
}

/**
 * Наряд, если этому человеку он виден, иначе null. Null означает 404: чужого
 * наряда не существует, а не «существует, но нельзя».
 */
export async function readWorkOrderForUser(
  workOrderId: string,
  userId: string,
  role: string,
): Promise<WorkOrderView | null> {
  const order = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      assignee: { select: { id: true, userId: true } },
      crew: {
        select: { members: { select: { employeeId: true, employee: { select: { userId: true } } } } },
      },
      operator: { select: { claimedById: true } },
      company: { select: { ownerUserId: true } },
    },
  });
  if (!order) return null;

  const plain: WorkOrder = order;

  // Исполнитель — свой наряд, независимо от того, что ему потом урезали в
  // области пунктов: наряд ему уже назначили.
  if (order.assignee?.userId === userId) {
    return { order: plain, canRead: true, canWork: true, employeeId: order.assignee.id };
  }

  // §48 «назначение инженеру или бригаде»: бригадный наряд — наряд каждого
  // её участника, и по той же причине, что и личный. Урезанные пункты §47
  // этому не мешают: наряд ему уже назначили.
  const mine = order.crew?.members.find((m) => m.employee.userId === userId);
  if (mine) {
    return { order: plain, canRead: true, canWork: true, employeeId: mine.employeeId };
  }

  if (role === "ADMIN") {
    return { order: plain, canRead: true, canWork: true, employeeId: null };
  }

  if (order.operator?.claimedById === userId) {
    return { order: plain, canRead: true, canWork: true, employeeId: null };
  }
  if (order.company?.ownerUserId === userId) {
    return { order: plain, canRead: true, canWork: true, employeeId: null };
  }

  // Наряд объекта генерации сотрудников не знает: §47 — это сеть зарядных
  // пунктов, а не компания-производитель.
  if (!order.operatorId) return null;

  const employee = await readEmployee(order.operatorId, userId);
  if (!employee) return null;
  const scope = order.pointId ?? undefined;
  if (!can(employee, "workorders.read", scope)) return null;
  return {
    order: plain,
    canRead: true,
    canWork: can(employee, "workorders.write", scope),
    employeeId: employee.id,
  };
}
