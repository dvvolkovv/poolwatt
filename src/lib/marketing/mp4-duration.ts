// How long an MP4 runs, read out of the file itself — ТЗ §41 "видео (до 60
// секунд)".
//
// There is no ffprobe on this server and pulling in a transcoder to answer one
// number would be a strange trade. An MP4 already carries the answer: the
// `moov` box holds a movie header (`mvhd`) with a timescale and a duration in
// those units. That is a few dozen lines of box walking.
//
// A file whose header cannot be read gets `null`, and the caller refuses it:
// we cannot promise §41's sixty seconds about a video we were unable to
// measure.

/** The smallest box is a size and a type. */
const HEADER_BYTES = 8;

interface Box {
  type: string;
  /** Payload, without the header. */
  body: Buffer;
  /** Where the next sibling starts, relative to the slice we were given. */
  next: number;
}

/**
 * Read one box at `offset`, or null when the bytes there cannot be a box.
 *
 * Two sizes are special: 1 means the real size is the 64 bits that follow the
 * type, and 0 means "everything to the end of this container" — nothing can
 * follow such a box, so `next` lands exactly at the end.
 */
function readBox(buf: Buffer, offset: number): Box | null {
  if (offset + HEADER_BYTES > buf.length) return null;

  const declared = buf.readUInt32BE(offset);
  const type = buf.toString("latin1", offset + 4, offset + 8);
  let headerBytes = HEADER_BYTES;
  let size = declared;

  if (declared === 1) {
    if (offset + 16 > buf.length) return null;
    const big = buf.readBigUInt64BE(offset + 8);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(big);
    headerBytes = 16;
  } else if (declared === 0) {
    size = buf.length - offset;
  }

  if (size < headerBytes) return null;
  const end = Math.min(offset + size, buf.length);
  if (offset + headerBytes > end) return null;

  return {
    type,
    body: buf.subarray(offset + headerBytes, end),
    next: offset + size,
  };
}

/** Walk the boxes of one container, in order. */
function* boxes(buf: Buffer): Generator<Box> {
  let offset = 0;
  while (offset + HEADER_BYTES <= buf.length) {
    const box = readBox(buf, offset);
    if (!box) return;
    yield box;
    // A zero or malformed size would walk in place forever.
    if (box.next <= offset) return;
    offset = box.next;
  }
}

function findBox(buf: Buffer, type: string): Buffer | null {
  for (const box of boxes(buf)) {
    if (box.type === type) return box.body;
  }
  return null;
}

/**
 * Duration in milliseconds, or null when the file does not say.
 *
 * Only the top level and `moov` are searched: the movie header is always a
 * direct child of `moov`, and an MP4 that hides it elsewhere is not one we
 * want to accept anyway.
 */
export function mp4DurationMs(file: Buffer): number | null {
  const moov = findBox(file, "moov");
  if (!moov) return null;
  const mvhd = findBox(moov, "mvhd");
  if (!mvhd || mvhd.length < 1) return null;

  const version = mvhd.readUInt8(0);
  let timescale: number;
  let duration: number;

  if (version === 1) {
    // version(1) flags(3) created(8) modified(8) timescale(4) duration(8)
    if (mvhd.length < 32) return null;
    timescale = mvhd.readUInt32BE(20);
    const d = mvhd.readBigUInt64BE(24);
    if (d > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    duration = Number(d);
  } else {
    // version(1) flags(3) created(4) modified(4) timescale(4) duration(4)
    if (mvhd.length < 20) return null;
    timescale = mvhd.readUInt32BE(12);
    duration = mvhd.readUInt32BE(16);
  }

  if (!(timescale > 0) || !Number.isFinite(duration)) return null;
  // §41's "sixty seconds" is not a place for sub-millisecond truth.
  return Math.round((duration / timescale) * 1000);
}
