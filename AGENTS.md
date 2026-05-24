<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

Poolwatt is on Next.js 16 (App Router, React 19). APIs, conventions, and file
structure may all differ from your training data:

- Server components are the default; opt into `"use client"` only when needed.
- Route handlers live under `src/app/api/<route>/route.ts`.
- `params` and `searchParams` are async — `await` them.
- `next-intl` v4 requires `setRequestLocale(locale)` inside every page that
  uses translations (already done in `src/app/[locale]/page.tsx`).

Read the relevant guide in `node_modules/next/dist/docs/` before writing any
code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Poolwatt-specific notes

- Phase 1 ships *no DB or Redis* — `src/lib/snapshot.ts` returns mock data
  from `src/lib/producers.ts`. Do not add Prisma calls to the home page until
  Phase 2 lands; the wiring is intentional so the landing demo runs without
  infra.
- Energy-domain types live in `src/lib/producers.ts`; their Prisma equivalents
  are in `prisma/schema.prisma`. Keep the two roughly in sync — Phase 2
  replaces the mock readers with `prisma.producer.findMany(...)` and the call
  sites should not need to change.
- All numerics in the UI use the `.num` class (defined in `globals.css`) for
  tabular figures. Don't render kWh / price / percentage without it.
- The Telegram bot in `bot/` is intentionally *not* a Claude-runner clone of
  the reference project. It's a thin command dispatcher over the same domain
  primitives (`MOCK_PRODUCERS`, `readGridStats`, …). Keep it that way until we
  decide otherwise.
