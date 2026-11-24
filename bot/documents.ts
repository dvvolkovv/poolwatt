import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

/**
 * Make a Telegram-supplied filename safe to write inside the inbox.
 *
 * Telegram passes `file_name` straight from the sender's device, so it may
 * contain path separators, shell metacharacters or nothing usable at all.
 * Cyrillic is kept — the user names specs in Russian ("ТЗ v2.docx").
 */
export function sanitizeFilename(raw: string): string {
  const cleaned = raw
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("_")
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}._-]/gu, "");
  return cleaned || "document";
}

export interface SaveDocumentOptions {
  fileId: string;
  /** Telegram's `file_name`; absent for some clients and for pasted files. */
  fileName: string | undefined;
  botToken: string;
  inboxDir: string;
  fetchFn?: typeof fetch;
}

export interface SavedDocument {
  path: string;
  bytes: number;
}

/**
 * Download a Telegram document into `inboxDir` and return where it landed.
 *
 * Never overwrites: a repeat upload of the same name gets a `-1`, `-2`, …
 * suffix, so an accidental re-send can't destroy the earlier revision.
 */
export async function saveTelegramDocument(
  opts: SaveDocumentOptions,
): Promise<SavedDocument> {
  const fetchFn = opts.fetchFn ?? fetch;

  const metaRes = await fetchFn(
    `https://api.telegram.org/bot${opts.botToken}/getFile?file_id=${encodeURIComponent(opts.fileId)}`,
  );
  const meta = (await metaRes.json()) as {
    ok: boolean;
    description?: string;
    result?: { file_path: string };
  };
  if (!meta.ok || !meta.result) {
    throw new Error(
      `Telegram getFile failed: ${meta.description ?? "unknown error"}`,
    );
  }

  const filePath = meta.result.file_path;
  const fileRes = await fetchFn(
    `https://api.telegram.org/file/bot${opts.botToken}/${filePath}`,
  );
  if (!fileRes.ok) {
    throw new Error(`Telegram file download failed (${fileRes.status})`);
  }
  const buffer = Buffer.from(await fileRes.arrayBuffer());

  // Fall back to the server-side path's basename, which carries a usable
  // extension ("documents/file_7.pdf") even when the client sent no name.
  const base = sanitizeFilename(
    opts.fileName ?? filePath.split("/").pop() ?? "document",
  );

  await mkdir(opts.inboxDir, { recursive: true });

  const ext = extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  for (let n = 0; ; n++) {
    const candidate = join(opts.inboxDir, n === 0 ? base : `${stem}-${n}${ext}`);
    try {
      await writeFile(candidate, buffer, { flag: "wx" });
      return { path: candidate, bytes: buffer.byteLength };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
}

export interface DocumentAck {
  /** Name as Telegram delivered it. */
  sentName: string;
  /** Name actually written to disk (sanitized, possibly de-duplicated). */
  savedName: string;
  /** Path shown to the user, relative to the checkout root. */
  relPath: string;
  bytes: number;
}

function formatBytes(bytes: number): string {
  const mb = bytes / 1_048_576;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** User-facing confirmation that a document landed in the inbox. */
export function formatDocumentAck(ack: DocumentAck): string {
  const lines = [`📄 Принял: ${ack.relPath} (${formatBytes(ack.bytes)})`];
  if (ack.savedName !== ack.sentName) {
    lines.push(`Сохранил как «${ack.savedName}» — исходное имя небезопасно для файловой системы.`);
  }
  lines.push("Напиши, что с этим делать, когда отправишь все файлы.");
  return lines.join("\n");
}
