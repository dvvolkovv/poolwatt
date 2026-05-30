"use server";

import { revalidatePath } from "next/cache";
import type { ContractorStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type AdminActionResult = {
  ok: boolean;
  fieldErrors?: Record<string, string>;
  formError?: string;
};

// V2a only — V2c will add APPROVED↔SUSPENDED edges.
const VALID_TRANSITIONS: Record<ContractorStatus, ContractorStatus[]> = {
  PENDING: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
  SUSPENDED: [],
};

export async function adminSetContractorStatus(
  id: string,
  status: ContractorStatus,
  adminNote: string,
): Promise<AdminActionResult> {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return { ok: false, formError: "Admin only" };
  }

  const existing = await prisma.contractor.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!existing) return { ok: false, formError: "Contractor not found" };

  const allowed = VALID_TRANSITIONS[existing.status];
  if (!allowed.includes(status)) {
    return { ok: false, formError: `Invalid transition ${existing.status} → ${status}` };
  }

  const note = adminNote?.trim();
  if (!note) {
    return { ok: false, fieldErrors: { adminNote: "Required for this transition" } };
  }

  const ownerMember = await prisma.contractorMember.findFirst({
    where: { contractorId: id, role: "OWNER" },
    select: { userId: true },
  });

  await prisma.contractor.update({
    where: { id },
    data: {
      status,
      adminNote: note,
      reviewedAt: new Date(),
      reviewedById: session.user.id,
    },
  });

  if (ownerMember) {
    try {
      const { sendContractorStatusChangedToOwner } = await import("@/lib/resend-contractor");
      await sendContractorStatusChangedToOwner(id, status, ownerMember.userId);
    } catch (err) {
      console.error("[contractor] owner notification failed:", err);
    }
  }

  revalidatePath("/[locale]/admin/contractors", "page");
  revalidatePath(`/[locale]/admin/contractors/${id}`, "page");
  revalidatePath(`/[locale]/me/contractor/${id}`, "page");
  return { ok: true };
}
