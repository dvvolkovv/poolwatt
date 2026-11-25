"use client";

// §41 — approve or refuse, and when refusing say why: the partner has to be
// able to fix the thing rather than guess.

import { useState, useTransition } from "react";
import { decideContentAction } from "@/app/[locale]/admin/marketing/actions";

export function DecideContent({
  contentId,
  labels,
}: {
  contentId: string;
  labels: { approve: string; reject: string; note: string };
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const decide = (approved: boolean) =>
    startTransition(async () => {
      setError(null);
      const r = await decideContentAction({ contentId, approved, note: note.trim() || null });
      if (!r.ok) setError(r.formError ?? "Could not decide.");
      else setNote("");
    });

  return (
    <div className="space-y-2">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={labels.note}
        aria-label={labels.note}
        className="w-full rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => decide(true)}
          data-testid="approve-content"
          className="rounded border border-up px-3 py-1 text-[13px] text-up hover:bg-up/10 disabled:opacity-50"
        >
          {labels.approve}
        </button>
        <button
          type="button"
          disabled={pending || note.trim().length === 0}
          onClick={() => decide(false)}
          data-testid="reject-content"
          className="rounded border border-down px-3 py-1 text-[13px] text-down hover:bg-down/10 disabled:opacity-50"
        >
          {labels.reject}
        </button>
      </div>
      {error && <p className="text-[13px] text-down">{error}</p>}
    </div>
  );
}
