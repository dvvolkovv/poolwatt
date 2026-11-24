"use client";

// §29.4 — approve into test connection, or send back with a reason the owner
// can act on. A rejection without a reason is refused by the service.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decidePointAction } from "@/app/[locale]/admin/points/actions";

export function PointDecisionForm({
  pointId,
  labels,
}: {
  pointId: string;
  labels: { approve: string; reject: string; note: string; working: string };
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(approved: boolean) {
    setError(null);
    startTransition(async () => {
      const r = await decidePointAction({ pointId, approved, note: note.trim() || null });
      if (!r.ok) setError(r.formError ?? "Could not decide.");
      else router.refresh();
    });
  }

  return (
    <div className="space-y-3" data-testid="point-decision">
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={labels.note}
        aria-label={labels.note}
        rows={3}
        className="w-full rounded border border-hairline bg-bg px-3 py-2 text-sm"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => decide(true)}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {pending ? labels.working : labels.approve}
        </button>
        <button
          type="button"
          disabled={pending || note.trim() === ""}
          onClick={() => decide(false)}
          className="rounded border border-down px-4 py-2 text-sm text-down disabled:opacity-50"
        >
          {labels.reject}
        </button>
      </div>
      {error && <p className="text-[13px] text-down">{error}</p>}
    </div>
  );
}
