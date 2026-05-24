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

## Live state (as of 2026-05-24)

| Component               | Status                                                  |
| ----------------------- | ------------------------------------------------------- |
| Server                  | `dv@77.221.159.163` — hostname `powerbank.ptr.network`  |
| OS                      | Ubuntu 24.04+, Node v22.22.2, npm 10.9.7, pm2 7.0.1     |
| Canonical checkout      | `/home/dv/poolwatt/` (push originates here, not laptop) |
| GitHub origin           | `git@github.com:dvvolkovv/poolwatt.git` (public)        |
| Telegram bot            | `@poolwattbot` — live under PM2 process `poolwatt-bot`  |
| Phase                   | 1 — landing renders mock data; no DB yet                |

## Deploy & push — "the server IS production"

Same model as the reference trientes: the `/home/dv/poolwatt/` checkout on the
box **is** the live production box, not a clone. No separate deploy step over
the wire; processes serve straight from this directory via PM2.

```bash
# From the laptop: edit code locally, then sync + commit + push in one round-trip
rsync -az --delete --exclude='node_modules' --exclude='.next' \
  -e "ssh -i ~/.ssh/id_ed25519" \
  ~/poolwatt/ dv@77.221.159.163:/home/dv/poolwatt/

ssh dv@77.221.159.163 'cd ~/poolwatt && \
  git add -A && \
  git commit -m "..." && \
  git push && \
  pm2 restart poolwatt-bot'
```

**Never push from the laptop.** The laptop's keys aren't registered with the
`dvvolkovv` GitHub account. The server's dedicated push key is
`/home/dv/.ssh/id_ed25519_github` with a matching `Host github.com` block in
`/home/dv/.ssh/config`.

## SSH

From laptop to server, always use the user's primary key:
```bash
ssh -i ~/.ssh/id_ed25519 dv@77.221.159.163
```
There is also `~/.ssh/id_ed25519_poolwatt` left over from a one-time
provisioning attempt — **don't use it**, it's not installed on the server.

## Common ops

```bash
ssh dv@77.221.159.163 'pm2 status'
ssh dv@77.221.159.163 'pm2 logs poolwatt-bot --lines 50 --nostream'
ssh dv@77.221.159.163 'pm2 restart poolwatt-bot'

# After lib changes that the worker imports — restart the worker too,
# else tsx serves stale lib (worker pins source at boot).
ssh dv@77.221.159.163 'pm2 restart poolwatt-bot poolwatt-worker'
```

## Known gotchas

- **dotenv + `.env.local`.** Standalone Node entrypoints (`bot/`, `worker/`)
  must explicitly load both files; `import "dotenv/config"` only loads
  `.env`. See `bot/config.ts` for the canonical pair-load pattern. Next.js
  itself handles `.env.local` automatically.

- **macOS tar attributes.** `tar -czf` on macOS embeds `LIBARCHIVE.xattr.*`
  attributes and `._*` AppleDouble files. When extracting on Linux you'll see
  warnings (harmless) and a clutter of `._*` files in every directory
  (`find . -name '._*' -type f -delete` to clean). Use rsync instead of tar
  for deploys to skip both issues entirely.

- **Phase 1 reads no DB.** `src/lib/snapshot.ts` returns mock data from
  `src/lib/producers.ts`. Don't add Prisma calls until Phase 2 lands — the
  shape is intentional so the landing demo runs without infra.

## Roadmap

See [README.md](README.md#roadmap). Currently in Phase 1 (scaffold + landing
+ bot stub). Phase 2 adds real Prisma migrations, the grid worker, and
Auth.js wiring.
