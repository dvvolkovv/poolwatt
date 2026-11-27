// Кому отдать наряд — ТЗ §48 «Назначение инженеру или бригаде с учётом
// региона и загрузки».
//
// Модуль только считает и сортирует; назначает `assignWorkOrder` в
// `work-order-service.ts`. Разделено так потому, что подбор нужен в трёх
// местах — страница диспетчера, метод §50 и автоматическое назначение по
// аварии, — и ни одному из них не нужно право писать.
//
// Регион — город пункта против списка городов кандидата. Отдельной сущности
// «регион» в базе нет и не нужно: у пункта есть `city`, у склада есть `city`.
// Пустой список значит всю сеть — то же соглашение, что у `Employee.pointIds`
// рядом, иначе новый сотрудник выпадал бы из подбора до тех пор, пока кто-то
// не вспомнит про поле.

import { WorkOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can, type EmployeeWithRole } from "@/lib/staff/staff-service";

export type CandidateKind = "employee" | "crew";

/**
 * Почему кандидат здесь: город наряда у него в списке, у него вся сеть, или
 * он из другого региона. Третье не выбрасывается — в три часа ночи кто-то
 * всё равно должен поехать, и диспетчер должен видеть, что выбор есть, но он
 * не по региону.
 */
export type CandidateReason = "city" | "network" | "region";

export interface Candidate {
  kind: CandidateKind;
  /** `Employee.id` или `Crew.id` — чем и назначают. */
  id: string;
  name: string;
  regions: string[];
  openOrders: number;
  reason: CandidateReason;
  /** Для бригады — кто в ней; для человека пусто. */
  members: string[];
}

/** Наряд, который кто-то ещё должен довести до конца. */
export const OPEN_STATUSES: WorkOrderStatus[] = [
  WorkOrderStatus.NEW,
  WorkOrderStatus.ASSIGNED,
  WorkOrderStatus.EN_ROUTE,
  WorkOrderStatus.IN_PROGRESS,
  WorkOrderStatus.WAITING_PART,
  WorkOrderStatus.DONE,
];

const RANK: Record<CandidateReason, number> = { city: 0, network: 1, region: 2 };

function reasonFor(regions: string[], city: string | null): CandidateReason {
  if (regions.length === 0) return "network";
  if (!city) return "region";
  const needle = city.trim().toLowerCase();
  return regions.some((r) => r.trim().toLowerCase() === needle) ? "city" : "region";
}

/**
 * Сколько открытых нарядов у человека — и личных, и бригадных.
 *
 * Бригадный наряд считать обязательно: это работа того же человека, и без неё
 * подбор обещал бы диспетчеру свободного инженера, у которого на сегодня
 * четыре выезда с бригадой.
 */
export async function openLoad(employeeId: string): Promise<number> {
  return prisma.workOrder.count({
    where: {
      status: { in: OPEN_STATUSES },
      OR: [{ assigneeId: employeeId }, { crew: { members: { some: { employeeId } } } }],
    },
  });
}

/** Загрузка сразу у многих — один запрос вместо N. */
async function loadByEmployee(employeeIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>(employeeIds.map((id) => [id, 0]));
  if (employeeIds.length === 0) return counts;

  const orders = await prisma.workOrder.findMany({
    where: {
      status: { in: OPEN_STATUSES },
      OR: [
        { assigneeId: { in: employeeIds } },
        { crew: { members: { some: { employeeId: { in: employeeIds } } } } },
      ],
    },
    select: {
      assigneeId: true,
      crew: { select: { members: { select: { employeeId: true } } } },
    },
  });

  for (const order of orders) {
    // Исполнитель и бригада исключают друг друга (`assignWorkOrder`), так что
    // один наряд никому не достаётся дважды.
    const touched = order.assigneeId
      ? [order.assigneeId]
      : (order.crew?.members.map((m) => m.employeeId) ?? []);
    for (const id of touched) {
      if (counts.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Кандидаты на наряд, в порядке подбора: регион, потом загрузка, потом имя.
 *
 * Пустой список — это не ошибка, а честный ответ: наряд объекта генерации
 * сотрудников §47 не знает (у компании-производителя их нет), а у сети может
 * не быть ни одного инженера.
 */
export async function suggestAssignees(workOrderId: string): Promise<Candidate[]> {
  const order = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      operatorId: true,
      pointId: true,
      point: { select: { city: true } },
    },
  });
  if (!order?.operatorId) return [];

  const city = order.point?.city ?? null;
  const pointId = order.pointId ?? undefined;

  const staff = (await prisma.employee.findMany({
    where: { operatorId: order.operatorId },
    include: { role: true, user: { select: { username: true } } },
  })) as (EmployeeWithRole & { user: { username: string } })[];

  // Право §47 решает `can()`, а не своя проверка рядом: двух правил про одно
  // право быть не должно.
  const able = staff.filter((e) => can(e, "workorders.write", pointId));
  const ableIds = new Set(able.map((e) => e.id));

  const crews = await prisma.crew.findMany({
    where: { operatorId: order.operatorId },
    include: { members: { include: { employee: { include: { user: { select: { username: true } } } } } } },
  });

  const load = await loadByEmployee(able.map((e) => e.id));

  const people: Candidate[] = able.map((e) => ({
    kind: "employee",
    id: e.id,
    name: e.user.username,
    regions: e.regions,
    openOrders: load.get(e.id) ?? 0,
    reason: reasonFor(e.regions, city),
    members: [],
  }));

  const teams: Candidate[] = crews
    // Бригада без ни одного человека, которому можно работать, — не кандидат:
    // назначить ей наряд значит потерять наряд.
    .filter((c) => c.members.some((m) => ableIds.has(m.employeeId)))
    .map((c) => {
      const working = c.members.filter((m) => ableIds.has(m.employeeId));
      return {
        kind: "crew" as const,
        id: c.id,
        name: c.name,
        regions: c.regions,
        // Бригада едет вместе, поэтому занята настолько, насколько занят
        // самый занятый в ней. Не сумма — это не четыре выезда, а те же
        // два; не среднее — оно прячет занятого.
        openOrders: Math.max(...working.map((m) => load.get(m.employeeId) ?? 0)),
        reason: reasonFor(c.regions, city),
        members: working.map((m) => m.employee.user.username),
      };
    });

  return [...people, ...teams].sort(
    (a, b) =>
      RANK[a.reason] - RANK[b.reason] ||
      a.openOrders - b.openOrders ||
      a.name.localeCompare(b.name),
  );
}
