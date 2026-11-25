"use client";

// §44 — the browser's half of the content counters (US-44).
//
// One show per block per page view, a click when the partner's link is taken,
// and a view when a video is first played. Deliberately fire-and-forget: a
// counter must never hold up or break the page it is counting.

import { useEffect, useRef } from "react";

type Kind = "IMPRESSION" | "CLICK" | "VIDEO_VIEW";

export function sendContentEvent(contentId: string, kind: Kind, pointId?: string | null) {
  const body = JSON.stringify({ contentId, kind, pointId: pointId ?? null });
  try {
    // `keepalive` so a click that navigates away still reports.
    void fetch("/api/v1/marketing/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Nothing to do: a lost counter is not worth a broken page.
  }
}

/**
 * Records one show of this content for this page view, and watches the block
 * for clicks on the partner's link and for the first play of its video.
 */
export function ContentTracker({
  contentId,
  pointId,
}: {
  contentId: string;
  pointId?: string | null;
}) {
  const marked = useRef(false);

  useEffect(() => {
    if (marked.current) return;
    marked.current = true;
    sendContentEvent(contentId, "IMPRESSION", pointId);

    const block = document.querySelector<HTMLElement>(`[data-content-id="${contentId}"]`);
    if (!block) return;

    const onClick = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("a")) sendContentEvent(contentId, "CLICK", pointId);
    };
    let played = false;
    const onPlay = () => {
      if (played) return;
      played = true;
      sendContentEvent(contentId, "VIDEO_VIEW", pointId);
    };

    block.addEventListener("click", onClick);
    const video = block.querySelector("video");
    video?.addEventListener("play", onPlay);

    return () => {
      block.removeEventListener("click", onClick);
      video?.removeEventListener("play", onPlay);
    };
  }, [contentId, pointId]);

  return null;
}
