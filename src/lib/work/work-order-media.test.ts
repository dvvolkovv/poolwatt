// §48 «фото до и после» и «подпись».

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  MAX_PHOTO_BYTES,
  MAX_STAGE_PHOTOS,
  WorkOrderMediaError,
  readWorkOrderMedia,
  readSitePhotos,
  readSignature,
  saveSitePhoto,
  saveSignature,
} from "./work-order-media";

const PREFIX = "test_womedia_";
const SLUG = `${PREFIX}net`;

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(32, 7)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 3),
]);

let operatorId: string;
let pointId: string;
let actorUserId: string;
let orderId: string;
let mediaRoot: string;

async function wipe() {
  await prisma.workOrderSignature.deleteMany({
    where: { workOrder: { operator: { slug: SLUG } } },
  });
  await prisma.workOrderPhoto.deleteMany({
    where: { workOrder: { operator: { slug: SLUG } } },
  });
  await prisma.workOrder.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await wipe();
  mediaRoot = await mkdtemp(join(tmpdir(), "poolwatt-wo-media-"));
  process.env.WORK_ORDER_MEDIA_DIR = mediaRoot;

  actorUserId = (
    await prisma.user.create({ data: { username: `${PREFIX}engineer`, passwordHash: "x" } })
  ).id;
  operatorId = (
    await prisma.chargerOperator.create({
      data: { slug: SLUG, displayName: "Media network" },
    })
  ).id;
  pointId = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "Media point" },
    })
  ).id;
});

afterAll(async () => {
  await wipe();
  await rm(mediaRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await prisma.workOrderSignature.deleteMany({ where: { workOrder: { operatorId } } });
  await prisma.workOrderPhoto.deleteMany({ where: { workOrder: { operatorId } } });
  await prisma.workOrder.deleteMany({ where: { operatorId } });
  orderId = (
    await prisma.workOrder.create({
      data: {
        operatorId,
        pointId,
        type: "REPAIR",
        status: "IN_PROGRESS",
        title: "Media order",
        description: "x",
      },
    })
  ).id;
});

describe("saveSitePhoto", () => {
  it("stores a photo under its stage and gives the bytes back by key", async () => {
    const saved = await saveSitePhoto(orderId, {
      stage: "BEFORE",
      filename: "before.jpg",
      bytes: JPEG,
      takenById: actorUserId,
    });
    expect(saved.stage).toBe("BEFORE");

    const found = await readWorkOrderMedia(saved.key);
    expect(found?.workOrderId).toBe(orderId);
    expect(found?.contentType).toBe("image/jpeg");
    expect(found?.bytes.equals(JPEG)).toBe(true);

    const strips = await readSitePhotos(orderId);
    expect(strips.before).toHaveLength(1);
    expect(strips.after).toHaveLength(0);
  });

  it("refuses something that is not an image", async () => {
    await expect(
      saveSitePhoto(orderId, {
        stage: "AFTER",
        filename: "notes.txt",
        bytes: Buffer.from("plain words"),
        takenById: actorUserId,
      }),
    ).rejects.toThrow(WorkOrderMediaError);
  });

  it("refuses a file over the limit", async () => {
    const huge = Buffer.concat([JPEG, Buffer.alloc(MAX_PHOTO_BYTES, 1)]);
    await expect(
      saveSitePhoto(orderId, {
        stage: "AFTER",
        filename: "huge.jpg",
        bytes: huge,
        takenById: actorUserId,
      }),
    ).rejects.toThrow(/MB/);
  });

  it("counts the limit per stage, not per order", async () => {
    for (let i = 0; i < MAX_STAGE_PHOTOS; i += 1) {
      await saveSitePhoto(orderId, {
        stage: "BEFORE",
        filename: `b${i}.jpg`,
        bytes: JPEG,
        takenById: actorUserId,
      });
    }
    await expect(
      saveSitePhoto(orderId, {
        stage: "BEFORE",
        filename: "one-too-many.jpg",
        bytes: JPEG,
        takenById: actorUserId,
      }),
    ).rejects.toThrow(WorkOrderMediaError);

    // «После» — другая ступень, у неё свой счёт.
    const after = await saveSitePhoto(orderId, {
      stage: "AFTER",
      filename: "a0.jpg",
      bytes: JPEG,
      takenById: actorUserId,
    });
    expect(after.stage).toBe("AFTER");
  });

  it("refuses an order that does not exist", async () => {
    await expect(
      saveSitePhoto("nope", {
        stage: "BEFORE",
        filename: "b.jpg",
        bytes: JPEG,
        takenById: actorUserId,
      }),
    ).rejects.toThrow(WorkOrderMediaError);
  });
});

describe("saveSignature", () => {
  it("stores the stroke, the name and who signed", async () => {
    const signature = await saveSignature(orderId, {
      signerKind: "SITE_CONTACT",
      signerName: "Jana Horváthová",
      bytes: PNG,
      signedById: actorUserId,
    });
    expect(signature.signerName).toBe("Jana Horváthová");

    const read = await readSignature(orderId);
    expect(read?.signerKind).toBe("SITE_CONTACT");
    const bytes = await readWorkOrderMedia(signature.key);
    expect(bytes?.contentType).toBe("image/png");
  });

  it("an engineer signing for themselves is recorded as exactly that", async () => {
    const signature = await saveSignature(orderId, {
      signerKind: "ENGINEER",
      signerName: "Peter Novák",
      bytes: PNG,
      signedById: actorUserId,
    });
    expect(signature.signerKind).toBe("ENGINEER");
  });

  it("a signature needs a name", async () => {
    await expect(
      saveSignature(orderId, {
        signerKind: "ENGINEER",
        signerName: "  ",
        bytes: PNG,
        signedById: actorUserId,
      }),
    ).rejects.toThrow(WorkOrderMediaError);
  });

  it("a second signature replaces the first and the journal keeps both", async () => {
    const first = await saveSignature(orderId, {
      signerKind: "ENGINEER",
      signerName: "Peter Novák",
      bytes: PNG,
      signedById: actorUserId,
    });
    const second = await saveSignature(orderId, {
      signerKind: "SITE_CONTACT",
      signerName: "Jana Horváthová",
      bytes: PNG,
      signedById: actorUserId,
    });
    expect(second.key).not.toBe(first.key);

    expect(await prisma.workOrderSignature.count({ where: { workOrderId: orderId } })).toBe(1);
    const audit = await prisma.auditLog.findFirst({
      where: { entity: "WorkOrder", entityId: orderId, action: "workorder.signed" },
      orderBy: { at: "desc" },
    });
    expect(audit).not.toBeNull();
  });

  it("two simultaneous signatures leave exactly one", async () => {
    const results = await Promise.allSettled([
      saveSignature(orderId, {
        signerKind: "ENGINEER",
        signerName: "A",
        bytes: PNG,
        signedById: actorUserId,
      }),
      saveSignature(orderId, {
        signerKind: "ENGINEER",
        signerName: "B",
        bytes: PNG,
        signedById: actorUserId,
      }),
    ]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect(await prisma.workOrderSignature.count({ where: { workOrderId: orderId } })).toBe(1);
  });
});

describe("readWorkOrderMedia", () => {
  it("a key nobody issued is null, not a throw", async () => {
    expect(await readWorkOrderMedia("deadbeef")).toBeNull();
    expect(await readWorkOrderMedia("../../etc/passwd")).toBeNull();
  });
});
