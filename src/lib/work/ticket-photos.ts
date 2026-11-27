// Фотографии заявки — §51.4 «можно приложить фото и комментарий».
//
// Устройство то же, что у фотографий пункта и документов листинга: файлы
// лежат вне веб-корня, тип определяется по первым байтам, а не по расширению,
// и отдаются маршрутом, который решает, кому можно.
//
// Таблицы для них нет: ключи складываются в существующий `Ticket.photos`, и
// файл находится по ключу обратным поиском. Это даёт одну неочевидную
// выгоду — ту же фотографию несёт наряд (§48 «фото клиента»), и маршрут
// файла может спросить про право на наряд, не зная ничего о заявке.

import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { prisma } from "@/lib/prisma";

/** §51 — снимок с места, а не галерея станции. */
export const MAX_TICKET_PHOTOS = 3;
export const MAX_TICKET_PHOTO_BYTES = 5 * 1024 * 1024;

export class TicketPhotoError extends Error {}

export function photosRoot(): string {
  return process.env.TICKET_PHOTOS_DIR || "var/ticket-photos";
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

export interface IncomingPhoto {
  filename: string;
  bytes: Buffer;
}

/**
 * Проверяет всё, и только потом пишет: заявка не должна остаться с половиной
 * фотографий, потому что четвёртая оказалась лишней.
 */
export async function saveTicketPhotos(
  ticketId: string,
  photos: IncomingPhoto[],
): Promise<string[]> {
  if (photos.length === 0) return [];
  if (!safeSegment(ticketId)) throw new TicketPhotoError("Bad ticket id");

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, photos: true },
  });
  if (!ticket) throw new TicketPhotoError("No such ticket");

  if (ticket.photos.length + photos.length > MAX_TICKET_PHOTOS) {
    throw new TicketPhotoError(
      `A report carries at most ${MAX_TICKET_PHOTOS} photos`,
    );
  }

  const checked = photos.map((photo) => {
    if (photo.bytes.length === 0) throw new TicketPhotoError("The file is empty");
    if (photo.bytes.length > MAX_TICKET_PHOTO_BYTES) {
      throw new TicketPhotoError(
        `The file is ${Math.round(photo.bytes.length / 1024 / 1024)} MB, over the 5 MB limit`,
      );
    }
    const contentType = sniffImage(photo.bytes);
    if (!contentType) {
      throw new TicketPhotoError("Only JPEG, PNG and WebP images are accepted");
    }
    return { bytes: photo.bytes, contentType, key: randomBytes(12).toString("hex") };
  });

  const dir = join(photosRoot(), ticketId);
  await mkdir(dir, { recursive: true });
  for (const photo of checked) {
    await writeFile(join(dir, photo.key), photo.bytes, { mode: 0o600 });
  }

  const keys = checked.map((p) => p.key);
  await prisma.ticket.update({
    where: { id: ticketId },
    data: { photos: { push: keys } },
  });
  return keys;
}

export interface FoundPhoto {
  ticketId: string;
  bytes: Buffer;
  contentType: string;
}

/**
 * Файл по ключу, вместе с заявкой, которой он принадлежит, — чтобы маршрут
 * мог спросить про право. Тип читается заново из байтов: отдавать нужно то,
 * что в файле на самом деле.
 */
export async function readTicketPhoto(key: string): Promise<FoundPhoto | null> {
  if (!safeSegment(key)) return null;
  const ticket = await prisma.ticket.findFirst({
    where: { photos: { has: key } },
    select: { id: true },
  });
  if (!ticket) return null;

  const path = join(photosRoot(), ticket.id, key);
  if (!resolve(path).startsWith(resolve(photosRoot()) + sep)) return null;
  try {
    const bytes = await readFile(path);
    return { ticketId: ticket.id, bytes, contentType: sniffImage(bytes) ?? "application/octet-stream" };
  } catch {
    return null;
  }
}
