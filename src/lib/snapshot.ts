// Snapshot readers. In Phase 1 they return deterministic mock data so the home
// page works without DB or Redis. The signatures intentionally mirror the
// reference project (`readTop100`, `readGlobalStats`, …) so swapping to real
// Redis-backed reads in Phase 2 only changes implementations, not call sites.

import { MOCK_PRODUCERS, MOCK_GRID_STATS, type ProducerRow, type GridSnap } from "./producers";
import { MOCK_GREEN_INDEX, type GreenIndex } from "./green-index";
import type { ExchangeRates } from "./currency";

export async function readTopProducers(): Promise<ProducerRow[]> {
  return MOCK_PRODUCERS;
}

export async function readGridStats(): Promise<GridSnap | null> {
  return MOCK_GRID_STATS;
}

export async function readGreenIndex(): Promise<GreenIndex | null> {
  return MOCK_GREEN_INDEX;
}

// Pretend FX rates relative to USD — same shape as the reference project.
export async function readExchangeRates(): Promise<ExchangeRates | null> {
  return {
    USD: 1,
    EUR: 0.92,
    RUB: 92.3,
    GBP: 0.78,
    BRL: 5.05,
  };
}
