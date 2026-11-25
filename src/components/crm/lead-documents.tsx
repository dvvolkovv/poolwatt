"use client";

// §48 "документы" — the lease, the grid consent, the planning permission.
// Uploaded through the REST route so one piece of code checks the bytes.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function LeadDocuments({
  leadId,
  documents,
  labels,
}: {
  leadId: string;
  documents: { id: string; name: string; sizeBytes: number; uploadedAt: string }[];
  labels: {
    upload: string;
    hint: string;
    empty: string;
    remove: string;
  };
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const send = (file: File) =>
    startTransition(async () => {
      setError(null);
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(`/api/v1/pipeline/${leadId}/documents`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? `Upload failed (${res.status})`);
        return;
      }
      if (input.current) input.current.value = "";
      router.refresh();
    });

  const drop = (documentId: string) =>
    startTransition(async () => {
      setError(null);
      const res = await fetch(`/api/v1/pipeline/documents/${documentId}`, { method: "DELETE" });
      if (!res.ok) setError(`Could not remove (${res.status})`);
      else router.refresh();
    });

  return (
    <div className="space-y-3" data-testid="lead-documents">
      <div>
        <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
          {labels.upload}
        </span>
        <input
          ref={input}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          aria-label={labels.upload}
          disabled={pending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) send(file);
          }}
          className="text-sm"
        />
        <p className="mt-1 text-[12px] text-muted">{labels.hint}</p>
      </div>

      {documents.length === 0 ? (
        <p className="text-sm text-muted">{labels.empty}</p>
      ) : (
        <ul className="divide-y divide-hairline text-sm">
          {documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-3 py-2">
              <a
                href={`/api/v1/pipeline/documents/${d.id}`}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-accent"
              >
                {d.name}
              </a>
              <span className="text-[12px] text-muted">
                <span className="num">{Math.max(1, Math.round(d.sizeBytes / 1024))}</span> KB ·{" "}
                <span className="num">{d.uploadedAt.slice(0, 10)}</span>
                {" · "}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => drop(d.id)}
                  className="underline hover:text-down disabled:opacity-50"
                >
                  {labels.remove}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="text-[13px] text-down" data-testid="lead-doc-error">
          {error}
        </p>
      )}
    </div>
  );
}
