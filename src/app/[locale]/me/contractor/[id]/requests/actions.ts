"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { expressInterestInputSchema } from "@/lib/build-request-claim-schema";

export type ActionResult = {
  ok: boolean;
  claimId?: string;
  fieldErrors?: Record<string, string>;
  formError?: string;
};

export async function expressInterest(input: {
  buildRequestId: string;
  contractorId: string;
  message?: string;
}): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated" };

  const parsed = expressInterestInputSchema.safeParse({ message: input.message ?? "" });
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: { message: parsed.error.issues[0]?.message ?? "invalid" },
    };
  }
  const message = parsed.data.message ?? null;

  const contractor = await prisma.contractor.findUnique({
    where: { id: input.contractorId },
    select: {
      id: true,
      status: true,
      displayName: true,
      members: {
        where: { userId: session.user.id, role: "OWNER" },
        select: { userId: true },
      },
    },
  });
  if (!contractor || contractor.members.length === 0) {
    return { ok: false, formError: "Contractor not found" };
  }
  if (contractor.status !== "APPROVED") {
    return { ok: false, formError: "Your contractor profile must be APPROVED before you can express interest" };
  }

  const br = await prisma.buildRequest.findUnique({
    where: { id: input.buildRequestId },
    select: { id: true, status: true, userId: true },
  });
  if (!br) return { ok: false, formError: "Build request not found" };
  if (br.status !== "OPEN") return { ok: false, formError: "This build request is no longer open" };

  try {
    const created = await prisma.buildRequestClaim.create({
      data: {
        buildRequestId: br.id,
        contractorId: contractor.id,
        status: "PENDING",
        message,
      },
      select: { id: true },
    });

    try {
      const { sendInterestExpressedToOwner } = await import("@/lib/resend-match");
      await sendInterestExpressedToOwner({
        claimId: created.id,
        buildRequestId: br.id,
        contractorName: contractor.displayName,
        ownerUserId: br.userId,
      });
    } catch (err) {
      console.error("[matching] interest-expressed notification failed:", err);
    }

    revalidatePath(`/[locale]/me/contractor/${contractor.id}/requests`, "page");
    revalidatePath(`/[locale]/me/build-requests/${br.id}`, "page");
    return { ok: true, claimId: created.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Unique constraint") || msg.includes("P2002")) {
      return { ok: false, formError: "You have already expressed interest in this request" };
    }
    throw err;
  }
}

export async function withdrawClaim(input: {
  claimId: string;
  contractorId: string;
}): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated" };

  const member = await prisma.contractorMember.findUnique({
    where: { contractorId_userId: { contractorId: input.contractorId, userId: session.user.id } },
    select: { role: true },
  });
  if (!member || member.role !== "OWNER") {
    return { ok: false, formError: "Contractor not found" };
  }

  const claim = await prisma.buildRequestClaim.findUnique({
    where: { id: input.claimId },
    select: { id: true, contractorId: true, status: true, buildRequestId: true },
  });
  if (!claim || claim.contractorId !== input.contractorId) {
    return { ok: false, formError: "Claim not found" };
  }
  if (claim.status !== "PENDING") {
    return { ok: false, formError: "Claim can no longer be withdrawn" };
  }

  await prisma.buildRequestClaim.update({
    where: { id: claim.id },
    data: { status: "WITHDRAWN", respondedAt: new Date() },
  });

  revalidatePath(`/[locale]/me/contractor/${input.contractorId}/requests`, "page");
  revalidatePath(`/[locale]/me/build-requests/${claim.buildRequestId}`, "page");
  return { ok: true, claimId: claim.id };
}
