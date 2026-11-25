"use client";

import { useEffect, useState } from "react";
import { BALANCE_CACHE_KEY, type CachedBalance } from "./balance-cache";

export function OfflineBalance({
  bodyTemplate,
  staleLabel,
  retryLabel,
}: {
  bodyTemplate: string;
  staleLabel: string;
  retryLabel: string;
}) {
  const [cached, setCached] = useState<CachedBalance | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(BALANCE_CACHE_KEY);
      if (raw) setCached(JSON.parse(raw) as CachedBalance);
    } catch {
      setCached(null);
    }
  }, []);

  return (
    <div className="mt-6" data-testid="offline-screen">
      {cached ? (
        <>
          <div className="num text-[44px] font-semibold leading-none">
            {cached.kwh.toFixed(2)}
            <span className="text-[16px] text-muted ml-2">kWh</span>
          </div>
          <p className="text-[13px] text-muted mt-3">
            {bodyTemplate.replace("{at}", new Date(cached.at).toLocaleString())}
          </p>
        </>
      ) : null}
      <p className="text-[13px] text-accent mt-2">{staleLabel}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-6 w-full rounded-md bg-accent text-accent-foreground py-3 font-semibold"
      >
        {retryLabel}
      </button>
    </div>
  );
}
