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
