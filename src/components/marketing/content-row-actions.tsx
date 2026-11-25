"use client";

// The three things a partner does to a piece of content once it exists:
// send it to moderation, drop a file, delete it.

import { useState, useTransition } from "react";
import {
  deleteContentAction,
  detachAssetAction,
  submitContentAction,
} from "@/app/[locale]/me/charger-operator/[id]/marketing/actions";

export function ContentRowActions({
  contentId,
  assetIds,
  canSubmit,
  labels,
}: {
  contentId: string;
  assetIds: string[];
  canSubmit: boolean;
  labels: { submit: string; remove: string; dropFile: string };
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; formError?: string }>) =>
    startTransition(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.formError ?? "Could not do that.");
    });

  return (
    <span className="flex flex-wrap items-center gap-2">
      {canSubmit && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => submitContentAction({ contentId }))}
          className="rounded border border-accent px-2 py-0.5 text-[12px] text-accent hover:bg-accent/10 disabled:opacity-50"
        >
          {labels.submit}
        </button>
      )}
      {assetIds.length > 0 && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => detachAssetAction({ assetId: assetIds[assetIds.length - 1] }))}
          className="rounded border border-hairline px-2 py-0.5 text-[12px] text-muted hover:border-accent disabled:opacity-50"
        >
          {labels.dropFile}
        </button>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => deleteContentAction({ contentId }))}
        className="rounded border border-hairline px-2 py-0.5 text-[12px] text-muted hover:border-down disabled:opacity-50"
      >
        {labels.remove}
      </button>
      {error && <span className="text-[12px] text-down">{error}</span>}
    </span>
  );
}
