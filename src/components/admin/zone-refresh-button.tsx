"use client";

// §6, §16.5 — the operator should not have to wait for the hourly tick to see
// whether the feed answers.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refreshZone } from "@/app/[locale]/admin/zones/actions";

export function ZoneRefreshButton({
  zoneId,
  labels,
}: {
  zoneId: string;
  labels: { refresh: string; refreshing: string; refreshed: string; failed: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  async function onClick() {
    setBusy(true);
    setMessage(null);
    const result = await refreshZone(zoneId);
    setBusy(false);
    setFailed(!result.ok);
    setMessage(
      result.ok
        ? labels.refreshed.replace("{stored}", String(result.stored))
        : labels.failed.replace("{error}", result.error),
    );
    if (result.ok) startTransition(() => router.refresh());
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="rounded border border-hairline px-2.5 py-1 text-[12px] hover:border-accent disabled:opacity-50"
      >
        {busy ? labels.refreshing : labels.refresh}
      </button>
      {message && (
        <span className={`text-[12px] ${failed ? "text-red-400" : "text-muted"}`}>{message}</span>
      )}
    </span>
  );
}
