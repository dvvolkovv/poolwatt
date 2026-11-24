// Acceptance points — ТЗ §28 (the card's fields), §29 (the wizard and the
// lifecycle), US-24.
//
// The wizard writes through this module one step at a time. Two rules live
// here and nowhere else, because the wizard and the server have to agree on
// them: what counts as a filled-in card (§28's "Обязательно" column), and what
// a change costs a card that is already live (§29.5).

import {
  type AcceptancePoint,
  type ConnectorStatus,
  type EvConnectorType,
  type PointEnergySource,
  type PointType,
  type PointVisibility,
  PointStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/exchange/audit";

export class PointError extends Error {}

export const WIZARD_STEPS = [
  "type",
  "address",
  "equipment",
  "tariffs",
  "payment",
  "connection",
  "publish",
] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Opening hours are their own step but share the publish screen's form. */
export type StepName = WizardStep | "hours";

/**
 * §29.5 — a change that alters what a driver drives to has to be looked at
 * again; a price or an opening hour does not.
 */
const REMODERATED_STEPS: ReadonlySet<StepName> = new Set(["type", "address", "equipment"]);

export interface ConnectorInput {
  type: EvConnectorType;
  powerKw: number;
  currentAc: boolean;
  quantity: number;
}

export interface TariffInput {
  label?: string | null;
  fromMinute: number;
  toMinute: number;
  priceFiat?: number | null;
  currency?: string;
  priceTokens?: number | null;
  idleFeePerMin?: number | null;
  coopDiscount?: number;
}

export interface StepPayload {
  // type
  type?: PointType;
  name?: string;
  // address
  country?: string;
  city?: string;
  addressLine?: string;
  latitude?: number;
  longitude?: number;
  gridZoneId?: string | null;
  howToFind?: string;
  // equipment
  energySource?: PointEnergySource;
  goCertificateRef?: string | null;
  storageKwh?: number | null;
  connectors?: ConnectorInput[];
  // tariffs
  tariffs?: TariffInput[];
  // payment
  paymentMethods?: string[];
  visibility?: PointVisibility;
  amenities?: string[];
  // connection
  ocppVersion?: string | null;
  meterId?: string | null;
  // hours
  open24?: boolean;
  openHours?: unknown;
  holidayNote?: string | null;
  closedFrom?: Date | null;
  closedUntil?: Date | null;
  // brand
  logoUrl?: string | null;
  pinColor?: string | null;
  description?: string | null;
}

async function requireOwned(pointId: string, userId: string) {
  const point = await prisma.acceptancePoint.findUnique({
    where: { id: pointId },
    include: { operator: { select: { claimedById: true } } },
  });
  if (!point) throw new PointError("Point not found");
  if (point.operator.claimedById !== userId) {
    throw new PointError("Not your network");
  }
  return point;
}

export async function createDraftPoint(
  operatorId: string,
  userId: string,
  type: PointType,
  name: string,
): Promise<AcceptancePoint> {
  const operator = await prisma.chargerOperator.findUnique({
    where: { id: operatorId },
    select: { claimedById: true },
  });
  if (!operator) throw new PointError("Operator not found");
  if (operator.claimedById !== userId) throw new PointError("Not your network");

  // §29.2 — the row exists before the first field is typed, so a closed tab
  // loses nothing and "autosave" is just the next step writing to it.
  const point = await prisma.acceptancePoint.create({
    data: { operatorId, type, name: name.trim().slice(0, 160) },
  });
  await writeAudit(prisma, {
    actor: userId,
    entity: "AcceptancePoint",
    entityId: point.id,
    action: "point.draft.created",
    after: { type, name: point.name },
  });
  return point;
}

export async function savePointStep(
  pointId: string,
  userId: string,
  step: StepName,
  payload: StepPayload,
): Promise<AcceptancePoint> {
  const before = await requireOwned(pointId, userId);

  const data: Prisma.AcceptancePointUpdateInput = {};
  if (step === "type") {
    if (payload.type) data.type = payload.type;
    if (payload.name != null) data.name = payload.name.trim().slice(0, 160);
  }
  if (step === "address") {
    assign(data, payload, [
      "country",
      "city",
      "addressLine",
      "latitude",
      "longitude",
      "howToFind",
    ]);
    if (payload.gridZoneId !== undefined) {
      data.gridZone = payload.gridZoneId
        ? { connect: { id: payload.gridZoneId } }
        : { disconnect: true };
    }
  }
  if (step === "equipment") {
    assign(data, payload, ["energySource", "goCertificateRef"]);
    if (payload.storageKwh !== undefined) {
      data.storageKwh =
        payload.storageKwh == null ? null : new Prisma.Decimal(payload.storageKwh);
    }
  }
  if (step === "payment") {
    assign(data, payload, ["visibility"]);
    if (payload.paymentMethods) data.paymentMethods = payload.paymentMethods;
    if (payload.amenities) data.amenities = payload.amenities;
  }
  if (step === "connection") {
    assign(data, payload, ["ocppVersion", "meterId"]);
  }
  if (step === "hours") {
    assign(data, payload, ["open24", "holidayNote", "closedFrom", "closedUntil"]);
    if (payload.openHours !== undefined) {
      data.openHours = (payload.openHours ?? Prisma.DbNull) as Prisma.InputJsonValue;
    }
  }
  if (step === "publish") {
    assign(data, payload, ["logoUrl", "pinColor", "description"]);
  }

  // §29.5 — only a live card can fall back into moderation; a draft stays a
  // draft, and a card already under review stays there.
  if (REMODERATED_STEPS.has(step) && before.status === PointStatus.PUBLISHED) {
    data.status = PointStatus.REVIEW;
    data.submittedAt = new Date();
  }

  await prisma.$transaction(async (tx) => {
    await tx.acceptancePoint.update({ where: { id: pointId }, data });

    if (step === "equipment" && payload.connectors) {
      await tx.pointConnector.deleteMany({ where: { pointId } });
      for (const c of payload.connectors) {
        await tx.pointConnector.create({
          data: {
            pointId,
            type: c.type,
            powerKw: new Prisma.Decimal(c.powerKw),
            currentAc: c.currentAc,
            quantity: Math.max(1, Math.trunc(c.quantity)),
          },
        });
      }
    }

    if (step === "tariffs" && payload.tariffs) {
      await tx.pointTariff.deleteMany({ where: { pointId } });
      for (const t of payload.tariffs) {
        await tx.pointTariff.create({
          data: {
            pointId,
            label: t.label ?? null,
            fromMinute: t.fromMinute,
            toMinute: t.toMinute,
            priceFiat: t.priceFiat == null ? null : new Prisma.Decimal(t.priceFiat),
            currency: t.currency ?? "EUR",
            priceTokens: t.priceTokens == null ? null : new Prisma.Decimal(t.priceTokens),
            idleFeePerMin:
              t.idleFeePerMin == null ? null : new Prisma.Decimal(t.idleFeePerMin),
            coopDiscount: t.coopDiscount ?? 0,
          },
        });
      }
    }

    await writeAudit(tx, {
      actor: userId,
      entity: "AcceptancePoint",
      entityId: pointId,
      action: `point.step.${step}`,
      before: { status: before.status },
      after: { step },
    });
  });

  return prisma.acceptancePoint.findUniqueOrThrow({ where: { id: pointId } });
}

function assign(
  data: Record<string, unknown>,
  payload: StepPayload,
  keys: (keyof StepPayload)[],
): void {
  for (const key of keys) {
    if (payload[key] !== undefined) data[key as string] = payload[key];
  }
}

/**
 * The §28 "Обязательно" column, as a list of what is still missing.
 *
 * One function serves both the wizard step and the submit guard: two copies
 * would be two different ideas of "filled in", and the one in the browser
 * would be the one that lied.
 */
export async function missingRequiredFields(pointId: string): Promise<string[]> {
  const point = await prisma.acceptancePoint.findUnique({
    where: { id: pointId },
    include: { connectors: true, tariffs: true },
  });
  if (!point) throw new PointError("Point not found");

  const missing: string[] = [];
  if (!point.name?.trim()) missing.push("name");
  if (!point.country || !point.city || !point.addressLine) missing.push("address");
  if (point.latitude == null || point.longitude == null) missing.push("coordinates");
  if (!point.gridZoneId) missing.push("gridZone");
  if (!point.howToFind?.trim()) missing.push("howToFind");
  if (!point.energySource) missing.push("energySource");
  if (point.connectors.length === 0) missing.push("connectors");
  // §28 — a powerbank's capacity is the whole point of it.
  if ((point.type === "POWERBANK" || point.type === "MIXED") && point.storageKwh == null) {
    missing.push("storageKwh");
  }
  if (point.tariffs.length === 0) missing.push("tariffs");
  if (!point.open24 && !point.openHours) missing.push("openHours");
  if (point.paymentMethods.length === 0) missing.push("paymentMethods");
  return missing;
}

export async function submitPointForReview(
  pointId: string,
  userId: string,
): Promise<AcceptancePoint> {
  await requireOwned(pointId, userId);

  const missing = await missingRequiredFields(pointId);
  if (missing.length > 0) {
    throw new PointError(`Required fields are still missing: ${missing.join(", ")}`);
  }

  const point = await prisma.acceptancePoint.update({
    where: { id: pointId },
    data: { status: PointStatus.REVIEW, submittedAt: new Date(), reviewNote: null },
  });
  await writeAudit(prisma, {
    actor: userId,
    entity: "AcceptancePoint",
    entityId: pointId,
    action: "point.submitted",
    after: { status: point.status },
  });
  return point;
}

export async function decidePoint(
  pointId: string,
  reviewerUserId: string,
  approved: boolean,
  note: string | null,
): Promise<AcceptancePoint> {
  const before = await prisma.acceptancePoint.findUnique({ where: { id: pointId } });
  if (!before) throw new PointError("Point not found");
  if (before.status !== PointStatus.REVIEW) {
    throw new PointError(`Only a point in review can be decided, this one is ${before.status}`);
  }
  if (!approved && !note?.trim()) {
    throw new PointError("A rejection needs a reason the owner can act on");
  }

  const point = await prisma.acceptancePoint.update({
    where: { id: pointId },
    data: {
      // §29.4 — approval opens the test connection; the navigator waits for
      // the equipment to say something first.
      status: approved ? PointStatus.TEST : PointStatus.DRAFT,
      reviewedAt: new Date(),
      reviewedById: reviewerUserId,
      reviewNote: note?.trim() ?? null,
    },
  });
  await writeAudit(prisma, {
    actor: reviewerUserId,
    entity: "AcceptancePoint",
    entityId: pointId,
    action: approved ? "point.approved" : "point.rejected",
    before: { status: before.status },
    after: { status: point.status, note: point.reviewNote },
  });
  return point;
}

/**
 * §29.4 — "публикация после проверки оператором и первых данных от
 * оборудования". Called from the availability endpoint, so a point that was
 * approved but never connected never reaches a driver.
 */
export async function publishOnFirstReport(pointId: string): Promise<AcceptancePoint> {
  const point = await prisma.acceptancePoint.findUnique({ where: { id: pointId } });
  if (!point) throw new PointError("Point not found");
  if (point.status !== PointStatus.TEST) return point;

  const published = await prisma.acceptancePoint.update({
    where: { id: pointId },
    data: { status: PointStatus.PUBLISHED, publishedAt: new Date() },
  });
  await writeAudit(prisma, {
    actor: "system",
    entity: "AcceptancePoint",
    entityId: pointId,
    action: "point.published",
    after: { publishedAt: published.publishedAt?.toISOString() },
  });
  return published;
}

export type { ConnectorStatus };
