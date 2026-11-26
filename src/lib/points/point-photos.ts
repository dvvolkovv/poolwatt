// §28 «Адрес и карта: … фото до 10 шт.», §27 «Полная карточка: … фото».
//
// Таблица `PointPhoto` стояла в схеме с самого начала и до этого этапа была
// пуста: её ничто не заполняло. Устройство то же, что у документов листинга —
// файлы лежат вне веб-корня и отдаются маршрутом, который решает, кому
// можно; тип определяется по первым байтам файла, а не по тому, как он себя
// называет.

import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { prisma } from "@/lib/prisma";

/** §28 — «до 10 шт.». */
export const MAX_PHOTOS = 10;
/** Фотография станции, а не обои: пяти мегабайт хватает с запасом. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export class PhotoError extends Error {}

/**
 * Где лежат файлы. По умолчанию относительный путь, который `fs` разрешает
 * от каталога процесса: с `process.cwd()` трассировщик Turbopack тянет в
 * список файлов сборки весь проект.
 */
export function photosRoot(): string {
  return process.env.POINT_PHOTOS_DIR || "var/point-photos";
}

/** Первые байты трёх типов, которые мы принимаем. */
export function sniffImage(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function safeSegment(value: string): boolean {
  return value.length > 0 && value.length <= 64 && /^[A-Za-z0-9_-]+$/.test(value);
}

function withinRoot(path: string): boolean {
  return resolve(path).startsWith(resolve(photosRoot()) + sep);
}

export interface StoredPhoto {
  id: string;
  pointId: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  position: number;
  uploadedAt: string;
}

export async function savePointPhoto(args: {
  pointId: string;
  filename: string;
  bytes: Buffer;
}): Promise<StoredPhoto> {
  if (!safeSegment(args.pointId)) throw new PhotoError("Bad point id");
  if (args.bytes.length === 0) throw new PhotoError("The file is empty");
  if (args.bytes.length > MAX_PHOTO_BYTES) {
    throw new PhotoError(
      `The file is ${Math.round(args.bytes.length / 1024 / 1024)} MB, over the 5 MB limit`,
    );
  }
  const contentType = sniffImage(args.bytes);
  if (!contentType) throw new PhotoError("Only JPEG, PNG and WebP images are accepted");

  const taken = await prisma.pointPhoto.count({ where: { pointId: args.pointId } });
  if (taken >= MAX_PHOTOS) {
    throw new PhotoError(`A point carries at most ${MAX_PHOTOS} photos`);
  }

  const storageKey = randomBytes(12).toString("hex");
  const dir = join(photosRoot(), args.pointId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, storageKey), args.bytes, { mode: 0o600 });

  const row = await prisma.pointPhoto.create({
    data: {
      pointId: args.pointId,
      storageKey,
      contentType,
      sizeBytes: args.bytes.length,
      position: taken,
    },
  });

  return {
    id: row.id,
    pointId: row.pointId,
    storageKey: row.storageKey,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    position: row.position,
    uploadedAt: row.uploadedAt.toISOString(),
  };
}

export async function listPointPhotos(pointId: string): Promise<StoredPhoto[]> {
  const rows = await prisma.pointPhoto.findMany({
    where: { pointId },
    orderBy: [{ position: "asc" }, { uploadedAt: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    pointId: r.pointId,
    storageKey: r.storageKey,
    contentType: r.contentType,
    sizeBytes: r.sizeBytes,
    position: r.position,
    uploadedAt: r.uploadedAt.toISOString(),
  }));
}

export async function readPointPhoto(
  photoId: string,
): Promise<{ bytes: Buffer; contentType: string; pointId: string } | null> {
  if (!safeSegment(photoId)) return null;
  const row = await prisma.pointPhoto.findUnique({ where: { id: photoId } });
  if (!row) return null;

  const path = join(photosRoot(), row.pointId, row.storageKey);
  if (!withinRoot(path)) return null;
  try {
    return { bytes: await readFile(path), contentType: row.contentType, pointId: row.pointId };
  } catch {
    return null;
  }
}

export async function deletePointPhoto(photoId: string): Promise<boolean> {
  if (!safeSegment(photoId)) return false;
  const row = await prisma.pointPhoto.findUnique({ where: { id: photoId } });
  if (!row) return false;

  const path = join(photosRoot(), row.pointId, row.storageKey);
  if (withinRoot(path)) {
    // Файла может уже не быть — строку всё равно убираем: карточка не должна
    // показывать фотографию, которой нет.
    await unlink(path).catch(() => undefined);
  }
  await prisma.pointPhoto.delete({ where: { id: photoId } });
  return true;
}
