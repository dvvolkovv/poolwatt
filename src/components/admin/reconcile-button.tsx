"use client";

// §16.11 — the operator's "run it now", so a suspicion can be checked at once.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runReconciliationNow } from "@/app/[locale]/admin/reconciliation/actions";

export function ReconcileButton({
  labels,
}: {
  labels: { runNow: string; running: string; ok: string; drift: string; failed: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [, startTransition] = useTransition();

  async function onClick() {
    setBusy(true);
    setMessage(null);
    const result = await runReconciliationNow();
    setBusy(false);

    if (!result.ok) {
      setBad(true);
      setMessage(labels.failed.replace("{error}", result.error));
      return;
    }
    setBad(result.driftCount > 0);
    setMessage(
      result.driftCount > 0
        ? labels.drift.replace("{drifts}", String(result.driftCount))
        : labels.ok.replace("{checked}", String(result.checked)),
    );
    startTransition(() => router.refresh());
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="rounded border border-hairline px-3 py-1.5 text-[13px] hover:border-accent disabled:opacity-50"
      >
        {busy ? labels.running : labels.runNow}
      </button>
      {message && (
        <span
          data-testid="reconcile-message"
          className={`text-[13px] ${bad ? "text-red-400" : "text-muted"}`}
        >
          {message}
        </span>
      )}
    </div>
  );
}
