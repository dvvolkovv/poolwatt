import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatDocumentAck,
  sanitizeFilename,
  saveTelegramDocument,
} from "../documents";

describe("sanitizeFilename", () => {
  it("keeps a plain filename unchanged", () => {
    expect(sanitizeFilename("tz.pdf")).toBe("tz.pdf");
  });

  it("strips directory separators so a name cannot escape the inbox", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("etc_passwd");
  });

  it("replaces characters that break shell and fs handling", () => {
    expect(sanitizeFilename("ТЗ v2 (final).docx")).toBe("ТЗ_v2_final.docx");
  });

  it("falls back to a default when the name is empty after cleaning", () => {
    expect(sanitizeFilename("///")).toBe("document");
  });
});

describe("saveTelegramDocument", () => {
  let inbox: string;

  beforeEach(async () => {
    inbox = await mkdtemp(join(tmpdir(), "poolwatt-inbox-"));
  });

  afterEach(async () => {
    await rm(inbox, { recursive: true, force: true });
  });

  function fakeFetch(body: string) {
    return async (url: string | URL | Request): Promise<Response> => {
      const href = String(url);
      if (href.includes("/getFile")) {
        return new Response(
          JSON.stringify({ ok: true, result: { file_path: "documents/file_7.pdf" } }),
          { status: 200 },
        );
      }
      return new Response(body, { status: 200 });
    };
  }

  it("writes the downloaded bytes into the inbox directory", async () => {
    const saved = await saveTelegramDocument({
      fileId: "AgAD123",
      fileName: "tz.pdf",
      botToken: "TOKEN",
      inboxDir: inbox,
      fetchFn: fakeFetch("hello-tz"),
    });

    expect(saved.bytes).toBe(8);
    expect(saved.path.startsWith(inbox)).toBe(true);
    expect(await readFile(saved.path, "utf8")).toBe("hello-tz");
  });

  it("creates the inbox directory when it does not exist yet", async () => {
    const nested = join(inbox, "deep", "inbox");
    const saved = await saveTelegramDocument({
      fileId: "AgAD123",
      fileName: "tz.pdf",
      botToken: "TOKEN",
      inboxDir: nested,
      fetchFn: fakeFetch("x"),
    });

    expect(saved.path.startsWith(nested)).toBe(true);
    expect(await readdir(nested)).toHaveLength(1);
  });

  it("does not overwrite an earlier file with the same name", async () => {
    const first = await saveTelegramDocument({
      fileId: "A",
      fileName: "tz.pdf",
      botToken: "TOKEN",
      inboxDir: inbox,
      fetchFn: fakeFetch("first"),
    });
    const second = await saveTelegramDocument({
      fileId: "B",
      fileName: "tz.pdf",
      botToken: "TOKEN",
      inboxDir: inbox,
      fetchFn: fakeFetch("second"),
    });

    expect(second.path).not.toBe(first.path);
    expect(await readFile(first.path, "utf8")).toBe("first");
    expect(await readFile(second.path, "utf8")).toBe("second");
  });

  it("uses the Telegram file_path extension when Telegram sends no filename", async () => {
    const saved = await saveTelegramDocument({
      fileId: "AgAD123",
      fileName: undefined,
      botToken: "TOKEN",
      inboxDir: inbox,
      fetchFn: fakeFetch("x"),
    });

    expect(saved.path).toMatch(/\.pdf$/);
  });

  it("throws a readable error when getFile fails", async () => {
    const fetchFn = async (): Promise<Response> =>
      new Response(JSON.stringify({ ok: false, description: "file too big" }), {
        status: 200,
      });

    await expect(
      saveTelegramDocument({
        fileId: "AgAD123",
        fileName: "tz.pdf",
        botToken: "TOKEN",
        inboxDir: inbox,
        fetchFn,
      }),
    ).rejects.toThrow(/file too big/);
  });

  it("throws when the file download itself fails", async () => {
    const fetchFn = async (url: string | URL | Request): Promise<Response> => {
      if (String(url).includes("/getFile")) {
        return new Response(
          JSON.stringify({ ok: true, result: { file_path: "documents/file_7.pdf" } }),
          { status: 200 },
        );
      }
      return new Response("nope", { status: 404 });
    };

    await expect(
      saveTelegramDocument({
        fileId: "AgAD123",
        fileName: "tz.pdf",
        botToken: "TOKEN",
        inboxDir: inbox,
        fetchFn,
      }),
    ).rejects.toThrow(/404/);
  });
});

describe("formatDocumentAck", () => {
  it("reports the inbox-relative path and a human-readable size", () => {
    const msg = formatDocumentAck({
      sentName: "tz.pdf",
      savedName: "tz.pdf",
      relPath: "inbox/tz.pdf",
      bytes: 1_572_864,
    });

    expect(msg).toContain("inbox/tz.pdf");
    expect(msg).toContain("1.5 MB");
  });

  it("formats small files in KB", () => {
    const msg = formatDocumentAck({
      sentName: "tz.md",
      savedName: "tz.md",
      relPath: "inbox/tz.md",
      bytes: 4096,
    });

    expect(msg).toContain("4.0 KB");
    expect(msg).not.toContain("MB");
  });

  it("warns when the file had to be saved under a different name", () => {
    const msg = formatDocumentAck({
      sentName: "ТЗ v2 (final).docx",
      savedName: "ТЗ_v2_final-1.docx",
      relPath: "inbox/ТЗ_v2_final-1.docx",
      bytes: 2048,
    });

    expect(msg).toContain("ТЗ_v2_final-1.docx");
    expect(msg).toMatch(/переименовал|сохранил как/i);
  });

  it("stays silent about renaming when the name survived unchanged", () => {
    const msg = formatDocumentAck({
      sentName: "tz.pdf",
      savedName: "tz.pdf",
      relPath: "inbox/tz.pdf",
      bytes: 2048,
    });

    expect(msg).not.toMatch(/переименовал|сохранил как/i);
  });
});
