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
