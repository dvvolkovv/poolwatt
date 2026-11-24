"use client";

// US-01 — "загрузка PDF/JPG до 20 МБ" plus the submit that puts the
// application in front of the operator.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ListingDocument } from "@/lib/exchange/listing-service";
import { dropDocument, sendApplication, uploadDocument } from "@/app/[locale]/me/listing/actions";

const MAX_BYTES = 20 * 1024 * 1024;

export type DocumentsPanelLabels = {
  documents: string;
  documentsHelp: string;
  noDocuments: string;
  upload: string;
  uploading: string;
  remove: string;
  submit: string;
  submitting: string;
  needDocuments: string;
};

export function DocumentsPanel({
  companyId,
  initial,
  editable,
  labels,
}: {
  companyId: string;
  initial: ListingDocument[];
  editable: boolean;
  labels: DocumentsPanelLabels;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<ListingDocument[]>(initial);
  const [busy, setBusy] = useState<"upload" | "submit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function onPick(file: File | undefined) {
    if (!file) return;
    setError(null);
    // Caught here as well as on the server so a 20 MB refusal does not cost
    // the producer the upload time first.
    if (file.size > MAX_BYTES) {
      setError(`${Math.round(file.size / 1024 / 1024)} MB > 20 MB`);
      if (input.current) input.current.value = "";
      return;
    }
    setBusy("upload");
    const result = await uploadDocument(companyId, file);
    setBusy(null);
    if (input.current) input.current.value = "";
    if (!result.ok) {
      setError(result.formError ?? "Upload failed.");
      return;
    }
    setDocuments(result.documents ?? []);
  }

  async function onRemove(docId: string) {
    setError(null);
    setBusy("upload");
    const result = await dropDocument(companyId, docId);
    setBusy(null);
    if (!result.ok) {
      setError(result.formError ?? "Removal failed.");
      return;
    }
    setDocuments(result.documents ?? []);
  }

  async function onSubmit() {
    setError(null);
    if (documents.length === 0) {
      setError(labels.needDocuments);
      return;
    }
    setBusy("submit");
    const result = await sendApplication(companyId);
    setBusy(null);
    if (!result.ok) {
      setError(result.formError ?? "Submit failed.");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <section>
      <h2 className="mb-1 text-[13px] uppercase tracking-[0.14em] text-muted">
        {labels.documents}
      </h2>
      <p className="mb-4 max-w-[70ch] text-[13px] text-muted">{labels.documentsHelp}</p>

      {documents.length === 0 ? (
        <p className="mb-4 text-sm text-muted">{labels.noDocuments}</p>
      ) : (
        <ul className="mb-4 text-sm">
          {documents.map((d, i) => (
            <li
              key={d.docId ?? `${d.url}-${i}`}
              className="flex items-center justify-between gap-4 border-b border-hairline py-2"
            >
              <a href={d.url} target="_blank" rel="noopener noreferrer" className="underline">
                {d.name}
              </a>
              <span className="flex items-center gap-4">
                <span className="num text-[12px] text-muted">
                  {d.mime.replace("application/", "").replace("image/", "")} ·{" "}
                  {Math.max(1, Math.round(d.bytes / 1024))} KB
                </span>
                {editable && d.docId && (
                  <button
                    type="button"
                    onClick={() => onRemove(d.docId!)}
                    disabled={busy !== null}
                    className="text-[12px] text-muted underline hover:text-red-400 disabled:opacity-50"
                  >
                    {labels.remove}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="cursor-pointer rounded border border-hairline px-4 py-2 text-sm hover:border-accent">
            {busy === "upload" ? labels.uploading : labels.upload}
            <input
              ref={input}
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              className="hidden"
              disabled={busy !== null}
              onChange={(e) => onPick(e.target.files?.[0])}
            />
          </label>
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy !== null || documents.length === 0}
            className="rounded bg-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
          >
            {busy === "submit" ? labels.submitting : labels.submit}
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </section>
  );
}
