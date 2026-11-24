"use client";

// US-02: approve or reject a listing application; a rejection needs a comment.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideListing } from "@/app/[locale]/admin/listings/actions";

type Props = {
  applicationId: string;
  labels: {
    title: string;
    approve: string;
    reject: string;
    comment: string;
    screening: string;
  };
};

export function DecisionForm({ applicationId, labels }: Props) {
  const [comment, setComment] = useState("");
  const [screeningNote, setScreeningNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function decide(approve: boolean) {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const r = await decideListing({
        applicationId,
        approve,
        comment: comment.trim() || null,
        screeningNote: screeningNote.trim() || null,
      });
      if (r.ok) {
        setDone(
          r.accountId
            ? `${r.status} · IBAN opened · ${r.promotedAssets} asset(s) in probation`
            : r.status,
        );
        router.refresh();
      } else {
        setError(r.formError);
      }
    });
  }

  const canReject = comment.trim().length > 0;

  return (
    <section className="border border-hairline rounded p-4 space-y-3">
      <h2 className="text-[13px] uppercase tracking-[0.14em] text-muted">{labels.title}</h2>

      <label className="block">
        <span className="text-[12px] text-muted">{labels.screening}</span>
        <textarea
          name="screeningNote"
          value={screeningNote}
          onChange={(e) => setScreeningNote(e.target.value)}
          rows={2}
          className="mt-1 w-full border border-hairline rounded px-2 py-1.5 bg-transparent text-sm"
        />
      </label>

      <label className="block">
        <span className="text-[12px] text-muted">{labels.comment}</span>
        <textarea
          name="comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          className="mt-1 w-full border border-hairline rounded px-2 py-1.5 bg-transparent text-sm"
        />
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => decide(true)}
          className="px-4 py-2 rounded bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
        >
          {labels.approve}
        </button>
        <button
          type="button"
          disabled={pending || !canReject}
          onClick={() => decide(false)}
          title={canReject ? undefined : labels.comment}
          className="px-4 py-2 rounded border border-down text-down text-sm disabled:opacity-40"
        >
          {labels.reject}
        </button>
      </div>

      {error && <p className="text-[12px] text-down">{error}</p>}
      {done && <p className="text-[12px] text-up num">{done}</p>}
    </section>
  );
}
