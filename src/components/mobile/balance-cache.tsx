"use client";

import { useEffect } from "react";

export const BALANCE_CACHE_KEY = "poolwatt.lastBalance";

export interface CachedBalance {
  kwh: number;
  fiat: number;
  currency: string;
  zoneCode: string | null;
  at: string;
}

/**
 * The main screen renders this with the figures it just read. The offline
 * screen is the only reader, and it prints the timestamp next to the number,
 * so a stale value can never pass for a fresh one (§25).
 */
export function BalanceCache({ kwh, fiat, currency, zoneCode }: Omit<CachedBalance, "at">) {
  useEffect(() => {
    try {
      const payload: CachedBalance = {
        kwh,
        fiat,
        currency,
        zoneCode,
        at: new Date().toISOString(),
      };
      window.localStorage.setItem(BALANCE_CACHE_KEY, JSON.stringify(payload));
    } catch {
      // Private mode, quota, an old WebView — the figure is a convenience.
    }
  }, [kwh, fiat, currency, zoneCode]);
  return null;
}
