"use server";

// Staff management — ТЗ §47, US-47.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  inviteEmployee,
  removeEmployee,
  setEmployeeScope,
} from "@/lib/staff/staff-service";
import {
  addCrewMember,
  createCrew,
  removeCrew,
  removeCrewMember,
  setCrewRegions,
  setEmployeeRegions,
} from "@/lib/work/crew-service";

export type StaffResult = { ok: true } | { ok: false; formError: string };

const inviteSchema = z.object({
  operatorId: z.string().min(1),
  username: z.string().trim().min(2).max(40),
  roleName: z.string().trim().min(2).max(40),
  pointIds: z.array(z.string().min(1)).max(500),
});

export async function inviteStaff(input: unknown): Promise<StaffResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };

  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await inviteEmployee({ ...parsed.data, actorUserId: session.user.id });
    revalidatePath("/[locale]/me/charger-operator/[id]/staff", "page");
    return { ok: true };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not invite." };
  }
}

const scopeSchema = z.object({
  employeeId: z.string().min(1),
  roleName: z.string().trim().min(2).max(40).optional(),
  pointIds: z.array(z.string().min(1)).max(500),
});

export async function updateStaffScope(input: unknown): Promise<StaffResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };

  const parsed = scopeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await setEmployeeScope(
      parsed.data.employeeId,
      session.user.id,
      parsed.data.pointIds,
      parsed.data.roleName,
    );
    revalidatePath("/[locale]/me/charger-operator/[id]/staff", "page");
    return { ok: true };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not save." };
  }
}

export async function dismissStaff(employeeId: string): Promise<StaffResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };
  try {
    await removeEmployee(employeeId, session.user.id);
    revalidatePath("/[locale]/me/charger-operator/[id]/staff", "page");
    return { ok: true };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not remove." };
  }
}

// §48 «назначение инженеру или бригаде с учётом региона» — бригады и охват
// живут там же, где состав сети: на странице сотрудников §47. Обёртки тонкие,
// право спрашивает `crew-service.ts`.

const regionsSchema = z.object({
  id: z.string().min(1),
  /** Города через запятую, как их пишет человек; нормализует сервис. */
  regions: z.string().max(2000),
});

function splitRegions(raw: string): string[] {
  return raw.split(",").map((c) => c.trim()).filter(Boolean).slice(0, 50);
}

function revalidateStaff(): void {
  revalidatePath("/[locale]/me/charger-operator/[id]/staff", "page");
  // Диспетчер видит те же города и ту же загрузку — иначе подбор остался бы
  // со вчерашним регионом до следующей перезагрузки.
  revalidatePath("/[locale]/me/charger-operator/[id]/dispatch", "page");
}

async function withSession(run: (userId: string) => Promise<void>): Promise<StaffResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };
  try {
    await run(session.user.id);
    revalidateStaff();
    return { ok: true };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not save." };
  }
}

export async function saveEmployeeRegions(input: unknown): Promise<StaffResult> {
  const parsed = regionsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  return withSession((userId) =>
    setEmployeeRegions(parsed.data.id, userId, splitRegions(parsed.data.regions)),
  );
}

const addCrewSchema = z.object({
  operatorId: z.string().min(1),
  name: z.string().trim().min(2).max(80),
  regions: z.string().max(2000),
});

export async function addCrew(input: unknown): Promise<StaffResult> {
  const parsed = addCrewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;
  return withSession(async (userId) => {
    await createCrew(data.operatorId, userId, {
      name: data.name,
      regions: splitRegions(data.regions),
    });
  });
}

export async function saveCrewRegions(input: unknown): Promise<StaffResult> {
  const parsed = regionsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  return withSession(async (userId) => {
    await setCrewRegions(parsed.data.id, userId, splitRegions(parsed.data.regions));
  });
}

const memberSchema = z.object({
  crewId: z.string().min(1),
  employeeId: z.string().min(1),
  lead: z.boolean().optional(),
});

export async function addMember(input: unknown): Promise<StaffResult> {
  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;
  return withSession((userId) =>
    addCrewMember(data.crewId, data.employeeId, userId, { lead: data.lead }),
  );
}

export async function dropMember(input: unknown): Promise<StaffResult> {
  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;
  return withSession((userId) => removeCrewMember(data.crewId, data.employeeId, userId));
}

/** Бригаду с открытой работой сервис не отдаёт — сообщение придёт в форму. */
export async function dropCrew(crewId: string): Promise<StaffResult> {
  return withSession((userId) => removeCrew(crewId, userId));
}
