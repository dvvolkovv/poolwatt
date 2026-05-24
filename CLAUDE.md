@AGENTS.md

# Poolwatt — Claude playbook

Poolwatt is the energy-market sibling of
[trientes](https://github.com/dvvolkovv/trientes). The architecture is
deliberately the same shape (Next.js 16 + Prisma + Redis + grammy bot + PM2
under nginx) so patterns learned in either project transfer directly.

## Domain cheat sheet (trientes → Poolwatt)

| trientes                 | Poolwatt                                              |
| ------------------------ | ---------------------------------------------------- |
| Coin                     | Producer (a household with a renewable powerbank)    |
| CoinSnapshot             | ProducerSnapshot (SoC, 24h kWh, price, weather)      |
| GlobalStats              | GridStats                                            |
| Exchange                 | Hub (aggregator / microgrid / utility partner)       |
| Market / trading pair    | Offer (kWh × price × window)                         |
| Buyer-side trade         | Contract                                             |
| CoinRequest              | ProducerRequest (household applies to be listed)     |
| Watchlist                | Watchlist (favorite producers) + HubWatchlist        |
| Fear & Greed Index       | Green Index (% of renewable kWh in the last 24h)     |
| Price USD per coin       | Price USD per kWh                                    |
| Market cap               | Lifetime kWh delivered                               |
| 24h volume               | 24h kWh delivered                                    |

When introducing a new feature, first check whether a sibling pattern exists in
the upstream trientes repo — it almost always does, and porting saves time.

## Deploy & push

The server is `dv@77.221.159.163` (Ubuntu 24.04+). It runs three PM2
processes: `poolwatt-web`, `poolwatt-worker`, `poolwatt-bot`. Deploy is `git
pull && npm ci && npm run build && pm2 restart …`. See
[`docs/deploy.md`](docs/deploy.md) for the full procedure, including the
worker stale-lib gotcha (any change under `src/lib/*` that the worker imports
needs a worker restart too — `tsx` pins lib source at boot).
