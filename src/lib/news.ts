// Renewable-energy news aggregation from public RSS feeds (no API key required).
// Port of trientes' src/lib/news.ts retuned for energy outlets and categories.
//
// Phase 1: readNews() in snapshot.ts wraps fetchNews + translateHeadlines in
// Next's unstable_cache (30 min TTL). Phase 2 will move the fetch+translate
// into the worker on a :15/:45 cron and replace the cache with Redis.
//
// Pure helpers (classifyTheme/dedupe/parseFeed/mergeAndRank/extractImage) are
// side-effect-free and unit tested; fetchNews does the network IO and tolerates
// individual feed failures via Promise.allSettled.

import Parser from "rss-parser";

export type NewsTheme = "solar" | "wind" | "storage" | "grid" | "policy" | "general";

// Title is per-locale; translateHeadlines fills ru+sk, others fall back to en
// at render time via `titles[locale] ?? titles.en`.
export type LocalizedTitles = {
  en: string;
  ru?: string;
  sk?: string;
};

export type NewsItem = {
  // Set initially by parseFeed (English source); translateHeadlines upgrades
  // to a full LocalizedTitles map before the value is cached.
  title: string;
  titles?: LocalizedTitles;
  url: string;
  source: string;
  publishedAt: number; // unix seconds
  theme: NewsTheme;
  imageUrl: string | null;
};

// All four serve valid RSS without an API key (browser UA + redirects).
export const FEEDS: { url: string; source: string }[] = [
  { url: "https://electrek.co/feed/", source: "Electrek" },
  { url: "https://cleantechnica.com/feed/", source: "CleanTechnica" },
  { url: "https://www.pv-magazine.com/feed/", source: "PV Magazine" },
  { url: "https://www.canarymedia.com/articles.rss", source: "Canary Media" },
];

// Checked most-specific first. A headline matching several buckets takes the
// earliest one here (policy > storage > wind > solar > grid > general).
// Rationale: "Solar permit denied by EPA" → policy; "Utilities install grid
// batteries" → storage (battery beats grid); "Wind turbine on a rooftop" → wind.
const THEME_KEYWORDS: { theme: NewsTheme; words: string[] }[] = [
  {
    // Short tokens are space-padded so e.g. "NEPA" doesn't match " epa " and
    // "BUREAU" doesn't match " eu ". The classifier wraps the searched text
    // with leading/trailing spaces (see classifyTheme below).
    theme: "policy",
    words: [
      "regulat", "subsidy", "subsidies", "tariff", "mandate",
      " ira ", " epa ", " doe ", "ferc", " eu ", "european commission",
      "lawmaker", "congress", "senate", "court", "lawsuit", "permit",
      " ban ", "sanction", "compliance",
    ],
  },
  {
    theme: "storage",
    words: ["battery", "batteries", "storage", "bess", "lithium", "megapack"],
  },
  {
    theme: "wind",
    words: ["wind", "turbine", "offshore wind", "onshore"],
  },
  {
    theme: "solar",
    words: ["solar", "photovoltaic", " pv ", " pv,", " pv.", "panel", "rooftop"],
  },
  {
    theme: "grid",
    words: [
      "grid", "transmission", "interconnect", "blackout", "microgrid",
      "utility", "utilities", "substation",
    ],
  },
];

export function classifyTheme(text: string): NewsTheme {
  const t = ` ${text.toLowerCase()} `;
  for (const { theme, words } of THEME_KEYWORDS) {
    if (words.some((w) => t.includes(w))) return theme;
  }
  return "general";
}

export function dedupe(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const it of items) {
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    out.push(it);
  }
  return out;
}

// Newest-first, then dedupe (so a duplicated URL keeps its freshest copy), capped.
export function mergeAndRank(lists: NewsItem[][], limit = 20): NewsItem[] {
  const flat = lists.flat().sort((a, b) => b.publishedAt - a.publishedAt);
  return dedupe(flat).slice(0, limit);
}

function isHttpUrl(u: unknown): u is string {
  if (typeof u !== "string") return false;
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:";
  } catch {
    return false;
  }
}

const parser = new Parser({
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: true }],
      ["content:encoded", "contentEncoded"],
    ],
  },
});

const IMG_EXT = /\.(jpe?g|png|gif|webp|avif)(\?|#|$)/i;

function mediaUrl(node: unknown, requireImageHint: boolean): string | null {
  const arr = Array.isArray(node) ? node : node == null ? [] : [node];
  for (const raw of arr) {
    const m = raw as { $?: Record<string, unknown>; url?: unknown };
    const attrs = (m.$ ?? m) as Record<string, unknown>;
    const url = attrs.url;
    if (typeof url !== "string" || !isHttpUrl(url)) continue;
    if (!requireImageHint) return url;
    const medium = attrs.medium;
    const type = typeof attrs.type === "string" ? attrs.type : "";
    if (medium === "image" || type.startsWith("image/") || IMG_EXT.test(url)) return url;
  }
  return null;
}

// Best-effort article thumbnail. Priority: media:thumbnail, image media:content,
// image enclosure, then the first <img> in the body. null when none qualify.
export function extractImage(item: Record<string, unknown>): string | null {
  const thumb = mediaUrl(item.mediaThumbnail, false);
  if (thumb) return thumb;

  const media = mediaUrl(item.mediaContent, true);
  if (media) return media;

  const enc = item.enclosure as { url?: unknown; type?: unknown } | undefined;
  if (enc && typeof enc.url === "string" && isHttpUrl(enc.url)) {
    const t = typeof enc.type === "string" ? enc.type : "";
    if (t.startsWith("image/") || IMG_EXT.test(enc.url)) return enc.url;
  }

  // Most of our feeds (Electrek, CleanTechnica, Canary, PV Magazine) embed the
  // article thumbnail as a plain <img> inside <description>, NOT in media:*.
  // rss-parser maps <description> → item.content (HTML) and exposes our custom
  // <content:encoded> → contentEncoded. We try the richer one first, then fall
  // back; filter empty strings (customFields default to "" even when missing,
  // which would otherwise short-circuit the find()).
  const candidates = [item.contentEncoded, item.content, item.description];
  for (const v of candidates) {
    if (typeof v !== "string" || v.length === 0) continue;
    const m = v.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m && isHttpUrl(m[1])) return m[1];
  }
  return null;
}

export async function parseFeed(xml: string, source: string): Promise<NewsItem[]> {
  const feed = await parser.parseString(xml);
  const out: NewsItem[] = [];
  for (const it of feed.items ?? []) {
    const title = (it.title ?? "").trim();
    const url = it.link ?? "";
    if (!title || !isHttpUrl(url)) continue;
    const ms = Date.parse(it.isoDate ?? it.pubDate ?? "");
    const publishedAt = Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000);
    out.push({
      title,
      url,
      source,
      publishedAt,
      theme: classifyTheme(`${title} ${it.contentSnippet ?? ""}`),
      imageUrl: extractImage(it as unknown as Record<string, unknown>),
    });
  }
  return out;
}

const UA = "Mozilla/5.0 (compatible; PoolwattNewsBot/1.0; +https://poolwatt.com)";

async function fetchFeedXml(url: string, timeoutMs = 6000): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/rss+xml, application/xml, text/xml" },
      redirect: "follow",
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Fetch all feeds in parallel; a failing feed is logged and skipped, not fatal.
export async function fetchNews(limit = 20): Promise<NewsItem[]> {
  const results = await Promise.allSettled(
    FEEDS.map(async (f) => parseFeed(await fetchFeedXml(f.url), f.source)),
  );
  const lists: NewsItem[][] = [];
  for (const r of results) {
    if (r.status === "fulfilled") lists.push(r.value);
    else console.error("[news] feed failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  }
  return mergeAndRank(lists, limit);
}
