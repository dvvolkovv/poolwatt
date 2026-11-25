// §48 "документы" on a lead — a lease, a grid agreement, a planning consent.
//
// The same arrangement as the KYB papers of §4: bytes on disk outside the web
// root, the type taken from the file's own first bytes, and a route that
// decides who may read them. These are contracts, not pictures for a page.

import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { MAX_DOCUMENT_BYTES, sniffMime } from "@/lib/exchange/listing-docs";

export class LeadDocError extends Error {}

/** Where the files live. Relative, for the reason `listing-docs` explains. */
export function leadDocsRoot(): string {
  return process.env.LEAD_DOCS_DIR || "var/lead-docs";
}

function safeSegment(value: string): boolean {
  return value.length > 0 && value.length <= 64 && /^[A-Za-z0-9_-]+$/.test(value);
}

function keyPath(storageKey: string): string | null {
  const parts = storageKey.split("/");
  if (parts.length !== 2 || !parts.every(safeSegment)) return null;
  const path = join(leadDocsRoot(), parts[0], parts[1]);
  const root = resolve(leadDocsRoot());
  return resolve(path).startsWith(root + sep) ? path : null;
}

export interface SavedLeadDoc {
  storageKey: string;
  name: string;
  contentType: string;
  sizeBytes: number;
}

export async function saveLeadDoc(args: {
  leadId: string;
  filename: string;
  bytes: Buffer;
}): Promise<SavedLeadDoc> {
  if (args.bytes.length === 0) throw new LeadDocError("The file is empty");
  if (args.bytes.length > MAX_DOCUMENT_BYTES) {
    throw new LeadDocError(
      `The file is ${Math.round(args.bytes.length / 1024 / 1024)} MB, over the 20 MB limit`,
    );
  }
  const mime = sniffMime(args.bytes);
  if (!mime) throw new LeadDocError("Only PDF, JPEG and PNG files are accepted");
  if (!safeSegment(args.leadId)) throw new LeadDocError("Bad lead id");

  const name =
    basename(args.filename).replace(/[\u0000-\u001f]/g, "").slice(0, 160) || "document";
  const file = randomBytes(12).toString("hex");

  const dir = join(leadDocsRoot(), args.leadId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, file), args.bytes, { mode: 0o600 });

  return {
    storageKey: `${args.leadId}/${file}`,
    name,
    contentType: mime,
    sizeBytes: args.bytes.length,
  };
}

export async function readLeadDoc(
  storageKey: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
  const path = keyPath(storageKey);
  if (!path) return null;
  try {
    const bytes = await readFile(path);
    return { bytes, mime: sniffMime(bytes) ?? "application/octet-stream" };
  } catch {
    return null;
  }
}

export async function deleteLeadDoc(storageKey: string): Promise<boolean> {
  const path = keyPath(storageKey);
  if (!path) return false;
  try {
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}
