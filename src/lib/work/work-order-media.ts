// §48 «фото до и после» и «подпись».
//
// Устройство то же, что у фотографий заявки §51.4: файлы лежат вне
// веб-корня, тип читается из первых байтов, а не из расширения, и отдаются
// маршрутом, который спрашивает про право на наряд.
//
// Почему не `WorkOrder.photos`: это поле несёт фотографии **клиента** из
// заявки §51 — чужие снимки в чужом хранилище, с чужим правом на них. Снимок
// инженера — другая вещь, у неё своя ступень («до» или «после»), свой автор и
// своё хранилище.

import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { WorkOrderPhotoStage, WorkOrderSignerKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/exchange/audit";
import { sniffImage } from "./ticket-photos";

export class WorkOrderMediaError extends Error {}

/** На ступень, а не на наряд: «до» и «после» считаются отдельно. */
export const MAX_STAGE_PHOTOS = 6;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
/** Росчерк с холста — десятки килобайт; гигабайтная «подпись» не подпись. */
export const MAX_SIGNATURE_BYTES = 512 * 1024;

export function mediaRoot(): string {
  return process.env.WORK_ORDER_MEDIA_DIR || "var/work-order-media";
}

function safeSegment(value: string): boolean {
  return value.length > 0 && value.length <= 64 && /^[A-Za-z0-9_-]+$/.test(value);
}

async function writeMedia(workOrderId: string, bytes: Buffer): Promise<string> {
  const key = randomBytes(12).toString("hex");
  const dir = join(mediaRoot(), workOrderId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, key), bytes, { mode: 0o600 });
  return key;
}

export interface IncomingSitePhoto {
  stage: WorkOrderPhotoStage;
  filename: string;
  bytes: Buffer;
  takenById: string | null;
}

export interface SitePhotoRow {
  id: string;
  stage: WorkOrderPhotoStage;
  key: string;
  takenAt: string;
}

export async function saveSitePhoto(
  workOrderId: string,
  photo: IncomingSitePhoto,
): Promise<SitePhotoRow> {
  if (!safeSegment(workOrderId)) throw new WorkOrderMediaError("Bad work order id");
  const order = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true },
  });
  if (!order) throw new WorkOrderMediaError("Work order not found");

  if (photo.bytes.length === 0) throw new WorkOrderMediaError("The file is empty");
  if (photo.bytes.length > MAX_PHOTO_BYTES) {
    throw new WorkOrderMediaError(
      `The file is ${Math.round(photo.bytes.length / 1024 / 1024)} MB, over the 5 MB limit`,
    );
  }
  if (!sniffImage(photo.bytes)) {
    throw new WorkOrderMediaError("Only JPEG, PNG and WebP images are accepted");
  }

  const already = await prisma.workOrderPhoto.count({
    where: { workOrderId, stage: photo.stage },
  });
  if (already >= MAX_STAGE_PHOTOS) {
    throw new WorkOrderMediaError(
      `There are already ${MAX_STAGE_PHOTOS} photos of this stage`,
    );
  }

  const key = await writeMedia(workOrderId, photo.bytes);
  const row = await prisma.workOrderPhoto.create({
    data: { workOrderId, stage: photo.stage, key, takenById: photo.takenById },
  });
  return { id: row.id, stage: row.stage, key: row.key, takenAt: row.takenAt.toISOString() };
}

export interface SitePhotoStrips {
  before: SitePhotoRow[];
  after: SitePhotoRow[];
}

export async function readSitePhotos(workOrderId: string): Promise<SitePhotoStrips> {
  const rows = await prisma.workOrderPhoto.findMany({
    where: { workOrderId },
    orderBy: { takenAt: "asc" },
  });
  const map = (stage: WorkOrderPhotoStage) =>
    rows
      .filter((r) => r.stage === stage)
      .map((r) => ({
        id: r.id,
        stage: r.stage,
        key: r.key,
        takenAt: r.takenAt.toISOString(),
      }));
  return { before: map("BEFORE"), after: map("AFTER") };
}

export interface IncomingSignature {
  signerKind: WorkOrderSignerKind;
  signerName: string;
  bytes: Buffer;
  signedById: string;
}

export interface SignatureRow {
  signerKind: WorkOrderSignerKind;
  signerName: string;
  key: string;
  signedAt: string;
}

/**
 * Одна подпись на наряд. Вторая заменяет первую — человек, подписавший
 * криво, должен иметь возможность подписать заново, — но замену видно в
 * журнале: подпись это свидетельство, и подменять его молча нельзя.
 */
export async function saveSignature(
  workOrderId: string,
  input: IncomingSignature,
): Promise<SignatureRow> {
  if (!safeSegment(workOrderId)) throw new WorkOrderMediaError("Bad work order id");
  const name = input.signerName.trim();
  if (name.length === 0) {
    throw new WorkOrderMediaError("A signature needs the name of whoever signed");
  }
  if (name.length > 200) throw new WorkOrderMediaError("That name is too long");

  const order = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true },
  });
  if (!order) throw new WorkOrderMediaError("Work order not found");

  if (input.bytes.length === 0) throw new WorkOrderMediaError("The signature is empty");
  if (input.bytes.length > MAX_SIGNATURE_BYTES) {
    throw new WorkOrderMediaError("That signature file is too big to be a signature");
  }
  if (!sniffImage(input.bytes)) {
    throw new WorkOrderMediaError("A signature is an image");
  }

  const key = await writeMedia(workOrderId, input.bytes);
  const before = await prisma.workOrderSignature.findUnique({ where: { workOrderId } });
  const row = await prisma.workOrderSignature.upsert({
    where: { workOrderId },
    create: {
      workOrderId,
      signerKind: input.signerKind,
      signerName: name,
      key,
      signedById: input.signedById,
    },
    update: {
      signerKind: input.signerKind,
      signerName: name,
      key,
      signedById: input.signedById,
      signedAt: new Date(),
    },
  });

  await writeAudit(prisma, {
    actor: input.signedById,
    entity: "WorkOrder",
    entityId: workOrderId,
    action: "workorder.signed",
    before: before
      ? { signerKind: before.signerKind, signerName: before.signerName, key: before.key }
      : undefined,
    after: { signerKind: row.signerKind, signerName: row.signerName, key: row.key },
  });

  return {
    signerKind: row.signerKind,
    signerName: row.signerName,
    key: row.key,
    signedAt: row.signedAt.toISOString(),
  };
}

export async function readSignature(workOrderId: string): Promise<SignatureRow | null> {
  const row = await prisma.workOrderSignature.findUnique({ where: { workOrderId } });
  if (!row) return null;
  return {
    signerKind: row.signerKind,
    signerName: row.signerName,
    key: row.key,
    signedAt: row.signedAt.toISOString(),
  };
}

export interface FoundMedia {
  workOrderId: string;
  bytes: Buffer;
  contentType: string;
}

/**
 * Файл по ключу вместе с нарядом, которому он принадлежит, — чтобы маршрут
 * мог спросить про право. Тип читается заново из байтов: отдавать нужно то,
 * что в файле на самом деле.
 */
export async function readWorkOrderMedia(key: string): Promise<FoundMedia | null> {
  if (!safeSegment(key)) return null;

  const photo = await prisma.workOrderPhoto.findUnique({
    where: { key },
    select: { workOrderId: true },
  });
  const signature = photo
    ? null
    : await prisma.workOrderSignature.findUnique({
        where: { key },
        select: { workOrderId: true },
      });
  const workOrderId = photo?.workOrderId ?? signature?.workOrderId ?? null;
  if (!workOrderId) return null;

  const path = join(mediaRoot(), workOrderId, key);
  if (!resolve(path).startsWith(resolve(mediaRoot()) + sep)) return null;
  try {
    const bytes = await readFile(path);
    return {
      workOrderId,
      bytes,
      contentType: sniffImage(bytes) ?? "application/octet-stream",
    };
  } catch {
    return null;
  }
}
