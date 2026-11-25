"use client";

import { useEffect } from "react";

/**
 * One registration per locale — the worker caches the offline screen of the
 * language it was registered with (see public/sw.js).
 */
export function SwRegister({ locale }: { locale: string }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register(`/sw.js?locale=${locale}`).catch(() => {
      // A phone that refuses the worker still works online; nothing to say.
    });
  }, [locale]);
  return null;
}
