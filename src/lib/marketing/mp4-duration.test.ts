import { describe, expect, it } from "vitest";
import { mp4DurationMs } from "./mp4-duration";

/** An MP4 box: 4-byte big-endian size, 4-byte type, payload. */
function box(type: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(payload.length + 8, 0);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, payload]);
}

/** `mvhd` version 0: 32-bit creation/modification, timescale, duration. */
function mvhd0(timescale: number, duration: number): Buffer {
  const p = Buffer.alloc(100);
  p.writeUInt8(0, 0); // version
  p.writeUInt32BE(0, 4); // creation time
  p.writeUInt32BE(0, 8); // modification time
  p.writeUInt32BE(timescale, 12);
  p.writeUInt32BE(duration, 16);
  return box("mvhd", p);
}

/** `mvhd` version 1: 64-bit creation/modification and duration. */
function mvhd1(timescale: number, duration: number): Buffer {
  const p = Buffer.alloc(112);
  p.writeUInt8(1, 0);
  p.writeBigUInt64BE(BigInt(0), 4); // creation
  p.writeBigUInt64BE(BigInt(0), 12); // modification
  p.writeUInt32BE(timescale, 20);
  p.writeBigUInt64BE(BigInt(duration), 24);
  return box("mvhd", p);
}

const ftyp = box("ftyp", Buffer.from("isommp42", "latin1"));

describe("mp4DurationMs", () => {
  it("reads a version 0 movie header", () => {
    const file = Buffer.concat([ftyp, box("moov", mvhd0(1000, 42_000))]);
    expect(mp4DurationMs(file)).toBe(42_000);
  });

  it("converts from the file's own timescale", () => {
    // 90 kHz clock, 3 seconds.
    const file = Buffer.concat([ftyp, box("moov", mvhd0(90_000, 270_000))]);
    expect(mp4DurationMs(file)).toBe(3_000);
  });

  it("reads a version 1 movie header with 64-bit fields", () => {
    const file = Buffer.concat([ftyp, box("moov", mvhd1(600, 36_000))]);
    expect(mp4DurationMs(file)).toBe(60_000);
  });

  it("finds mvhd when other boxes sit before it inside moov", () => {
    const filler = box("free", Buffer.alloc(16));
    const file = Buffer.concat([ftyp, box("moov", Buffer.concat([filler, mvhd0(1000, 5_500)]))]);
    expect(mp4DurationMs(file)).toBe(5_500);
  });

  it("returns null when there is no moov box", () => {
    const file = Buffer.concat([ftyp, box("mdat", Buffer.alloc(32))]);
    expect(mp4DurationMs(file)).toBeNull();
  });

  it("returns null for something that is not an MP4 at all", () => {
    expect(mp4DurationMs(Buffer.from("not a movie"))).toBeNull();
  });

  it("returns null when the timescale is zero", () => {
    const file = Buffer.concat([ftyp, box("moov", mvhd0(0, 42_000))]);
    expect(mp4DurationMs(file)).toBeNull();
  });

  it("walks past a box that declares the 64-bit extended size", () => {
    // size == 1 means the real size follows the type as a 64-bit number.
    const payload = Buffer.alloc(24);
    const head = Buffer.alloc(16);
    head.writeUInt32BE(1, 0);
    head.write("mdat", 4, "latin1");
    head.writeBigUInt64BE(BigInt(payload.length + 16), 8);
    const big = Buffer.concat([head, payload]);
    const file = Buffer.concat([ftyp, big, box("moov", mvhd0(1000, 7_000))]);
    expect(mp4DurationMs(file)).toBe(7_000);
  });

  it("stops instead of looping when a box declares a size of zero inside a parent", () => {
    // size 0 means "to the end of the file"; nothing can follow it.
    const head = Buffer.alloc(8);
    head.writeUInt32BE(0, 0);
    head.write("mdat", 4, "latin1");
    const file = Buffer.concat([ftyp, head, Buffer.alloc(16)]);
    expect(mp4DurationMs(file)).toBeNull();
  });

  it("returns null for a truncated moov box", () => {
    const moov = box("moov", mvhd0(1000, 42_000));
    expect(mp4DurationMs(moov.subarray(0, 20))).toBeNull();
  });
});
