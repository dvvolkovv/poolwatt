// Where a partner's banners and videos live — ТЗ §41 "Типы контента: баннер,
// видео (до 60 секунд), фото-галерея…".
//
// The same arrangement as the listing documents (`exchange/listing-docs.ts`):
// files on disk outside the web root, served by a route that decides who may
// see them, and a declared Content-Type that is never trusted — the type comes
// from the file's own first bytes. An uploader who calls an SVG a PNG gets a
// refusal, not a script running on our page.

import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { mp4DurationMs } from "./mp4-duration";

export class MediaError extends Error {}

/** A banner or a gallery photo. Generous for a photo, small for a page. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Sixty seconds of phone video, at a bitrate nobody will complain about. */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
/** §41 — "видео (до 60 секунд)". */
export const MAX_VIDEO_MS = 60_000;

export type MediaMime = "image/jpeg" | "image/png" | "image/webp" | "video/mp4";

export interface SavedMedia {
  storageKey: string;
  mime: MediaMime;
  sizeBytes: number;
  /** Milliseconds for a video, null for a still. */
  durationMs: number | null;
}

/**
 * Where the files live. Relative by default, which `fs` resolves against the
 * process directory — spelling it with `process.cwd()` makes Turbopack's
 * tracer give up and pull the whole project into the build's file list.
 */
export function mediaRoot(): string {
  return process.env.MARKETING_MEDIA_DIR || "var/marketing-media";
}

/** The magic numbers of the types §41 allows. */
export function sniffMediaMime(bytes: Buffer): MediaMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  // RIFF carries WAV and AVI too; only the WEBP form is an image.
  if (
    bytes.length >= 12 &&
    bytes.toString("latin1", 0, 4) === "RIFF" &&
    bytes.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  // An MP4 starts with an `ftyp` box; the brand inside it varies too much to
  // enumerate, so the box itself is the signal.
  if (bytes.length >= 12 && bytes.toString("latin1", 4, 8) === "ftyp") {
    return "video/mp4";
  }
  return null;
}

export function isVideo(mime: string): boolean {
  return mime === "video/mp4";
}

const MB = (n: number) => Math.round(n / 1024 / 1024);

/**
 * What this upload is, and whether §41 allows it. Throws rather than returning
 * a reason code: every caller refuses the file, and the message is what the
 * partner reads in the cabinet.
 */
export function inspectMedia(bytes: Buffer): { mime: MediaMime; durationMs: number | null } {
  if (bytes.length === 0) throw new MediaError("The file is empty");

  const mime = sniffMediaMime(bytes);
  if (!mime) throw new MediaError("Only JPEG, PNG, WebP images and MP4 video are accepted");

  if (isVideo(mime)) {
    if (bytes.length > MAX_VIDEO_BYTES) {
      throw new MediaError(`The video is ${MB(bytes.length)} MB, over the ${MB(MAX_VIDEO_BYTES)} MB limit`);
    }
    const durationMs = mp4DurationMs(bytes);
    // Not a formality: §41 promises sixty seconds, and we cannot promise it
    // about a file whose length we failed to read.
    if (durationMs == null) {
      throw new MediaError("The video's length could not be read from the file");
    }
    if (durationMs > MAX_VIDEO_MS) {
      throw new MediaError(
        `The video runs ${Math.round(durationMs / 1000)} s, over the ${MAX_VIDEO_MS / 1000} s limit`,
      );
    }
    return { mime, durationMs };
  }

  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new MediaError(`The image is ${MB(bytes.length)} MB, over the ${MB(MAX_IMAGE_BYTES)} MB limit`);
  }
  return { mime, durationMs: null };
}

function safeSegment(value: string): boolean {
  return value.length > 0 && value.length <= 64 && /^[A-Za-z0-9_-]+$/.test(value);
}

/** A key is `<operatorId>/<random>`; both halves are checked, never trusted. */
function keyPath(storageKey: string): string | null {
  const parts = storageKey.split("/");
  if (parts.length !== 2) return null;
  if (!parts.every(safeSegment)) return null;
  const path = join(mediaRoot(), parts[0], parts[1]);
  const root = resolve(mediaRoot());
  if (!resolve(path).startsWith(root + sep)) return null;
  return path;
}

export async function saveMedia(args: {
  operatorId: string;
  bytes: Buffer;
}): Promise<SavedMedia> {
  const { mime, durationMs } = inspectMedia(args.bytes);
  if (!safeSegment(args.operatorId)) throw new MediaError("Bad operator id");

  const name = randomBytes(12).toString("hex");
  const dir = join(mediaRoot(), args.operatorId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), args.bytes, { mode: 0o600 });

  return {
    storageKey: `${args.operatorId}/${name}`,
    mime,
    sizeBytes: args.bytes.length,
    durationMs,
  };
}

export async function readMedia(
  storageKey: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
  const path = keyPath(storageKey);
  if (!path) return null;
  try {
    const bytes = await readFile(path);
    return { bytes, mime: sniffMediaMime(bytes) ?? "application/octet-stream" };
  } catch {
    return null;
  }
}

export async function deleteMedia(storageKey: string): Promise<boolean> {
  const path = keyPath(storageKey);
  if (!path) return false;
  try {
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}
