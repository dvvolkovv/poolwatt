# Poolwatt — Newsflow landing block (design)

**Date:** 2026-05-30
**Scope:** Add a renewable-energy news rail to the landing page, structurally
mirroring the `Newsflow` block on trientes.org.
**Phase:** 1 (no DB, no Redis, no worker yet — see Phase 2 swap below).

---

## 1. What we ship

A `Newsflow` section on `[locale]/page.tsx`, between the Hero and the Producer
table. Direct port of trientes' `NewsRail` (cards 1/2/4 columns, hairline
dividers, 16:9 image with themed gradient fallback, 3-line clamped headline,
source + relative time), tuned for renewable-energy outlets and categories.

Eyebrow row matches trientes verbatim in shape (left: pulsing-dot label
`Newsflow`; right: muted subtitle `Latest renewable-energy headlines · refreshed
every 30 min`, localized).

Default 8 items shown. Section hides itself when feed is empty.

---

## 2. Components

```
src/components/news-rail.tsx         — server component, grid of cards
src/components/news-card-image.tsx   — client component, <img> with onError fallback
```

Port verbatim from trientes (`src/components/news-rail.tsx`,
`src/components/news-card-image.tsx`) with three tweaks:

1. `THEME` map repainted for energy palette (see §3).
2. `MediaPlaceholder` background letter changes from `T` to `P`.
3. Card title reads `item.titles[locale] ?? item.titles.en` instead of
   `item.title` (translation, see §6).

No other behavioral change.

---

## 3. Themes (5 + fallback)

| Theme    | Hex       | Keyword triggers (case-insensitive substring match in title + snippet) |
| -------- | --------- | ---------------------------------------------------------------------- |
| solar    | `#f5a524` | `solar`, `photovoltaic`, ` pv `, `panel`, `rooftop`                    |
| wind     | `#5b8def` | `wind`, `turbine`, `offshore wind`, `onshore`                          |
| storage  | `#30b658` | `battery`, `storage`, `bess`, `lithium`, `megapack`                    |
| grid     | `#a09baa` | `grid`, `transmission`, `interconnect`, `blackout`, `microgrid`, `utility` |
| policy   | `#e55c5c` | `regulat`, `subsidy`, `tariff`, `mandate`, `ira`, `epa`, `doe`, `ferc`, `eu ` |
| general  | `#888888` | fallback                                                               |

Priority order checked specific-first:
`policy → storage → wind → solar → grid → general`.

Rationale: a headline like "California utilities install 2 GWh of grid
batteries" matches both `storage` (battery) and `grid` (grid, utility) — we
want it labeled `storage`. A headline like "EPA delays solar permitting rules"
matches `policy` (EPA) and `solar` — we want `policy`.

---

## 4. RSS sources (4, public, no API key)

Direct analog to trientes' four-feed set.

| Source           | URL                                              |
| ---------------- | ------------------------------------------------ |
| Electrek         | `https://electrek.co/feed/`                      |
| CleanTechnica    | `https://cleantechnica.com/feed/`                |
| PV Magazine      | `https://www.pv-magazine.com/feed/`              |
| Canary Media     | `https://www.canarymedia.com/articles.rss`       |

> **Note:** Renewables Now was the spec's original 4th source (matching trientes' four-source count); after deploy probing showed their feed sits behind a Cloudflare managed-challenge that rejects server-side fetches, we swapped to Canary Media. Both are mainstream English-language renewable-energy outlets with comparable cadence.

All four verified to serve valid RSS with a browser User-Agent and `follow`
redirects. None require an API key. If any feed turns out to be unreliable
in practice, the orchestrator (`fetchNews`) tolerates per-feed failure
(`Promise.allSettled`) and the remaining feeds still render.

---

## 5. Data flow (Phase 1)

```
[browser] → [Next.js [locale]/page.tsx, revalidate=60]
              ↓ (server component)
            readNews(locale)
              ↓
            unstable_cache(key="news:v1", revalidate=1800)
              ↓ (cold path only — most calls return cached)
            fetchNews()
              ├─ Promise.allSettled([fetchFeedXml(Electrek), …]) → parseFeed × 4
              └─ mergeAndRank(lists, limit=20)
              ↓
            translateHeadlines(items, targetLocales=["ru","sk"])
              ↓
            NewsItem[] with title: { en, ru, sk }
              ↓
            <NewsRail items={news} locale={locale} />
```

The page itself stays at `revalidate = 60` (existing line in
`src/app/[locale]/page.tsx:13`). The news fetch+translate is independently
cached for 30 min via `unstable_cache`, so most page rebuilds reuse the cached
news payload and incur no network or OpenAI cost.

### Cold-start behavior

After `pm2 restart poolwatt-web`, the in-memory cache is empty. The first
request triggers the full pipeline (~6 s for RSS fetch + ~1 s for translation)
before serving. Acceptable for Phase 1 — measured against the existing landing
demo's tolerance for "first request is slow" (the mock data path is fast, but
the Phase 1 contract doesn't promise sub-second first-paint after restart).

### Why this departs from "Phase 1 reads no infra"

`CLAUDE.md` says Phase 1 reads no DB, with `src/lib/snapshot.ts` returning
mocks. News is inherently live — mocked headlines have zero value to a
visitor. Next.js' built-in `unstable_cache` is not "infra" in the sense
CLAUDE.md means (no Prisma, no Redis, no worker process to manage). It lives
inside the Next process and disappears on restart. We accept this departure
as a documented one-off.

---

## 6. Translation

`translateHeadlines(items, targetLocales)` lives in `src/lib/news-i18n.ts`.

### Behavior

Input: `NewsItem[]` (with English `title` field set by `parseFeed`), and a
fixed array of target locales `["ru", "sk"]`.

Output: same `NewsItem[]` with `title` replaced by
`titles: { en: string, ru: string, sk: string }`. Source `title` is preserved
under `titles.en`.

### Implementation

Single `gpt-4o-mini` call per refresh. Request:

- System: "Translate each English news headline into the requested locales.
  Preserve company names, ticker symbols, and units (GWh, MW, etc.) as-is.
  Output JSON only."
- User: JSON `{ headlines: [...], locales: ["ru", "sk"] }`
- Response format: JSON object schema enforced via `response_format`.

Returned shape: `{ ru: string[], sk: string[] }` — arrays positionally aligned
with the input headlines.

OpenAI API key is read from `OPENAI_API_KEY`, the same env var the bot uses
(canonical example: `bot/tts.ts`).

### Failure mode

If the OpenAI call throws (rate limit, network, JSON parse failure, etc.):
log + fall through, returning items with all three locale slots set to the
English original. Section still renders; non-English visitors see English
headlines this cycle. Next 30-min refresh retries.

### Cost

20 headlines × ~15 input tokens each + 2 locales × ~20 output tokens each
= ~300 input + ~800 output tokens per refresh × 48 refreshes/day
= ~14k in + 38k out per day ≈ **$0.03/day** at `gpt-4o-mini` rates. Negligible.

### Locale coverage

Only `ru` and `sk` get translation in Phase 1 (the bot's bilingual axis,
matches `feedback_audio_bilingual` in memory). All other 27 UI locales fall
back to the English headline via `titles[locale] ?? titles.en`.

Phase 2 will move translation into the worker and expand the locale set
(separate decision, not part of this spec).

---

## 7. Phase 2 swap (anticipated, NOT implemented now)

When `worker/` lands (mirror of trientes):

1. Move `fetchNews()` + `translateHeadlines()` into a `runNewsSync()` cron
   firing at `:15/:45 * * * *` (mirror trientes `worker/index.ts:53` and
   `:223`). Writes to Redis under key `news:v1`.
2. Replace `unstable_cache` wrapper in `readNews()` with a Redis read
   (mirror trientes `src/lib/snapshot.ts:165` — cache-first, cold-fallback
   to inline fetch + warm).
3. Pure helpers (`classifyTheme`, `dedupe`, `mergeAndRank`, `extractImage`,
   `parseFeed`, `translateHeadlines`) move unchanged — they are already
   side-effect-free and unit-tested.

The component API (`<NewsRail items locale />`) does not change between
phases.

---

## 8. File-by-file plan

```
package.json
  — Add `rss-parser` to dependencies (currently absent in poolwatt;
    trientes uses it, version-pin to the same release).

src/lib/news.ts
  — Port from trientes src/lib/news.ts. Verbatim except:
    • FEEDS list replaced with the 4 renewable-energy sources (§4)
    • THEME_KEYWORDS replaced with the energy keyword table (§3)
    • NewsItem.title becomes NewsItem.titles: { en, ru, sk }
      (set by translateHeadlines; parseFeed still emits .title for
       the translator to consume)
    • UA string changed to "PoolwattNewsBot/1.0 (+https://poolwatt.com)"

src/lib/news-i18n.ts                          [NEW]
  — translateHeadlines(items, targetLocales) using OpenAI SDK
    (already a dependency for bot/tts.ts). Single call per invocation,
    JSON response_format, error→fallback-to-English.

src/lib/snapshot.ts
  — Add `export async function readNews(locale: string): Promise<NewsItem[]>`
    wrapping fetchNews + translateHeadlines in unstable_cache(1800).
    Sits alongside existing readTopProducers / readGridStats / readGreenIndex.

src/components/news-card-image.tsx            [NEW, ported verbatim]

src/components/news-rail.tsx                  [NEW, ported with §2 tweaks]

src/app/[locale]/page.tsx
  — Call readNews(locale) inside the existing Promise.all (line 26).
  — Insert <NewsRail items={news} locale={locale} /> section between
    the Hero (closing </section> at line 87) and the Producer table
    (opening <section id="producers"> at line 90).
  — Section markup mirrors trientes lines 118–132 with localized eyebrow
    via th("newsflow.eyebrow") / th("newsflow.subtitle").

messages/{en,ru,sk}.json (+ remaining 26 locales)
  — Add home.newsflow.eyebrow, home.newsflow.subtitle, and
    home.newsflow.categories.{solar,wind,storage,grid,policy,general}.
    Other 27 locales get English fallback values for now (next-intl
    will warn but render); proper translation is a separate sweep.

src/lib/news.test.ts                          [NEW]
  — Unit tests for the pure helpers, mirroring trientes' test file:
    classifyTheme(text), dedupe(items), mergeAndRank(lists, limit),
    extractImage(rawItem), parseFeed(xml, source). One fixture per
    source (saved real feed snippet) under src/lib/__fixtures__/news/.
```

---

## 9. Testing

### Unit (Vitest, mirroring trientes patterns)

- `classifyTheme` returns the expected bucket for 12 representative
  renewable-energy headlines (2 per category, including one each that
  is multi-keyword to verify priority order).
- `dedupe` removes URL-duplicates and preserves first occurrence.
- `mergeAndRank` sorts newest-first, then dedupes, then truncates to limit.
- `extractImage` priority: `media:thumbnail` > image `media:content` >
  image `enclosure` > first `<img>` in `content:encoded`. Returns `null`
  when none qualify.
- `parseFeed` parses one saved fixture per source (4 fixtures) and
  produces well-formed `NewsItem[]`.

### Integration (manual smoke, no e2e for Phase 1)

After deploy:
1. Hit `https://poolwatt.com/en` → Newsflow section visible, 8 cards, mix
   of categories, real timestamps.
2. Hit `https://poolwatt.com/ru` → same cards, headlines in Russian.
3. Hit `https://poolwatt.com/sk` → same cards, headlines in Slovak.
4. Hit `https://poolwatt.com/de` (or any non-RU/SK locale) → headlines
   still English (fallback).
5. `pm2 logs poolwatt-web --lines 50 --nostream` shows no errors.

### Failure-mode smoke

- Temporarily set one feed URL to a 404 → others still render, server
  logs one `[news] feed failed:` line.
- Temporarily set `OPENAI_API_KEY` to a bad value → cards render with
  English-only titles, single warning in logs.

---

## 10. Error handling summary

| Failure                            | Behavior                                                              |
| ---------------------------------- | --------------------------------------------------------------------- |
| One RSS feed unreachable / 5xx     | Logged + skipped; others still render (`Promise.allSettled`).         |
| All RSS feeds unreachable          | Empty array; section hidden via `{news.length > 0 && …}`.             |
| Translation call fails             | Items fall back to `titles.{en,ru,sk}` all = English original.        |
| Broken `imageUrl`                  | Client `onError` swaps to themed gradient placeholder.                |
| Feed item missing title/URL        | Skipped silently in `parseFeed`.                                      |

---

## 11. Explicitly out of scope

- Redis cache (Phase 2)
- Background worker / cron (Phase 2)
- Translation to locales beyond RU+SK (Phase 2)
- Pagination, "load more", category filter tabs (trientes doesn't have them)
- Standalone `/news` page (future)
- Audio readout of news in the Telegram bot (orthogonal feature)

---

## 12. Risks & mitigations

| Risk                                                       | Mitigation                                                 |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| RSS source changes URL or stops publishing                 | Per-feed `Promise.allSettled`; degrades to 3 sources.      |
| OpenAI cost creep with future locale expansion             | Phase 2 moves translation into worker (one call per 30 min independent of traffic); per-locale cache keys. |
| Translated headline loses domain term (e.g. "Megapack")    | System prompt instructs preservation of brand/unit terms; tests in §9 can include a fixture asserting this. |
| `unstable_cache` API churn between Next 16 minor releases  | Re-read `node_modules/next/dist/docs/` per AGENTS.md before implementation; have a fallback to in-module Map cache. |
| Cold-start latency after `pm2 restart`                     | Pre-warm: optional follow-up script `npm run news:warm` that hits the homepage once post-deploy. Not in scope here. |

---

## 13. Acceptance criteria

1. Visiting `https://poolwatt.com/en` shows a `Newsflow` section between
   Hero and Producer table, with up to 8 real news cards from the 4 feeds.
2. Each card shows: image (or themed gradient with "P"), category badge in
   the correct color, headline (≤3 lines), source name, and "X min/hr ago"
   timestamp.
3. RU and SK locale URLs show translated headlines; other locales show
   English headlines.
4. Repeated page loads within 30 min do not trigger new RSS fetches or
   OpenAI calls (verified via logs).
5. Unit tests for `news.ts` pure helpers all pass.
6. `pm2 logs poolwatt-web` shows no errors during 24 h of operation.
