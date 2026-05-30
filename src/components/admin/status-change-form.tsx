"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import type { BuildRequestStatus } from "@prisma/client";
import { adminSetBuildRequestStatus } from "@/app/[locale]/admin/build-requests/actions";

type Props = {
  id: string;
  currentStatus: BuildRequestStatus;
  allowedNext: BuildRequestStatus[];
  labels: { setStatus: string; adminNote: string; submit: string };
};

export function StatusChangeForm({ id, currentStatus, allowedNext, labels }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<BuildRequestStatus | "">(allowedNext[0] ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (allowedNext.length === 0) {
    return <p className="text-sm text-muted">No transitions available from {currentStatus}.</p>;
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    setError(null);
    startTransition(async () => {
      const r = await adminSetBuildRequestStatus(id, target as BuildRequestStatus, note);
      if (!r.ok) setError(r.formError ?? r.fieldErrors?.adminNote ?? "Failed");
      else router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 border border-hairline rounded p-4">
      <label className="block text-sm">
        {labels.setStatus}
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value as BuildRequestStatus)}
          className="block mt-1 border border-hairline rounded px-2 py-1"
        >
          {allowedNext.map((s) => (<option key={s} value={s}>{s}</option>))}
        </select>
      </label>
      <label className="block text-sm">
        {labels.adminNote}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="block mt-1 border border-hairline rounded px-2 py-1 w-full"
        />
      </label>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button type="submit" disabled={pending} className="px-4 py-2 bg-foreground text-bg rounded disabled:opacity-50">
        {labels.submit}
      </button>
    </form>
  );
}
