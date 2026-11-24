// Document storage for listing applications — ТЗ §4, US-01 ("загрузка PDF/JPG
// до 20 МБ"), US-02 ("просмотр документов").
//
// These are KYB papers: registration certificates, licences, grid contracts.
// They must not sit in /public, so they live on disk outside the web root and
// are streamed by an authenticated route. The declared Content-Type is not
// trusted — the type comes from the file's own first bytes.

import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";

/** US-01: PDF/JPG up to 20 MB. */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

export class DocumentError extends Error {}

/** One entry of ListingApplication.documents (Json). */
export interface StoredDocument {
  docId: string;
  name: string;
  url: string;
  bytes: number;
  mime: string;
  uploadedAt: string;
}

/**
 * Where the files live. Relative by default, which `fs` resolves against the
 * process directory — spelling it with `process.cwd()` makes Turbopack's
 * tracer give up and pull the whole project into the build's file list.
 */
export function docsRoot(): string {
  return process.env.LISTING_DOCS_DIR || "var/listing-docs";
}

/** The magic numbers of the three types US-01 allows. */
export function sniffMime(bytes: Buffer): string | null {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-") {
    return "application/pdf";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  return null;
}

const EXTENSION: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

/**
 * Absolute path of one document. Ids are generated here and never contain a
 * separator, so a value carrying one (or `..`) came from a URL and is refused
 * by `safeSegment` before it reaches the filesystem.
 */
export function documentPath(applicationId: string, docId: string): string {
  return join(docsRoot(), applicationId, docId);
}

function safeSegment(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 64 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function withinRoot(path: string): boolean {
  const root = resolve(docsRoot());
  return resolve(path).startsWith(root + sep);
}

export async function storeDocument(args: {
  applicationId: string;
  filename: string;
  bytes: Buffer;
}): Promise<StoredDocument> {
  if (args.bytes.length === 0) throw new DocumentError("The file is empty");
  if (args.bytes.length > MAX_DOCUMENT_BYTES) {
    throw new DocumentError(
      `The file is ${Math.round(args.bytes.length / 1024 / 1024)} MB, over the 20 MB limit`,
    );
  }
  const mime = sniffMime(args.bytes);
  if (!mime) throw new DocumentError("Only PDF, JPEG and PNG files are accepted");
  if (!safeSegment(args.applicationId)) throw new DocumentError("Bad application id");

  // The shown name keeps the user's wording but never a path.
  const name = basename(args.filename).replace(/[\u0000-\u001f]/g, "").slice(0, 160) || `file.${EXTENSION[mime]}`;
  const docId = randomBytes(12).toString("hex");

  const dir = join(docsRoot(), args.applicationId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, docId), args.bytes, { mode: 0o600 });

  return {
    docId,
    name,
    url: `/api/v1/listing-applications/${args.applicationId}/documents/${docId}`,
    bytes: args.bytes.length,
    mime,
    uploadedAt: new Date().toISOString(),
  };
}

export async function readDocument(
  applicationId: string,
  docId: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
  if (!safeSegment(applicationId) || !safeSegment(docId)) return null;
  const path = documentPath(applicationId, docId);
  if (!withinRoot(path)) return null;
  try {
    const bytes = await readFile(path);
    return { bytes, mime: sniffMime(bytes) ?? "application/octet-stream" };
  } catch {
    return null;
  }
}

export async function deleteDocument(applicationId: string, docId: string): Promise<boolean> {
  if (!safeSegment(applicationId) || !safeSegment(docId)) return false;
  const path = documentPath(applicationId, docId);
  if (!withinRoot(path)) return false;
  try {
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}
