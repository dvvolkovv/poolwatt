"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildRequestSchema, type BuildRequestInput } from "@/lib/build-request-schema";

export type ActionResult = {
  ok: boolean;
  id?: string;
  fieldErrors?: Record<string, string>;
  formError?: string;
};

export async function createBuildRequest(input: BuildRequestInput): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated" };

  const parsed = buildRequestSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0];
      if (typeof k === "string" && !fieldErrors[k]) fieldErrors[k] = issue.message;
    }
    return { ok: false, fieldErrors };
  }

  const d = parsed.data;
  const created = await prisma.buildRequest.create({
    data: {
      userId: session.user.id,
      source: d.source,
      peakKw: d.peakKw,
      wantPowerbank: d.wantPowerbank,
      powerbankKwh: d.powerbankKwh ?? null,
      wantEvCharger: d.wantEvCharger,
      evChargerPorts: d.evChargerPorts ?? null,
      evPublicForSale: d.evPublicForSale,
      country: d.country,
      city: d.city,
      addressLine: d.addressLine,
      lat: d.lat ?? null,
      lng: d.lng ?? null,
      siteType: d.siteType,
      availableAreaM2: d.availableAreaM2 ?? null,
      roofOrientation: d.roofOrientation ?? null,
      budget: d.budget,
      timeline: d.timeline,
      notes: d.notes ?? null,
    },
    select: { id: true, status: true, source: true, peakKw: true, country: true },
  });

  try {
    const { sendBuildRequestNewToAdmin } = await import("@/lib/resend-build-request");
    await sendBuildRequestNewToAdmin(created);
  } catch (err) {
    console.error("[build-request] admin notification failed:", err);
  }

  revalidatePath("/[locale]/me/build-requests", "page");
  return { ok: true, id: created.id };
}

export async function updateBuildRequest(
  id: string,
  input: BuildRequestInput,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated" };

  const existing = await prisma.buildRequest.findUnique({
    where: { id },
    select: { id: true, userId: true, status: true },
  });
  if (!existing || existing.userId !== session.user.id) {
    return { ok: false, formError: "Request not found" };
  }
  if (existing.status !== "OPEN") {
    return { ok: false, formError: "Cannot edit a request that is no longer OPEN" };
  }

  const parsed = buildRequestSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0];
      if (typeof k === "string" && !fieldErrors[k]) fieldErrors[k] = issue.message;
    }
    return { ok: false, fieldErrors };
  }

  const d = parsed.data;
  await prisma.buildRequest.update({
    where: { id },
    // keep in sync with createBuildRequest's data block
    data: {
      source: d.source,
      peakKw: d.peakKw,
      wantPowerbank: d.wantPowerbank,
      powerbankKwh: d.powerbankKwh ?? null,
      wantEvCharger: d.wantEvCharger,
      evChargerPorts: d.evChargerPorts ?? null,
      evPublicForSale: d.evPublicForSale,
      country: d.country,
      city: d.city,
      addressLine: d.addressLine,
      lat: d.lat ?? null,
      lng: d.lng ?? null,
      siteType: d.siteType,
      availableAreaM2: d.availableAreaM2 ?? null,
      roofOrientation: d.roofOrientation ?? null,
      budget: d.budget,
      timeline: d.timeline,
      notes: d.notes ?? null,
    },
  });

  revalidatePath("/[locale]/me/build-requests", "page");
  revalidatePath(`/[locale]/me/build-requests/${id}`, "page");
  return { ok: true, id };
}

export async function cancelBuildRequest(id: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated" };

  const existing = await prisma.buildRequest.findUnique({
    where: { id },
    select: { id: true, userId: true, status: true },
  });
  if (!existing || existing.userId !== session.user.id) {
    return { ok: false, formError: "Request not found" };
  }
  if (existing.status === "FULFILLED") {
    return { ok: false, formError: "Cannot cancel a fulfilled request" };
  }
  if (existing.status === "CANCELLED") {
    return { ok: true, id };  // idempotent
  }

  await prisma.$transaction([
    prisma.buildRequest.update({
      where: { id },
      data: {
        status: "CANCELLED",
        statusChangedAt: new Date(),
        statusChangedById: session.user.id,
      },
    }),
    prisma.buildRequestClaim.updateMany({
      where: { buildRequestId: id, status: "PENDING" },
      data: { status: "WITHDRAWN", respondedAt: new Date() },
    }),
  ]);

  revalidatePath("/[locale]/me/build-requests", "page");
  revalidatePath(`/[locale]/me/build-requests/${id}`, "page");
  return { ok: true, id };
}

export async function acceptClaim(claimId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated" };

  const claim = await prisma.buildRequestClaim.findUnique({
    where: { id: claimId },
    select: {
      id: true,
      status: true,
      contractorId: true,
      buildRequest: { select: { id: true, userId: true, status: true } },
    },
  });
  if (!claim) return { ok: false, formError: "Claim not found" };

  if (claim.buildRequest.userId !== session.user.id) {
    return { ok: false, formError: "Claim not found" };
  }
  if (claim.status !== "PENDING") {
    return { ok: false, formError: "Claim cannot be accepted (not PENDING)" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.buildRequest.update({
        where: { id: claim.buildRequest.id, status: "OPEN" },
        data: {
          status: "MATCHED",
          statusChangedAt: new Date(),
          statusChangedById: session.user.id,
        },
        select: { id: true },
      });

      await tx.buildRequestClaim.update({
        where: { id: claim.id },
        data: { status: "ACCEPTED", respondedAt: new Date() },
      });

      await tx.buildRequestClaim.updateMany({
        where: {
          buildRequestId: updated.id,
          status: "PENDING",
          NOT: { id: claim.id },
        },
        data: { status: "REJECTED", respondedAt: new Date() },
      });
    });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    const msg = err instanceof Error ? err.message : String(err);
    if (code === "P2025" || msg.includes("P2025") || msg.includes("Record to update not found")) {
      return { ok: false, formError: "Request status changed concurrently — please refresh" };
    }
    throw err;
  }

  try {
    const { sendClaimAcceptedToContractor, sendClaimRejectedToContractor } = await import("@/lib/resend-match");
    await sendClaimAcceptedToContractor({
      claimId: claim.id,
      buildRequestId: claim.buildRequest.id,
      contractorId: claim.contractorId,
    });
    const siblings = await prisma.buildRequestClaim.findMany({
      where: { buildRequestId: claim.buildRequest.id, status: "REJECTED" },
      select: { id: true, contractorId: true },
    });
    for (const s of siblings) {
      await sendClaimRejectedToContractor({
        claimId: s.id,
        buildRequestId: claim.buildRequest.id,
        contractorId: s.contractorId,
      });
    }
  } catch (err) {
    console.error("[matching] accept notifications failed:", err);
  }

  revalidatePath(`/[locale]/me/build-requests/${claim.buildRequest.id}`, "page");
  revalidatePath(`/[locale]/me/contractor/[id]/requests`, "page");
  return { ok: true };
}

export async function acceptProducerClaim(input: {
  buildRequestId: string;
  claimId: string;
}): Promise<{ ok: boolean; formError?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated" };

  const br = await prisma.buildRequest.findUnique({
    where: { id: input.buildRequestId },
    select: { id: true, userId: true, status: true },
  });
  if (!br) return { ok: false, formError: "Build request not found" };
  if (br.userId !== session.user.id) return { ok: false, formError: "Not authorized" };
  if (br.status !== "OPEN") return { ok: false, formError: "Build request is no longer open" };

  const claim = await prisma.producerBuildRequestClaim.findUnique({
    where: { id: input.claimId },
    select: { id: true, buildRequestId: true, status: true, producerId: true },
  });
  if (!claim || claim.buildRequestId !== br.id) {
    return { ok: false, formError: "Claim not found" };
  }
  if (claim.status !== "PENDING") {
    return { ok: false, formError: "Claim is no longer pending" };
  }

  await prisma.$transaction([
    prisma.producerBuildRequestClaim.update({
      where: { id: claim.id },
      data: { status: "ACCEPTED", respondedAt: new Date() },
    }),
    prisma.buildRequest.update({
      where: { id: br.id },
      data: { status: "MATCHED" },
    }),
    prisma.producerBuildRequestClaim.updateMany({
      where: { buildRequestId: br.id, status: "PENDING", id: { not: claim.id } },
      data: { status: "REJECTED", respondedAt: new Date() },
    }),
    prisma.buildRequestClaim.updateMany({
      where: { buildRequestId: br.id, status: "PENDING" },
      data: { status: "REJECTED", respondedAt: new Date() },
    }),
  ]);

  try {
    const { sendProducerClaimAcceptedToProducer } = await import("@/lib/resend-producer-match");
    await sendProducerClaimAcceptedToProducer({
      claimId: claim.id,
      buildRequestId: br.id,
      producerId: claim.producerId,
    });
  } catch (err) {
    console.error("[r4] producer-accepted notification failed:", err);
  }

  revalidatePath(`/[locale]/me/build-requests/${br.id}`, "page");
  revalidatePath(`/[locale]/me/producer/${claim.producerId}/requests`, "page");
  return { ok: true };
}
