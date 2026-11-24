import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_DOCUMENT_BYTES,
  DocumentError,
  deleteDocument,
  documentPath,
  readDocument,
  sniffMime,
  storeDocument,
} from "./listing-docs";

const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "listing-docs-"));
  process.env.LISTING_DOCS_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.LISTING_DOCS_DIR;
});

describe("sniffMime — US-01 PDF/JPG only", () => {
  it("reads the type from the first bytes, not the browser's claim", () => {
    expect(sniffMime(PDF)).toBe("application/pdf");
    expect(sniffMime(JPEG)).toBe("image/jpeg");
    expect(sniffMime(PNG)).toBe("image/png");
  });

  it("refuses anything else, however it is labelled", () => {
    expect(sniffMime(ELF)).toBeNull();
    expect(sniffMime(Buffer.from("<html>"))).toBeNull();
    expect(sniffMime(Buffer.alloc(0))).toBeNull();
  });
});

describe("storeDocument", () => {
  it("writes the file and returns a descriptor the admin page can render", async () => {
    const doc = await storeDocument({
      applicationId: "app1",
      filename: "licence.pdf",
      bytes: PDF,
    });

    expect(doc.mime).toBe("application/pdf");
    expect(doc.bytes).toBe(PDF.length);
    expect(doc.name).toBe("licence.pdf");
    expect(doc.docId).toMatch(/^[a-z0-9]+$/i);
    expect(doc.url).toBe(`/api/v1/listing-applications/app1/documents/${doc.docId}`);

    const back = await readDocument("app1", doc.docId);
    expect(back?.bytes.equals(PDF)).toBe(true);
    expect(back?.mime).toBe("application/pdf");
  });

  it("refuses a file over the 20 MB limit of US-01", async () => {
    const big = Buffer.concat([PDF, Buffer.alloc(MAX_DOCUMENT_BYTES)]);
    await expect(
      storeDocument({ applicationId: "app1", filename: "big.pdf", bytes: big }),
    ).rejects.toThrow(DocumentError);
  });

  it("refuses an empty file", async () => {
    await expect(
      storeDocument({ applicationId: "app1", filename: "empty.pdf", bytes: Buffer.alloc(0) }),
    ).rejects.toThrow(DocumentError);
  });

  it("refuses a type outside PDF/JPEG/PNG", async () => {
    await expect(
      storeDocument({ applicationId: "app1", filename: "payload.pdf", bytes: ELF }),
    ).rejects.toThrow(DocumentError);
  });

  it("strips directories out of the shown name", async () => {
    const doc = await storeDocument({
      applicationId: "app1",
      filename: "../../etc/passwd.pdf",
      bytes: PDF,
    });
    expect(doc.name).toBe("passwd.pdf");
  });
});

describe("readDocument — path traversal", () => {
  it("never reads outside the application's own directory", async () => {
    writeFileSync(join(dir, "secret.pdf"), PDF);
    expect(await readDocument("app1", "../secret")).toBeNull();
    expect(await readDocument("../", "secret")).toBeNull();
    expect(await readDocument("app1", "a/b")).toBeNull();
  });

  it("returns null for an unknown id", async () => {
    expect(await readDocument("app1", "nosuchdoc")).toBeNull();
  });
});

describe("deleteDocument", () => {
  it("removes the file and is a no-op the second time", async () => {
    const doc = await storeDocument({
      applicationId: "app1",
      filename: "a.png",
      bytes: PNG,
    });
    expect(await deleteDocument("app1", doc.docId)).toBe(true);
    expect(await readDocument("app1", doc.docId)).toBeNull();
    expect(await deleteDocument("app1", doc.docId)).toBe(false);
  });
});

describe("documentPath", () => {
  it("keeps every application in its own directory", () => {
    expect(documentPath("app1", "d1")).toBe(join(dir, "app1", "d1"));
    expect(documentPath("app2", "d1")).toBe(join(dir, "app2", "d1"));
  });
});
