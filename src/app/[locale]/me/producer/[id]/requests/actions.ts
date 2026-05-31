"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type ActionResult = {
  ok: boolean;
  claimId?: string;
  fieldErrors?: Record<string, string>;
  formError?: string;
};

async function assertProducerOwner(producerId: string): Promise<
  | { ok: true; userId: string; producer: { displayName: string } }
  | { ok: false; result: ActionResult }
> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, result: { ok: false, formError: "Not authenticated" } };
  }
  const producer = await prisma.producer.findUnique({
    where: { id: producerId },
    select: { claimedById: true, displayName: true },
  });
  if (!producer || producer.claimedById !== session.user.id) {
    return { ok: false, result: { ok: false, formError: "Producer not found" } };
  }
  return { ok: true, userId: session.user.id, producer: { displayName: producer.displayName } };
}

export async function expressProducerInterest(input: {
  buildRequestId: string;
  producerId: string;
  message?: string;
}): Promise<ActionResult> {
  const owner = await assertProducerOwner(input.producerId);
  if (!owner.ok) return owner.result;

  const message = input.message?.trim() || null;
  if (message && message.length > 2000) {
    return { ok: false, fieldErrors: { message: "Too long (max 2000)" } };
  }

  const br = await prisma.buildRequest.findUnique({
    where: { id: input.buildRequestId },
    select: { id: true, status: true, userId: true },
  });
  if (!br) return { ok: false, formError: "Build request not found" };
  if (br.status !== "OPEN") return { ok: false, formError: "This build request is no longer open" };

  try {
    const created = await prisma.producerBuildRequestClaim.create({
      data: {
        buildRequestId: br.id,
        producerId: input.producerId,
        status: "PENDING",
        message,
      },
      select: { id: true },
    });

    try {
      const { sendProducerInterestExpressedToOwner } = await import("@/lib/resend-producer-match");
      await sendProducerInterestExpressedToOwner({
        claimId: created.id,
        buildRequestId: br.id,
        producerName: owner.producer.displayName,
        ownerUserId: br.userId,
      });
    } catch (err) {
      console.error("[r4] producer-interest notification failed:", err);
    }

    revalidatePath(`/[locale]/me/producer/${input.producerId}/requests`, "page");
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

export async function withdrawProducerClaim(input: {
  claimId: string;
  producerId: string;
}): Promise<ActionResult> {
  const owner = await assertProducerOwner(input.producerId);
  if (!owner.ok) return owner.result;

  const claim = await prisma.producerBuildRequestClaim.findUnique({
    where: { id: input.claimId },
    select: { id: true, producerId: true, status: true, buildRequestId: true },
  });
  if (!claim || claim.producerId !== input.producerId) {
    return { ok: false, formError: "Claim not found" };
  }
  if (claim.status !== "PENDING") {
    return { ok: false, formError: "Claim can no longer be withdrawn" };
  }

  await prisma.producerBuildRequestClaim.update({
    where: { id: claim.id },
    data: { status: "WITHDRAWN", respondedAt: new Date() },
  });

  revalidatePath(`/[locale]/me/producer/${input.producerId}/requests`, "page");
  revalidatePath(`/[locale]/me/build-requests/${claim.buildRequestId}`, "page");
  return { ok: true, claimId: claim.id };
}
