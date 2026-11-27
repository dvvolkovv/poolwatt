// Staff and their reach — ТЗ §47, US-47.
//
// "Сотрудник видит только разрешённые пункты и действия" is the acceptance
// criterion, so a grant is two things at once: what you may do, and where.
// `can()` is the only place that answers it; a permission check written in
// two places drifts, and it drifts towards yes.

import type { Employee, StaffRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/exchange/audit";

export class StaffError extends Error {}

export const PERMISSIONS = [
  "points.read",
  "points.write",
  "tariffs.write",
  "staff.write",
  "workorders.read",
  "workorders.write",
  "tickets.read",
  "tickets.write",
  "finance.read",
  "warehouse.write",
  "content.write",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** The eight roles of §47, as sets of the permissions above. */
export const BUILT_IN_ROLES: { name: string; permissions: Permission[] }[] = [
  {
    name: "ADMIN",
    permissions: [
      "points.read",
      "points.write",
      "tariffs.write",
      "staff.write",
      "workorders.read",
      "workorders.write",
      "tickets.read",
      "tickets.write",
      "content.write",
    ],
  },
  {
    name: "ENGINEER",
    permissions: ["points.read", "workorders.read", "workorders.write", "warehouse.write"],
  },
  {
    name: "SUPPORT",
    permissions: ["points.read", "tickets.read", "tickets.write", "workorders.read"],
  },
  { name: "MARKETER", permissions: ["points.read", "content.write"] },
  { name: "ACCOUNTANT", permissions: ["points.read", "finance.read"] },
  { name: "STOREKEEPER", permissions: ["points.read", "warehouse.write"] },
  { name: "VIEWER", permissions: ["points.read", "workorders.read", "tickets.read"] },
  {
    name: "DISPATCHER",
    permissions: ["points.read", "workorders.read", "workorders.write", "tickets.read"],
  },
];

export type EmployeeWithRole = Employee & { role: StaffRole };

/**
 * Кто может менять состав сети. Экспортировано, потому что бригады §48 — тот
 * же вопрос («кто распоряжается людьми сети»), и второго ответа на него быть
 * не должно.
 */
export async function requireNetworkOwner(operatorId: string, userId: string) {
  const operator = await prisma.chargerOperator.findUnique({
    where: { id: operatorId },
    select: { claimedById: true },
  });
  if (!operator) throw new StaffError("Network not found");
  if (operator.claimedById !== userId) throw new StaffError("Not your network");
}

const requireOwner = requireNetworkOwner;

export async function ensureBuiltInRoles(operatorId: string): Promise<StaffRole[]> {
  const existing = await prisma.staffRole.findMany({ where: { operatorId } });
  const byName = new Map(existing.map((r) => [r.name, r]));

  const created: StaffRole[] = [];
  for (const spec of BUILT_IN_ROLES) {
    const found = byName.get(spec.name);
    if (found) {
      created.push(found);
      continue;
    }
    created.push(
      await prisma.staffRole.create({
        data: {
          operatorId,
          name: spec.name,
          permissions: spec.permissions,
          builtIn: true,
        },
      }),
    );
  }
  return created;
}

export async function inviteEmployee(args: {
  operatorId: string;
  actorUserId: string;
  username: string;
  roleName: string;
  pointIds: string[];
}): Promise<EmployeeWithRole> {
  await requireOwner(args.operatorId, args.actorUserId);
  await ensureBuiltInRoles(args.operatorId);

  const user = await prisma.user.findUnique({ where: { username: args.username } });
  if (!user) throw new StaffError(`No user named ${args.username}`);

  const role = await prisma.staffRole.findFirst({
    where: { operatorId: args.operatorId, name: args.roleName },
  });
  if (!role) throw new StaffError(`No role named ${args.roleName}`);

  await assertPointsBelong(args.operatorId, args.pointIds);

  const already = await prisma.employee.findFirst({
    where: { operatorId: args.operatorId, userId: user.id },
  });
  if (already) throw new StaffError("This person is already on the staff");

  const employee = await prisma.employee.create({
    data: {
      operatorId: args.operatorId,
      userId: user.id,
      roleId: role.id,
      pointIds: args.pointIds,
      invitedBy: args.actorUserId,
    },
    include: { role: true },
  });
  // §47 — "все действия сотрудников пишутся в журнал аудита", starting with
  // the grant itself.
  await writeAudit(prisma, {
    actor: args.actorUserId,
    entity: "Employee",
    entityId: employee.id,
    action: "staff.invited",
    after: { userId: user.id, role: role.name, pointIds: args.pointIds },
  });
  return employee;
}

export async function setEmployeeScope(
  employeeId: string,
  actorUserId: string,
  pointIds: string[],
  roleName?: string,
): Promise<EmployeeWithRole> {
  const before = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { role: true },
  });
  if (!before) throw new StaffError("Employee not found");
  await requireOwner(before.operatorId, actorUserId);
  await assertPointsBelong(before.operatorId, pointIds);

  let roleId = before.roleId;
  if (roleName && roleName !== before.role.name) {
    const role = await prisma.staffRole.findFirst({
      where: { operatorId: before.operatorId, name: roleName },
    });
    if (!role) throw new StaffError(`No role named ${roleName}`);
    roleId = role.id;
  }

  const employee = await prisma.employee.update({
    where: { id: employeeId },
    data: { pointIds, roleId },
    include: { role: true },
  });
  await writeAudit(prisma, {
    actor: actorUserId,
    entity: "Employee",
    entityId: employeeId,
    action: "staff.scope.changed",
    before: { role: before.role.name, pointIds: before.pointIds },
    after: { role: employee.role.name, pointIds },
  });
  return employee;
}

export async function removeEmployee(
  employeeId: string,
  actorUserId: string,
): Promise<void> {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new StaffError("Employee not found");
  await requireOwner(employee.operatorId, actorUserId);

  await prisma.employee.delete({ where: { id: employeeId } });
  await writeAudit(prisma, {
    actor: actorUserId,
    entity: "Employee",
    entityId: employeeId,
    action: "staff.removed",
    before: { userId: employee.userId, pointIds: employee.pointIds },
  });
}

export async function readEmployee(
  operatorId: string,
  userId: string,
): Promise<EmployeeWithRole | null> {
  return prisma.employee.findFirst({
    where: { operatorId, userId },
    include: { role: true },
  });
}

/**
 * May this employee do this, here?
 *
 * An empty scope is the whole network — that is what "права выдаются на всю
 * сеть" means. Asking without a point asks about the role alone.
 */
export function can(
  employee: EmployeeWithRole,
  permission: Permission,
  pointId?: string,
): boolean {
  if (!employee.role.permissions.includes(permission)) return false;
  if (!pointId) return true;
  if (employee.pointIds.length === 0) return true;
  return employee.pointIds.includes(pointId);
}

/**
 * Which points this person may see: null for no restriction (the owner), an
 * array otherwise — empty for somebody with no business here at all.
 */
export async function visiblePointIds(
  operatorId: string,
  userId: string,
): Promise<string[] | null> {
  const operator = await prisma.chargerOperator.findUnique({
    where: { id: operatorId },
    select: { claimedById: true },
  });
  if (operator?.claimedById === userId) return null;

  const employee = await readEmployee(operatorId, userId);
  if (!employee) return [];
  if (!employee.role.permissions.includes("points.read")) return [];
  return employee.pointIds.length === 0 ? null : employee.pointIds;
}

async function assertPointsBelong(operatorId: string, pointIds: string[]): Promise<void> {
  if (pointIds.length === 0) return;
  const count = await prisma.acceptancePoint.count({
    where: { operatorId, id: { in: pointIds } },
  });
  if (count !== pointIds.length) {
    throw new StaffError("A point in the scope does not belong to this network");
  }
}
