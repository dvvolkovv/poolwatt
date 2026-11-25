"use client";

import { useEffect } from "react";

/**
 * Opens the browser's print dialog once the sheet is on screen — §46
 * "печать на терминале станции". Guarded so an automated test that merely
 * visits the page does not hang on a modal dialog.
 */
export function AutoPrint() {
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("auto") === "0") return;
    const timer = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}
