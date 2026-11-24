"use client";

// US-26 — "выработка и доход в реальном времени", with the criterion
// "обновление не реже раза в минуту".
//
// Two sources, because neither alone meets the criterion: the §15 telemetry
// channel refreshes the moment a reading lands, and a sixty-second timer
// refreshes even when the socket never opened. The page itself is a server
// component; this only asks it to re-render.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useChannel } from "@/hooks/use-channel";

const FLOOR_MS = 60_000;

export function StationLive({
  channel,
  labels,
}: {
  channel: string;
  labels: { live: string; offline: string };
}) {
  const router = useRouter();

  const { connected } = useChannel(channel, (event) => {
    if (event.type !== "telemetry.ingested") return;
    router.refresh();
  });

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), FLOOR_MS);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <div className="text-[11px] uppercase tracking-[0.14em] text-muted">
      <span
        aria-hidden
        className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${
          connected ? "bg-accent" : "bg-muted"
        }`}
      />
      <span data-testid="station-live-state">{connected ? labels.live : labels.offline}</span>
    </div>
  );
}
