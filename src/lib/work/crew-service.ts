// Бригады и охват инженеров — ТЗ §48 «Назначение инженеру или бригаде с
// учётом региона».
//
// Бригада принадлежит сети, и распоряжается ею тот, кто распоряжается
// сотрудниками §47, — поэтому право спрашивается тем же
// `requireNetworkOwner`, а не своей проверкой рядом.
//
// Регион здесь — просто город. Нормализация одна на все входы: `trim`, без
// пустых, без повторов без учёта регистра. Подбор в `assignment.ts`
// сравнивает города в нижнем регистре, но хранится то, что написал человек:
// «Košice» в списке читается лучше, чем «košice».

import { Prisma, type Crew } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/exchange/audit";
import { readEmployee, requireNetworkOwner, StaffError } from "@/lib/staff/staff-service";
import { OPEN_STATUSES } from "./assignment";

export class CrewError extends Error {}

/** Чужая сеть и несуществующая сеть отвечают одинаково — `CrewError`. */
async function requireOwner(operatorId: string, userId: string): Promise<void> {
  try {
    await requireNetworkOwner(operatorId, userId);
  } catch (err) {
    throw new CrewError(err instanceof StaffError ? err.message : "Not your network");
  }
}

export function normalizeRegions(regions: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of regions) {
    const city = raw.trim();
    if (!city) continue;
    const key = city.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(city.slice(0, 80));
  }
  return out;
}

export async function createCrew(
  operatorId: string,
  actorUserId: string,
  input: { name: string; regions: string[] },
): Promise<Crew> {
  await requireOwner(operatorId, actorUserId);

  const name = input.name.trim().slice(0, 80);
  if (name.length < 2) throw new CrewError("A crew needs a name people recognise");
  const regions = normalizeRegions(input.regions);

  let crew: Crew;
  try {
    crew = await prisma.crew.create({ data: { operatorId, name, regions } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new CrewError("This network already has a crew with that name");
    }
    throw err;
  }

  await writeAudit(prisma, {
    actor: actorUserId,
    entity: "Crew",
    entityId: crew.id,
    action: "crew.created",
    after: { name, regions },
  });
  return crew;
}

async function crewOfOwner(crewId: string, actorUserId: string): Promise<Crew> {
  const crew = await prisma.crew.findUnique({ where: { id: crewId } });
  if (!crew) throw new CrewError("Crew not found");
  await requireOwner(crew.operatorId, actorUserId);
  return crew;
}

export async function setCrewRegions(
  crewId: string,
  actorUserId: string,
  regions: string[],
): Promise<Crew> {
  const before = await crewOfOwner(crewId, actorUserId);
  const next = normalizeRegions(regions);

  const crew = await prisma.crew.update({ where: { id: crewId }, data: { regions: next } });
  await writeAudit(prisma, {
    actor: actorUserId,
    entity: "Crew",
    entityId: crewId,
    action: "crew.regions",
    before: { regions: before.regions },
    after: { regions: next },
  });
  return crew;
}

export async function addCrewMember(
  crewId: string,
  employeeId: string,
  actorUserId: string,
  opts: { lead?: boolean } = {},
): Promise<void> {
  const crew = await crewOfOwner(crewId, actorUserId);

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new CrewError("Employee not found");
  if (employee.operatorId !== crew.operatorId) {
    throw new CrewError("That person is not on this network");
  }

  await prisma.$transaction(async (tx) => {
    // Старший один. Ставя нового, снимаем прежнего: две подписи «старший» в
    // одной бригаде значат, что письмо адресовано никому.
    if (opts.lead) {
      await tx.crewMember.updateMany({ where: { crewId }, data: { lead: false } });
    }
    await tx.crewMember.upsert({
      where: { crewId_employeeId: { crewId, employeeId } },
      update: { lead: opts.lead ?? false },
      create: { crewId, employeeId, lead: opts.lead ?? false },
    });
  });

  await writeAudit(prisma, {
    actor: actorUserId,
    entity: "Crew",
    entityId: crewId,
    action: "crew.member.added",
    after: { employeeId, lead: opts.lead ?? false },
  });
}

export async function removeCrewMember(
  crewId: string,
  employeeId: string,
  actorUserId: string,
): Promise<void> {
  await crewOfOwner(crewId, actorUserId);

  // Пустая бригада остаётся: её наряды и её история никуда не делись, а
  // людей в неё наберут завтра.
  await prisma.crewMember.deleteMany({ where: { crewId, employeeId } });
  await writeAudit(prisma, {
    actor: actorUserId,
    entity: "Crew",
    entityId: crewId,
    action: "crew.member.removed",
    before: { employeeId },
  });
}

/** Бригаду с открытой работой не удаляют: наряд потерялся бы вместе с ней. */
export async function removeCrew(crewId: string, actorUserId: string): Promise<void> {
  const crew = await crewOfOwner(crewId, actorUserId);

  const open = await prisma.workOrder.count({
    where: { crewId, status: { in: OPEN_STATUSES } },
  });
  if (open > 0) {
    throw new CrewError(`This crew still has ${open} open order(s); reassign them first`);
  }

  await prisma.crew.delete({ where: { id: crewId } });
  await writeAudit(prisma, {
    actor: actorUserId,
    entity: "Crew",
    entityId: crewId,
    action: "crew.removed",
    before: { name: crew.name, regions: crew.regions },
  });
}

export async function setEmployeeRegions(
  employeeId: string,
  actorUserId: string,
  regions: string[],
): Promise<void> {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new CrewError("Employee not found");
  await requireOwner(employee.operatorId, actorUserId);

  const next = normalizeRegions(regions);
  await prisma.employee.update({ where: { id: employeeId }, data: { regions: next } });
  await writeAudit(prisma, {
    actor: actorUserId,
    entity: "Employee",
    entityId: employeeId,
    action: "staff.regions",
    before: { regions: employee.regions },
    after: { regions: next },
  });
}

export interface CrewRow {
  id: string;
  name: string;
  regions: string[];
  openOrders: number;
  members: { employeeId: string; username: string; lead: boolean }[];
}

/**
 * Бригады сети — владельцу и сотруднику с правом читать наряды. Чужая сеть
 * получает `null`, то есть 404: чужих бригад не существует.
 */
export async function readCrews(operatorId: string, userId: string): Promise<CrewRow[] | null> {
  const operator = await prisma.chargerOperator.findUnique({
    where: { id: operatorId },
    select: { claimedById: true },
  });
  if (!operator) return null;
  if (operator.claimedById !== userId) {
    const employee = await readEmployee(operatorId, userId);
    if (!employee?.role.permissions.includes("workorders.read")) return null;
  }

  const crews = await prisma.crew.findMany({
    where: { operatorId },
    orderBy: { name: "asc" },
    include: {
      members: {
        orderBy: [{ lead: "desc" }, { createdAt: "asc" }],
        include: { employee: { select: { id: true, user: { select: { username: true } } } } },
      },
      _count: { select: { workOrders: { where: { status: { in: OPEN_STATUSES } } } } },
    },
  });

  return crews.map((c) => ({
    id: c.id,
    name: c.name,
    regions: c.regions,
    openOrders: c._count.workOrders,
    members: c.members.map((m) => ({
      employeeId: m.employeeId,
      username: m.employee.user.username,
      lead: m.lead,
    })),
  }));
}
