# Poolwatt

A peer-to-peer marketplace where households contribute battery-stored renewable
electricity to the grid. Every kilowatt-hour comes from on-site solar, wind,
hydro or biomass — and we can prove provenance for each one.

Poolwatt is structurally modelled on
[trientes](https://github.com/dvvolkovv/trientes) (the Layer-1 crypto ledger)
but the domain is energy, not coinage: rows in the rankings are *producers*,
"market cap" becomes *lifetime kWh delivered*, the *Fear & Greed Index* becomes
the *Green Index*, exchanges become *hubs*, and the trading pair becomes an
*offer*.

## Tech Stack

- **Framework:** Next.js 16 (App Router, TypeScript)
- **Database:** PostgreSQL 16 + Prisma ORM
- **Cache:** Redis 8 (ioredis)
- **Auth:** Auth.js v5 (Google + GitHub + Telegram Login Widget) — wired in Phase 2
- **UI:** shadcn/ui + TailwindCSS 4
- **i18n:** next-intl (`en`, `ru` shipped — more languages planned)
- **Bot:** grammy (Telegram)
- **Process manager:** PM2
- **Reverse proxy:** Nginx

## Local Development

### Prerequisites

- Node.js 22+
- PostgreSQL (local DB: `poolwatt_dev`)
- Redis

### Setup

```bash
# Install dependencies
npm install

# Create local env file
cp .env.example .env.local
# Edit .env.local with your credentials

# Run database migrations (Phase 2+; Phase 1 reads mock data and works without DB)
npm run db:migrate

# Start the dev server
npm run dev
```

Open <http://localhost:3000> — it redirects to `/en`. The landing page renders
the producer ranking from mock data in [`src/lib/producers.ts`](src/lib/producers.ts);
no DB is required in Phase 1.

### Telegram bot

```bash
# In a separate shell, after setting TELEGRAM_BOT_TOKEN in .env.local
npm run bot:dev
```

The bot understands these commands (see [`bot/commands.ts`](bot/commands.ts)):

| Command                       | Purpose                                |
| ----------------------------- | -------------------------------------- |
| `/start`, `/help`             | Welcome / command list                 |
| `/producers`                  | Top 10 producers right now             |
| `/producer <handle>`          | Full profile for one producer          |
| `/grid`                       | Network-wide live stats                |
| `/greenindex`                 | Current Green Index reading            |
| `/watch <handle>`             | Add to watchlist (Phase 2 persists)    |
| `/unwatch <handle>`           | Remove from watchlist                  |
| `/buy <handle> <kwh>`         | Open offer-to-buy (preview-only in P1) |
| `/listing`                    | Link to household onboarding form      |
| `/whoami`                     | Show your Telegram user id             |

### Admin bootstrap (Phase 2)

```bash
npm run grant-admin -- --email your@email.com
# or by Telegram ID:
npm run grant-admin -- --telegram 12345678
```

## Environment Variables

See [`.env.example`](.env.example). Key vars:

| Variable               | Description                                  |
| ---------------------- | -------------------------------------------- |
| `DATABASE_URL`         | PostgreSQL connection string                 |
| `REDIS_URL`            | Redis connection string                      |
| `NEXTAUTH_URL`         | Public URL of the web app                    |
| `NEXTAUTH_SECRET`      | Random 32-byte secret                        |
| `TELEGRAM_BOT_TOKEN`   | Telegram bot token from @BotFather           |
| `BOT_ADMIN_USER_IDS`   | Comma-separated Telegram ids with sudo verbs |
| `ADMIN_WHITELIST`      | Comma-separated admin identities             |
| `GRID_REFRESH_SEC`     | Snapshot refresh cadence (default 60)        |
| `WEATHER_API_KEY`      | Used by the grid worker (Phase 2)            |

## Project Structure

```
src/
├── app/
│   ├── [locale]/
│   │   ├── layout.tsx        # navbar + footer + i18n provider
│   │   └── page.tsx          # home: hero + grid-stats + producer table
│   ├── globals.css           # Tailwind v4 + Poolwatt palette
│   └── layout.tsx            # html/body wrapper + fonts
├── i18n.ts                   # next-intl request config
├── middleware.ts             # locale prefix middleware
├── components/
│   ├── grid-stats-hero.tsx   # network-wide stats card
│   ├── producer-list-client.tsx
│   ├── producer-row.tsx
│   ├── producer-card-mobile.tsx
│   ├── source-badge.tsx      # solar/wind/hydro pill
│   ├── state-of-charge.tsx   # battery gauge widget
│   ├── sparkline.tsx
│   ├── navbar.tsx
│   ├── footer.tsx
│   └── locale-switcher.tsx
└── lib/
    ├── locales.ts
    ├── prisma.ts, redis.ts
    ├── currency.ts, format.ts
    ├── producers.ts          # types + mock fleet
    ├── green-index.ts        # Poolwatt's analog of Fear & Greed
    └── snapshot.ts           # readers — DB/Redis-backed in Phase 2

bot/                          # Telegram bot (grammy)
├── index.ts
├── commands.ts
├── format.ts
└── config.ts

prisma/
└── schema.prisma             # User, Producer, ProducerSnapshot,
                              # Hub, Offer, Contract, ProducerRequest, …

messages/
├── en.json
└── ru.json
```

## Roadmap

- **Phase 1 (current):** Scaffold, mock data, landing page, Telegram bot stub.
  - [x] **Build-request cabinet (V1)** — homeowner files solar/wind requests at `/me/build-requests`; admin triages at `/admin/build-requests`. See `docs/superpowers/specs/2026-05-30-build-request-cabinet-design.md`.
  - [x] **Contractor cabinet (V2a)** — homeowner registers a contractor company at `/me/contractor`; admin triages at `/admin/contractors`. See `docs/superpowers/specs/2026-05-30-contractor-cabinet-v2a-design.md`.
  - [x] **Public contractor listing (V2b)** — `/contractors` directory + homepage block of newest approved contractors. See `docs/superpowers/specs/2026-05-30-contractor-public-listing-v2b-design.md`.
  - [x] **Contractor EV charging extension** — optional EV charging questionnaire on the contractor profile; ⚡ badge + `?ev=true` filter on `/contractors`. See `docs/superpowers/specs/2026-05-30-contractor-ev-charging-design.md`.
- **Phase 2:** Prisma migrations, real producer fleet seeded from partner
  aggregators, Redis-backed snapshots, grid worker (60s/5min/30min cadences),
  Auth.js v5 wired (Google + GitHub + Telegram).
- **Phase 3:** Per-producer detail page with charts (lightweight-charts),
  offer/contract flow, wallet-signed transactions in Telegram bot.
- **Phase 4:** Hubs page (Hub == aggregator/microgrid/utility), per-hub
  rollups.
- **Phase 5:** Buyer watchlist, household onboarding form, household admin
  approval queue.
- **Phase 6:** Admin panel (approve/reject requests, toggle producers,
  user-role management).
- **Phase 7:** i18n polish (es, de, fr, pt-BR, zh-CN, ja, ko, tr), SEO,
  performance.

## Deployment

Target server: `dv@77.221.159.163` (provisioned manually with passwordless
sudo + SSH key — see [`docs/deploy.md`](docs/deploy.md) for the procedure).

```bash
# On the laptop, push to main
git push origin main

# SSH to server, pull, rebuild, restart
ssh dv@77.221.159.163
cd ~/poolwatt && git pull && npm ci && npm run build
pm2 restart poolwatt-web poolwatt-worker poolwatt-bot
pm2 save
```

`ecosystem.config.js` (Phase 2) defines three PM2 processes:

- `poolwatt-web` — `npm run start`
- `poolwatt-worker` — `npm run worker:start`
- `poolwatt-bot`    — `npm run bot:start`

## Credits

Architecturally derived from [trientes](https://github.com/dvvolkovv/trientes)
— the Layer-1 cryptocurrency ledger that Poolwatt adapts for renewable energy
markets.
