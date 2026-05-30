// Snapshot readers. In Phase 1 they return deterministic mock data so the home
// page works without DB or Redis. The signatures intentionally mirror the
// reference project (`readTop100`, `readGlobalStats`, …) so swapping to real
// Redis-backed reads in Phase 2 only changes implementations, not call sites.

import { unstable_cache } from "next/cache";
import { MOCK_PRODUCERS, MOCK_GRID_STATS, type ProducerRow, type GridSnap } from "./producers";
import { MOCK_GREEN_INDEX, type GreenIndex } from "./green-index";
import type { ExchangeRates } from "./currency";
import { fetchNews, type NewsItem } from "./news";
import { translateHeadlines } from "./news-i18n";

export async function readTopProducers(): Promise<ProducerRow[]> {
  return MOCK_PRODUCERS;
}

export async function readGridStats(): Promise<GridSnap | null> {
  return MOCK_GRID_STATS;
}

export async function readGreenIndex(): Promise<GreenIndex | null> {
  return MOCK_GREEN_INDEX;
}

// Renewable-energy news for the landing-page Newsflow rail. Phase 1 has no
// worker / Redis, so we wrap fetch+translate in Next's in-process cache with a
// 30-min TTL — matches the cadence trientes uses on the server side. Phase 2
// will replace this with a Redis read populated by a worker cron.
//
// Cold path (after pm2 restart) takes ~6s for the 4 RSS fetches plus ~1s for
// the OpenAI translation call. All subsequent reads within 30 min hit cache.
const cachedNews = unstable_cache(
  async (): Promise<NewsItem[]> => {
    const raw = await fetchNews();
    return await translateHeadlines(raw);
  },
  ["news:v2"],
  { revalidate: 1800, tags: ["news"] },
);

export async function readNews(): Promise<NewsItem[]> {
  try {
    return await cachedNews();
  } catch (err) {
    console.error("[snapshot] readNews failed:", err);
    return [];
  }
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
