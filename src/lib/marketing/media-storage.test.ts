import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_MS,
  MediaError,
  deleteMedia,
  inspectMedia,
  readMedia,
  saveMedia,
  sniffMediaMime,
} from "./media-storage";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "poolwatt-marketing-"));
  process.env.MARKETING_MEDIA_DIR = dir;
});

afterAll(async () => {
  delete process.env.MARKETING_MEDIA_DIR;
  await rm(dir, { recursive: true, force: true });
});

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.from([0x20, 0x00, 0x00, 0x00]),
  Buffer.from("WEBPVP8 ", "latin1"),
]);

function box(type: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(payload.length + 8, 0);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, payload]);
}

function mp4(durationMs: number, padTo = 0): Buffer {
  const p = Buffer.alloc(100);
  p.writeUInt32BE(1000, 12);
  p.writeUInt32BE(durationMs, 16);
  const ftyp = box("ftyp", Buffer.from("isommp42", "latin1"));
  const file = Buffer.concat([ftyp, box("moov", box("mvhd", p))]);
  if (padTo > file.length) {
    return Buffer.concat([file, box("mdat", Buffer.alloc(padTo - file.length - 8))]);
  }
  return file;
}

describe("sniffMediaMime", () => {
  it("knows the four types §41 allows", () => {
    expect(sniffMediaMime(JPEG)).toBe("image/jpeg");
    expect(sniffMediaMime(PNG)).toBe("image/png");
    expect(sniffMediaMime(WEBP)).toBe("image/webp");
    expect(sniffMediaMime(mp4(1000))).toBe("video/mp4");
  });

  it("refuses anything else, whatever the upload called it", () => {
    expect(sniffMediaMime(Buffer.from("%PDF-1.7"))).toBeNull();
    expect(sniffMediaMime(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffMediaMime(Buffer.alloc(0))).toBeNull();
  });

  it("does not take a RIFF container that is not WebP", () => {
    const wav = Buffer.concat([
      Buffer.from("RIFF", "latin1"),
      Buffer.from([0x20, 0x00, 0x00, 0x00]),
      Buffer.from("WAVEfmt ", "latin1"),
    ]);
    expect(sniffMediaMime(wav)).toBeNull();
  });
});

describe("inspectMedia", () => {
  it("accepts an image and reports no duration", () => {
    expect(inspectMedia(JPEG)).toEqual({ mime: "image/jpeg", durationMs: null });
  });

  it("accepts a video inside the sixty seconds of §41", () => {
    expect(inspectMedia(mp4(59_000))).toEqual({ mime: "video/mp4", durationMs: 59_000 });
  });

  it("refuses a video over sixty seconds", () => {
    expect(() => inspectMedia(mp4(MAX_VIDEO_MS + 1_000))).toThrow(MediaError);
  });

  it("refuses a video whose length cannot be read", () => {
    const headless = Buffer.concat([
      box("ftyp", Buffer.from("isommp42", "latin1")),
      box("mdat", Buffer.alloc(16)),
    ]);
    expect(() => inspectMedia(headless)).toThrow(/length/i);
  });

  it("refuses an image over the size limit", () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(MAX_IMAGE_BYTES)]);
    expect(() => inspectMedia(big)).toThrow(/MB/);
  });

  it("refuses a video over the size limit", () => {
    const big = mp4(10_000, MAX_VIDEO_BYTES + 1_000);
    expect(() => inspectMedia(big)).toThrow(/MB/);
  });

  it("refuses an empty file", () => {
    expect(() => inspectMedia(Buffer.alloc(0))).toThrow(MediaError);
  });
});

describe("saveMedia / readMedia / deleteMedia", () => {
  it("round-trips the bytes", async () => {
    const saved = await saveMedia({ operatorId: "op-1", bytes: PNG });
    expect(saved.mime).toBe("image/png");
    expect(saved.sizeBytes).toBe(PNG.length);
    const read = await readMedia(saved.storageKey);
    expect(read).not.toBeNull();
    expect(read!.bytes.equals(PNG)).toBe(true);
  });

  it("gives every file its own key", async () => {
    const a = await saveMedia({ operatorId: "op-1", bytes: PNG });
    const b = await saveMedia({ operatorId: "op-1", bytes: PNG });
    expect(a.storageKey).not.toBe(b.storageKey);
  });

  it("deletes", async () => {
    const saved = await saveMedia({ operatorId: "op-2", bytes: JPEG });
    expect(await deleteMedia(saved.storageKey)).toBe(true);
    expect(await readMedia(saved.storageKey)).toBeNull();
  });

  it("will not read its way out of the media root", async () => {
    expect(await readMedia("../../../etc/passwd")).toBeNull();
    expect(await readMedia("op-1/../../etc/passwd")).toBeNull();
    expect(await deleteMedia("../../etc/passwd")).toBe(false);
  });

  it("refuses an operator id that is not an id", async () => {
    await expect(saveMedia({ operatorId: "../escape", bytes: PNG })).rejects.toThrow(MediaError);
  });
});
