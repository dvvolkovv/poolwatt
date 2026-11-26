// §28 «Адрес и карта: … фото до 10 шт.». Таблица `PointPhoto` была в схеме с
// самого начала и до этого этапа стояла пустой — её ничто не заполняло.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import {
  MAX_PHOTOS,
  MAX_PHOTO_BYTES,
  PhotoError,
  deletePointPhoto,
  listPointPhotos,
  readPointPhoto,
  savePointPhoto,
  sniffImage,
} from "./point-photos";

const SLUG = "test_photos_net";

let pointId: string;
let dir: string;

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.from([0x40, 0, 0, 0]),
  Buffer.from("WEBP", "latin1"),
  Buffer.alloc(64, 7),
]);
const PDF = Buffer.concat([Buffer.from("%PDF-1.7", "latin1"), Buffer.alloc(64, 7)]);

async function wipe() {
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "poolwatt-photos-"));
  process.env.POINT_PHOTOS_DIR = dir;

  await wipe();
  const operator = await prisma.chargerOperator.create({
    data: { slug: SLUG, displayName: "Photo test net" },
  });
  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId: operator.id,
      type: "CHARGING_STATION",
      name: "Photo depot",
      status: "DRAFT",
      country: "SK",
      latitude: 50.51,
      longitude: 22.61,
      paymentMethods: ["TOKEN"],
    },
  });
  pointId = point.id;
});

beforeEach(async () => {
  await prisma.pointPhoto.deleteMany({ where: { pointId } });
});

afterAll(async () => {
  await wipe();
  await rm(dir, { recursive: true, force: true });
  delete process.env.POINT_PHOTOS_DIR;
});

describe("sniffImage", () => {
  it("knows the three types from their first bytes", () => {
    expect(sniffImage(JPEG)).toBe("image/jpeg");
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(WEBP)).toBe("image/webp");
  });

  it("does not take a file's word for what it is", () => {
    expect(sniffImage(PDF)).toBeNull();
    expect(sniffImage(Buffer.alloc(4))).toBeNull();
  });
});

describe("savePointPhoto", () => {
  it("stores the bytes outside the web root and a row beside them", async () => {
    const photo = await savePointPhoto({ pointId, filename: "front.jpg", bytes: JPEG });

    expect(photo.contentType).toBe("image/jpeg");
    expect(photo.sizeBytes).toBe(JPEG.length);
    const onDisk = await readFile(join(dir, pointId, photo.storageKey));
    expect(onDisk.equals(JPEG)).toBe(true);
    expect(await prisma.pointPhoto.count({ where: { pointId } })).toBe(1);
  });

  it("numbers the photos in the order they arrived", async () => {
    await savePointPhoto({ pointId, filename: "a.jpg", bytes: JPEG });
    await savePointPhoto({ pointId, filename: "b.png", bytes: PNG });

    const rows = await listPointPhotos(pointId);
    expect(rows.map((r) => r.position)).toEqual([0, 1]);
  });

  it("refuses a file that is not an image, whatever it is called", async () => {
    await expect(
      savePointPhoto({ pointId, filename: "front.jpg", bytes: PDF }),
    ).rejects.toThrow(PhotoError);
  });

  it("refuses an empty file and one over the limit", async () => {
    await expect(
      savePointPhoto({ pointId, filename: "empty.jpg", bytes: Buffer.alloc(0) }),
    ).rejects.toThrow(PhotoError);

    const huge = Buffer.concat([JPEG, Buffer.alloc(MAX_PHOTO_BYTES)]);
    await expect(
      savePointPhoto({ pointId, filename: "huge.jpg", bytes: huge }),
    ).rejects.toThrow(PhotoError);
  });

  it("stops at ten, because §28 says ten", async () => {
    for (let i = 0; i < MAX_PHOTOS; i += 1) {
      await savePointPhoto({ pointId, filename: `p${i}.jpg`, bytes: JPEG });
    }
    await expect(
      savePointPhoto({ pointId, filename: "eleventh.jpg", bytes: JPEG }),
    ).rejects.toThrow(PhotoError);
    expect(await prisma.pointPhoto.count({ where: { pointId } })).toBe(MAX_PHOTOS);
  });
});

describe("readPointPhoto", () => {
  it("brings back the bytes and their type", async () => {
    const photo = await savePointPhoto({ pointId, filename: "front.jpg", bytes: JPEG });
    const read = await readPointPhoto(photo.id);
    expect(read?.contentType).toBe("image/jpeg");
    expect(read?.bytes.equals(JPEG)).toBe(true);
    expect(read?.pointId).toBe(pointId);
  });

  it("refuses an id that carries a path instead of an id", async () => {
    expect(await readPointPhoto("../../../etc/passwd")).toBeNull();
    expect(await readPointPhoto("no-such-photo")).toBeNull();
  });
});

describe("deletePointPhoto", () => {
  it("removes the row and the file together", async () => {
    const photo = await savePointPhoto({ pointId, filename: "front.jpg", bytes: JPEG });
    expect(await deletePointPhoto(photo.id)).toBe(true);
    expect(await prisma.pointPhoto.count({ where: { pointId } })).toBe(0);
    expect(await readPointPhoto(photo.id)).toBeNull();
  });

  it("says no about a photo that is not there", async () => {
    expect(await deletePointPhoto("no-such-photo")).toBe(false);
  });
});
