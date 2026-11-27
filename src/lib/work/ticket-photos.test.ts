// §51.4 «можно приложить фото и комментарий».
//
// До этой работы форма не принимала ни одного файла, `Ticket.photos` всегда
// был пуст, а наряд печатал «фотографии клиента» списком строк — и этого
// никто не замечал, потому что список всегда был пустой.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  MAX_TICKET_PHOTOS,
  MAX_TICKET_PHOTO_BYTES,
  TicketPhotoError,
  readTicketPhoto,
  saveTicketPhotos,
  sniffImage,
} from "./ticket-photos";

const PREFIX = "test_ticketphoto_";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(32, 7)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 3),
]);
const PDF = Buffer.from("%PDF-1.7\nnot an image at all");

let operatorId: string;
let ticketId: string;
let root: string;

async function wipe() {
  await prisma.ticket.deleteMany({ where: { operator: { slug: { startsWith: PREFIX } } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await wipe();
  root = await mkdtemp(join(tmpdir(), "poolwatt-ticket-photos-"));
  process.env.TICKET_PHOTOS_DIR = root;
  operatorId = (
    await prisma.chargerOperator.create({
      data: { slug: `${PREFIX}net`, displayName: "Photo network" },
    })
  ).id;
});

afterAll(async () => {
  await wipe();
  await rm(root, { recursive: true, force: true });
  delete process.env.TICKET_PHOTOS_DIR;
});

beforeEach(async () => {
  await prisma.ticket.deleteMany({ where: { operatorId } });
  ticketId = (
    await prisma.ticket.create({ data: { operatorId, problemType: "DAMAGED_CABLE" } })
  ).id;
});

describe("sniffImage", () => {
  it("reads the type from the first bytes, not from the name", () => {
    expect(sniffImage(JPEG)).toBe("image/jpeg");
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(PDF)).toBeNull();
  });
});

describe("saveTicketPhotos", () => {
  it("stores the files outside the web root and keeps the keys on the ticket", async () => {
    const keys = await saveTicketPhotos(ticketId, [
      { filename: "a.jpg", bytes: JPEG },
      { filename: "b.png", bytes: PNG },
    ]);
    expect(keys).toHaveLength(2);
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket.photos).toEqual(keys);
    // Файл лежит в каталоге заявки, а не в /public.
    expect(await readFile(join(root, ticketId, keys[0]))).toEqual(JPEG);
  });

  it("refuses a file that is not an image", async () => {
    await expect(
      saveTicketPhotos(ticketId, [{ filename: "paper.pdf", bytes: PDF }]),
    ).rejects.toBeInstanceOf(TicketPhotoError);
  });

  it("refuses an empty file", async () => {
    await expect(
      saveTicketPhotos(ticketId, [{ filename: "void.jpg", bytes: Buffer.alloc(0) }]),
    ).rejects.toBeInstanceOf(TicketPhotoError);
  });

  it("refuses a file over the size limit", async () => {
    const huge = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.alloc(MAX_TICKET_PHOTO_BYTES + 1),
    ]);
    await expect(
      saveTicketPhotos(ticketId, [{ filename: "huge.jpg", bytes: huge }]),
    ).rejects.toBeInstanceOf(TicketPhotoError);
  });

  it(`takes at most ${MAX_TICKET_PHOTOS}: it is a snapshot from the spot, not a gallery`, async () => {
    const one = { filename: "a.jpg", bytes: JPEG };
    await expect(
      saveTicketPhotos(ticketId, [one, one, one, one]),
    ).rejects.toBeInstanceOf(TicketPhotoError);
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    // Отказ не оставляет половины: ни одного ключа на заявке.
    expect(ticket.photos).toEqual([]);
  });

  it("counts what the ticket already carries", async () => {
    await saveTicketPhotos(ticketId, [
      { filename: "a.jpg", bytes: JPEG },
      { filename: "b.jpg", bytes: JPEG },
    ]);
    await expect(
      saveTicketPhotos(ticketId, [
        { filename: "c.jpg", bytes: JPEG },
        { filename: "d.jpg", bytes: JPEG },
      ]),
    ).rejects.toBeInstanceOf(TicketPhotoError);
  });
});

describe("readTicketPhoto", () => {
  it("finds the file and the ticket it belongs to", async () => {
    const [key] = await saveTicketPhotos(ticketId, [{ filename: "a.jpg", bytes: JPEG }]);
    const found = await readTicketPhoto(key);
    expect(found?.ticketId).toBe(ticketId);
    expect(found?.contentType).toBe("image/jpeg");
    expect(found?.bytes).toEqual(JPEG);
  });

  it("answers null for a key nobody owns", async () => {
    expect(await readTicketPhoto("deadbeefdeadbeefdeadbeef")).toBeNull();
  });

  it("answers null for a key that tries to leave the directory", async () => {
    expect(await readTicketPhoto("../../etc/passwd")).toBeNull();
  });
});
