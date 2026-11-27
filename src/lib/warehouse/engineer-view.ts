// Что инженер видит на телефоне — §48 (наряд) и §49 («наличие у себя в
// машине и на ближайшем складе»).
//
// Один модуль на оба экрана, потому что список нарядов и снимок склада
// задают один и тот же вопрос — «что из этого моё» — и ответ на него не
// должен лежать в двух местах.

import { WorkOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readEmployee } from "@/lib/staff/staff-service";

const OPEN: WorkOrderStatus[] = [
  WorkOrderStatus.NEW,
  WorkOrderStatus.ASSIGNED,
  WorkOrderStatus.EN_ROUTE,
  WorkOrderStatus.IN_PROGRESS,
  WorkOrderStatus.WAITING_PART,
  WorkOrderStatus.DONE,
];

export interface EngineerOrderRow {
  id: string;
  title: string;
  type: string;
  priority: string;
  status: WorkOrderStatus;
  where: string;
}

/**
 * Мои наряды: назначенные мне лично, назначенные моей бригаде (§48), плюс
 * все, если сеть или компания моя.
 */
export async function readEngineerOrders(userId: string): Promise<EngineerOrderRow[]> {
  const orders = await prisma.workOrder.findMany({
    where: {
      status: { in: OPEN },
      OR: [
        { assignee: { userId } },
        { crew: { members: { some: { employee: { userId } } } } },
        { operator: { claimedById: userId } },
        { company: { ownerUserId: userId } },
      ],
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: 50,
    include: {
      point: { select: { name: true, addressLine: true, city: true } },
      asset: { select: { name: true, address: true } },
    },
  });

  return orders.map((o) => ({
    id: o.id,
    title: o.title,
    type: o.type,
    priority: o.priority,
    status: o.status,
    where: [
      o.point?.name ?? o.asset?.name,
      o.point?.addressLine ?? o.asset?.address,
      o.point?.city,
    ]
      .filter(Boolean)
      .join(" · "),
  }));
}

export interface EngineerStockItem {
  partId: string;
  sku: string;
  name: string;
  qty: number;
  serialTracked: boolean;
}

export interface EngineerWarehouse {
  id: string;
  name: string;
  kind: string;
  city: string | null;
  /** Моя машина идёт первой: с неё списывают в девяти случаях из десяти. */
  mine: boolean;
  items: EngineerStockItem[];
}

export interface EngineerStockView {
  workOrderId: string;
  partsNeeded: string[];
  warehouses: EngineerWarehouse[];
  /** Время снимка: экран печатает его рядом, как офлайн-баланс §25. */
  at: string;
}

/**
 * Снимок «что я могу списать на этот наряд». Null, если наряд не мой: это же
 * решение потом повторит сервер при досыле, и повторит строже — здесь оно
 * только для того, чтобы человеку не предлагали невозможного.
 */
export async function readEngineerStock(
  workOrderId: string,
  userId: string,
): Promise<EngineerStockView | null> {
  const order = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      operatorId: true,
      partsNeeded: true,
      assignee: { select: { id: true, userId: true } },
      operator: { select: { claimedById: true } },
    },
  });
  if (!order?.operatorId) return null;

  const isOwner = order.operator?.claimedById === userId;
  const employee = isOwner ? null : await readEmployee(order.operatorId, userId);
  if (!isOwner) {
    if (!employee) return null;
    const assignedToMe = order.assignee?.userId === userId;
    const mayWarehouse = employee.role.permissions.includes("warehouse.write");
    if (!assignedToMe || !mayWarehouse) return null;
  }

  const myEmployeeId = employee?.id ?? null;
  const warehouses = await prisma.warehouse.findMany({
    where: { operatorId: order.operatorId },
    include: {
      stock: { include: { part: true }, orderBy: { part: { name: "asc" } } },
    },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });

  const rows: EngineerWarehouse[] = warehouses
    // Чужой фургон инженеру не склад — его и не показываем. То же правило
    // стоит в `issueToWorkOrder`, иначе экран обещал бы невыполнимое.
    .filter(
      (w) =>
        isOwner ||
        w.kind !== "VAN" ||
        (myEmployeeId !== null && w.keeperEmployeeId === myEmployeeId),
    )
    .map((w) => ({
      id: w.id,
      name: w.name,
      kind: w.kind,
      city: w.city,
      mine: myEmployeeId !== null && w.keeperEmployeeId === myEmployeeId,
      items: w.stock.map((s) => ({
        partId: s.partId,
        sku: s.part.sku,
        name: s.part.name,
        qty: s.qty,
        serialTracked: s.part.serialTracked,
      })),
    }));

  rows.sort((a, b) => Number(b.mine) - Number(a.mine));

  return {
    workOrderId: order.id,
    partsNeeded: order.partsNeeded,
    warehouses: rows,
    at: new Date().toISOString(),
  };
}
