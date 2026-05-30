"use server";

import { revalidatePath } from "next/cache";
import type { BuildRequestStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type AdminActionResult = {
  ok: boolean;
  fieldErrors?: Record<string, string>;
  formError?: string;
};

const VALID_TRANSITIONS: Record<BuildRequestStatus, BuildRequestStatus[]> = {
  OPEN: ["MATCHED", "CANCELLED"],
  MATCHED: ["FULFILLED", "CANCELLED"],
  FULFILLED: [],
  CANCELLED: [],
};

export async function adminSetBuildRequestStatus(
  id: string,
  status: BuildRequestStatus,
  adminNote?: string,
): Promise<AdminActionResult> {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return { ok: false, formError: "Admin only" };
  }

  const existing = await prisma.buildRequest.findUnique({
    where: { id },
    select: { id: true, status: true, userId: true },
  });
  if (!existing) return { ok: false, formError: "Request not found" };

  const allowed = VALID_TRANSITIONS[existing.status];
  if (!allowed.includes(status)) {
    return { ok: false, formError: `Invalid transition ${existing.status} → ${status}` };
  }

  const noteRequired = status === "MATCHED" || status === "CANCELLED";
  const noteValue = adminNote?.trim();
  if (noteRequired && !noteValue) {
    return { ok: false, fieldErrors: { adminNote: "Required for this transition" } };
  }

  const updated = await prisma.buildRequest.update({
    where: { id },
    data: {
      status,
      adminNote: noteValue ?? null,
      statusChangedAt: new Date(),
      statusChangedById: session.user.id,
    },
    select: { id: true, status: true, userId: true },
  });

  try {
    const { sendBuildRequestStatusChangedToOwner } = await import("@/lib/resend-build-request");
    await sendBuildRequestStatusChangedToOwner(updated.id, updated.status, updated.userId);
  } catch (err) {
    console.error("[build-request] owner notification failed:", err);
  }

  revalidatePath("/[locale]/admin/build-requests", "page");
  revalidatePath(`/[locale]/admin/build-requests/${id}`, "page");
  revalidatePath(`/[locale]/me/build-requests/${id}`, "page");
  return { ok: true };
}
