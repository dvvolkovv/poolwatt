"use server";

// The point wizard's server side — ТЗ §29, US-24.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  createDraftPoint,
  missingRequiredFields,
  savePointStep,
  submitPointForReview,
  type StepName,
} from "@/lib/points/point-service";
import { sendPointSubmittedToAdmin } from "@/lib/points/point-mail";

export type ActionResult = { ok: true } | { ok: false; formError: string };

const createSchema = z.object({
  operatorId: z.string().min(1),
  type: z.enum(["CHARGING_STATION", "POWERBANK", "GENERATION", "MIXED"]),
  name: z.string().trim().min(2).max(160),
});

export async function createPoint(
  input: unknown,
): Promise<{ ok: true; pointId: string } | { ok: false; formError: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const point = await createDraftPoint(
      parsed.data.operatorId,
      session.user.id,
      parsed.data.type,
      parsed.data.name,
    );
    revalidatePath("/[locale]/me/charger-operator/[id]/points", "page");
    return { ok: true, pointId: point.id };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not create." };
  }
}

const connectorSchema = z.object({
  type: z.enum(["CCS2", "CHAdeMO", "TYPE2", "TYPE1", "TESLA", "GB_T", "SCHUKO"]),
  powerKw: z.number().positive().max(1000),
  currentAc: z.boolean(),
  quantity: z.number().int().min(1).max(100),
});

const tariffSchema = z.object({
  label: z.string().max(80).nullable().optional(),
  fromMinute: z.number().int().min(0).max(1440),
  toMinute: z.number().int().min(0).max(1440),
  priceFiat: z.number().min(0).max(9999).nullable().optional(),
  currency: z.string().length(3).optional(),
  priceTokens: z.number().min(0).max(9999).nullable().optional(),
  idleFeePerMin: z.number().min(0).max(999).nullable().optional(),
  coopDiscount: z.number().int().min(0).max(100).optional(),
});

const stepSchema = z.object({
  pointId: z.string().min(1),
  step: z.enum([
    "type",
    "address",
    "equipment",
    "tariffs",
    "payment",
    "connection",
    "hours",
    "publish",
  ]),
  payload: z.object({
    type: z.enum(["CHARGING_STATION", "POWERBANK", "GENERATION", "MIXED"]).optional(),
    name: z.string().trim().min(2).max(160).optional(),
    country: z.string().length(2).optional(),
    city: z.string().trim().max(120).optional(),
    addressLine: z.string().trim().max(240).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    gridZoneId: z.string().nullable().optional(),
    howToFind: z.string().trim().max(1000).optional(),
    energySource: z.enum(["SOLAR", "WIND", "BIOGAS", "HYDRO", "GRID", "MIXED"]).optional(),
    goCertificateRef: z.string().max(200).nullable().optional(),
    storageKwh: z.number().min(0).max(1_000_000).nullable().optional(),
    connectors: z.array(connectorSchema).max(50).optional(),
    tariffs: z.array(tariffSchema).max(24).optional(),
    paymentMethods: z.array(z.string().max(40)).max(10).optional(),
    visibility: z.enum(["PUBLIC", "COOP_MEMBERS", "OWN_CLIENTS"]).optional(),
    amenities: z.array(z.string().max(40)).max(20).optional(),
    ocppVersion: z.string().max(10).nullable().optional(),
    meterId: z.string().max(80).nullable().optional(),
    open24: z.boolean().optional(),
    openHours: z.unknown().optional(),
    holidayNote: z.string().max(500).nullable().optional(),
    logoUrl: z.string().url().max(500).nullable().optional(),
    pinColor: z.string().max(20).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
  }),
});

export async function savePoint(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };

  const parsed = stepSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await savePointStep(
      parsed.data.pointId,
      session.user.id,
      parsed.data.step as StepName,
      parsed.data.payload,
    );
    revalidatePath("/[locale]/me/charger-operator/[id]/points/[pointId]", "page");
    return { ok: true };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not save." };
  }
}

export async function submitPoint(pointId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };

  try {
    const missing = await missingRequiredFields(pointId);
    if (missing.length > 0) {
      return { ok: false, formError: `Required fields are still missing: ${missing.join(", ")}` };
    }
    const point = await submitPointForReview(pointId, session.user.id);
    // §4 — the operator learns there is something to review; mail never fails
    // the form.
    await sendPointSubmittedToAdmin({ pointId: point.id, name: point.name });
    revalidatePath("/[locale]/me/charger-operator/[id]/points/[pointId]", "page");
    return { ok: true };
  } catch (err) {
    return { ok: false, formError: err instanceof Error ? err.message : "Could not submit." };
  }
}
