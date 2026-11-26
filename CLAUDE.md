@AGENTS.md

# Poolwatt — Claude playbook

Poolwatt is the energy-market sibling of
[trientes](https://github.com/dvvolkovv/trientes). The architecture is
deliberately the same shape (Next.js 16 + Prisma + Redis + grammy bot + PM2
under nginx) so patterns learned in either project transfer directly.

## Active assignment: the TZ

The owner wants the whole TZ delivered. It is the default job: "продолжай",
"дальше", "делай остальное" mean the TZ, not some other plan with open boxes.

- Requirements: `inbox/Poolwatt__ТЗ_на_биржу_листинг_и_платежную_систему.md`
  (54 sections, 55 user stories), limits in the two legal plans next to it.
- Progress: `inbox/TZ-STATUS.md`. It is the only source of truth: read it first,
  update it last. Both stay out of git, because the repo is public: do not copy
  TZ text into commits, docs or code beyond section and story numbers.

Every run:

1. Take the first block in the tracker that is neither finished nor waiting for
   the owner. One block per run, or a part of one that can be finished.
2. Follow the skills: brainstorming → spec → writing-plans → TDD →
   verification-before-completion. When brainstorming needs the owner, send one
   message with numbered questions and a recommendation for each, write them to
   the tracker, and move on to the next unblocked block.
3. Commit after every green step. A run is killed at `CLAUDE_TIMEOUT_MS` and
   leaves behind whatever was not committed.
4. A story is done when every acceptance criterion in the TZ is met through what
   a person of that role really uses (a page, a notification, a file), checked on
   a running build. An endpoint without a page is "частично".
5. Never stand in for the outside world in production: no invented IBANs, cards,
   KYC results, prices or licences. Build such features behind a switch in
   `src/lib/exchange/gates.ts` that is closed by default, mark the story
   "ждёт владельца" and say what is needed. Only the owner opens a switch.
6. Anything that moves money or energy: `Idempotency-Key`, one transaction, an
   AuditLog entry, and a test for the concurrent case.
7. Tests only against the throwaway database (see Known gotchas), and the whole
   suite with e2e before a deploy.
8. Tick the boxes of a plan as you go.
9. Finish with a report: what is done and how it was checked, what is next, what
   you need from the owner. Audio reports are not committed (`*.mp3` is ignored).

## How to report to the owner

**Everything you say to the owner is in Russian. Always, without exception.**
The owner repeated this on 2026-11-26: never report in English — not a status
line, not a summary, not a one-word answer, not a commit explanation in chat.
Every message in the conversation and every Telegram reply is Russian text (plus
the two audio files, RU + SK). Code, commit messages, file names and skill
output stay as they are; the words addressed to the owner do not.

The owner asked for this explicitly (2026-11-24): keep going through the queue
one task at a time, and **report after every finished task**, not only at the
end of the run.

- Plain words, no tables, no jargon, no code in the report. Tell it like you
  would tell a person over the phone: what you just finished, and what is left
  to do next.
- Short. A few sentences per finished task is enough.
- Always say what remains in the queue after this task, and what you need from
  the owner if anything.
- Russian text always, plus the two audio files (RU + SK), as the bot-response
  rules below require. English is never acceptable.
- Then move on to the next task without waiting for an answer, unless the task
  is blocked on the owner.

Other Claude sessions deploy from this directory too. Before `git add -A`, look
at `git status` and leave alone what you did not change.

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
| PM2 processes           | `poolwatt-web`, `poolwatt-worker`, `poolwatt-realtime`, `poolwatt-bot` — all four in `ecosystem.config.js` |
| Phase                   | 1 — landing renders mock data; no DB yet                |

## Deploy & push — "the server IS production"

Same model as the reference trientes: the `/home/dv/poolwatt/` checkout on the
box **is** the live production box, not a clone. No separate deploy step over
the wire; processes serve straight from this directory via PM2.

```bash
# From the laptop: edit code locally, then sync + commit + push in one round-trip.
# CRITICAL: --exclude='.env*' — the server's .env.local has runtime secrets
# (bot whitelist, auth tokens, OAuth-related config) that DO NOT exist on the
# laptop. Without these excludes, --delete will nuke them.
rsync -az --delete \
  --exclude='node_modules' --exclude='.next' \
  --exclude='.env' --exclude='.env.local' --exclude='.env.local.bak' \
  --exclude='var' --exclude='inbox' \
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

## Taler ID login

Sign-in and registration with Taler ID (OpenID Connect) next to nickname +
password. Design: `docs/superpowers/specs/2026-11-24-talerid-login-design.md`.

- Code: `src/lib/talerid/` (provider, linking rules), wired in `src/lib/auth.ts`.
  No PrismaAdapter; no provider tokens are stored.
- Keys: `TALERID_CLIENT_ID`, `TALERID_CLIENT_SECRET` in `.env.local`. The client
  is managed at https://talerid.io/developers/, redirect URI
  `https://poolwatt.com/api/auth/callback/talerid`.
- `User.passwordHash` is nullable: accounts created through Taler ID have none.
- Accounts are never linked by email, only from settings by the signed-in user.
  Accounts hold exchange wallets, so keep it that way.
- nginx redirects `www.poolwatt.com` to the apex. Without it a flow started on
  www loses its state cookie, because callbacks always go to `NEXTAUTH_URL`.

## Common ops

```bash
ssh dv@77.221.159.163 'pm2 status'
ssh dv@77.221.159.163 'pm2 logs poolwatt-bot --lines 50 --nostream'
ssh dv@77.221.159.163 'pm2 restart poolwatt-bot'

# After lib changes that the worker imports — restart the worker too,
# else tsx serves stale lib (worker pins source at boot).
ssh dv@77.221.159.163 'pm2 restart poolwatt-bot poolwatt-worker'

# After ANY change to a Next.js page / layout / server action /
# component / i18n message — REBUILD before restarting the web
# process. `npm start` is `next start` (serves pre-built `.next/`),
# so `pm2 restart poolwatt-web` alone serves stale code. Curl smoke
# checks may pass by coincidence (mock and DB data overlap).
ssh dv@77.221.159.163 'cd ~/poolwatt && npm run build && pm2 restart poolwatt-web'

# §15 WebSocket channels run in their own process (Next.js serves no
# upgrades). nginx proxies /ws to 127.0.0.1:3101; the process only fans out
# what the web process publishes on Redis, so restart it after changes to
# src/lib/exchange/realtime.ts.
ssh dv@77.221.159.163 'pm2 restart poolwatt-realtime'
ssh dv@77.221.159.163 'curl -s http://127.0.0.1:3101/health'
```


## iOS builds (via the Mac at home)

This server cannot build iOS apps (Linux). For iOS work, drive the Mac at
home through a reverse SSH tunnel that the Mac holds open (LaunchDaemon
`com.poolwatt.tunnel.powerbank` on the Mac forwards `127.0.0.1:2222` here
to mac:22). A `~/bin/mac-ios` wrapper SSHes back through that tunnel and
invokes a fastlane lane on the Mac:

```bash
/home/dv/bin/mac-ios --lane build_sim            # ~2 min — simulator smoke + unit tests
/home/dv/bin/mac-ios --lane release_testflight   # ~5 min — signed IPA → TestFlight
```

Both commands block until the lane finishes and inherit its exit code. On
success, `release_testflight` returns immediately after upload — TestFlight
processing (5–15 min) happens server-side at Apple. The user sees the build
in their TestFlight app once Apple finishes processing.

**A processed build is not yet an installable one.** `upload_to_testflight`
answers nothing about export compliance, so a build lands as
`processingState=VALID` but `internalBuildState=MISSING_EXPORT_COMPLIANCE`,
and then *no* tester can install it — the invitation endpoint refuses with
`NO_INSTALLABLE_BUILDS` and TestFlight shows the tester an empty app list.
Build 1.0 (4) sat like that from 2026-11-25 until 2026-11-26. `Info.plist` in
the iOS repo now carries `ITSAppUsesNonExemptEncryption = false` (the shell
only speaks HTTPS through the system stack), which answers it at upload time.
After any upload, check the state rather than trusting `VALID`:

```bash
# on the Mac, with ~/.poolwatt-ios-secrets/credentials.env sourced
bundle exec ruby -e 'require "spaceship"; …'   # GET /v1/builds?include=buildBetaDetail
```

Ready means `internalBuildState=IN_BETA_TESTING`. Testers live in the
`Internal` group (`hasAccessToAllBuilds=true`, so every build reaches them);
adding one is a POST to `v1/betaTesters` with a `betaGroups` relationship, and
the invitation mail is a separate POST to `v1/betaTesterInvitations`.

If `mac-ios` returns SSH-level errors (`Connection refused`, `timeout`),
the reverse tunnel is down. Ask the user to check
`~/Library/Logs/poolwatt-tunnel-powerbank.log` on the Mac.

Source of truth: the iOS project lives in `/Users/aleksandrswiss/poolwatt-ios/`
on the Mac (separate repo). Since 2026-11-25 it is a **Capacitor shell** over
`https://poolwatt.com/app`, not a SwiftUI app — the old single-screen SwiftUI
producer list is still in that repo's history on `main`, the shell lives on
`capacitor-shell`. Consequences:

- `ios/App/App.xcodeproj` is committed source now (it carries the build
  settings and the build number fastlane increments); the xcodegen
  `project.yml` flow is gone.
- Both lanes run `npx cap sync ios` first. A change to the web app needs no
  iOS build at all — the shell loads the live site.
- `bin/build` on the Mac pins `/opt/homebrew/opt/ruby/bin` onto PATH. `bash
  -lc`, which `mac-ios` uses, otherwise resolves Apple's system Ruby 2.6,
  which cannot run a modern bundler — the whole pipeline was dead from a
  Homebrew Ruby upgrade until this was pinned.


## Android builds (on this server)

Unlike iOS, Android builds run directly on this Linux server — no Mac
involvement. A Capacitor app at `~/poolwatt-android/` wraps the live
`https://poolwatt.com` website in a WebView. The build produces a
debug-signed APK that is published to the existing nginx hostname.

```bash
/home/dv/bin/android-build                # build + publish (default)
/home/dv/bin/android-build --no-publish   # build only, no copy to /downloads/
```

The script prints the latest and versioned download URLs on success. On
failure it prints the last Gradle stderr — pass straight to Telegram.

Always invoke with the absolute path. The bot's `claude -p` is
non-interactive and does not load `~/.profile`, so `~/bin` is not on
PATH (same lesson as `mac-ios` in the iOS section above).

Downloads land at:
- `https://poolwatt.com/downloads/poolwatt.apk` — always latest
- `https://poolwatt.com/downloads/poolwatt-build-<N>.apk` — versioned
- `https://poolwatt.com/downloads/` — autoindex listing all builds

Builds keep on disk the newest 20 versioned APKs (~80 MB ceiling since
each APK is ~4 MB).

The script runs `npx cap sync android` before gradle. Until 2026-11-25 it did
not, so a changed `capacitor.config.json` or `www/` never reached the APK:
gradle reported every task `UP-TO-DATE` and published the previous shell. If an
APK ever behaves like an older build, check that the sync step is still there.

Source of truth: `~/poolwatt-android/` (its own git repo on this server).
Spec + plan in this repo at `docs/superpowers/specs/2026-05-25-android-build-pipeline-design.md`
and `docs/superpowers/plans/2026-05-25-android-build-pipeline.md`.

## Known gotchas

- **`npm install` in this shell drops devDependencies.** The shell `claude`
  runs in exports `NODE_ENV=production`, so plain `npm install <pkg>` prunes
  vitest, playwright and the rest, and the next test run dies with
  `Cannot find module 'vitest/config'`. Always
  `NODE_ENV=development npm install …`, and run a plain
  `NODE_ENV=development npm install` to repair a tree that was already pruned.

- **MQTT telemetry.** A local mosquitto on `127.0.0.1:1883` carries §4/US-03
  readings; config in `/etc/mosquitto/conf.d/poolwatt.conf`, switched on for
  the worker by `MQTT_URL` in `.env.local`. The broker is transport only — the
  asset identity is the telemetry key inside each message
  (`src/lib/exchange/mqtt-telemetry.ts`), so anonymous local publishing is
  safe. Smoke test:

  ```bash
  mosquitto_pub -h 127.0.0.1 -t "poolwatt/v1/assets/<assetId>/readings" \
    -m '{"key":"pwt_…","intervalStart":"2026-11-24T14:45:00.000Z","energyKwh":4.125}'
  tail -5 /home/dv/.pm2/logs/poolwatt-worker-out.log
  ```

  Exposing it to real inverters needs TLS on 8883 and per-asset broker
  credentials — the owner's call, not ours.

- **A PM2 process can carry a stale environment forever.** `poolwatt-web`
  was started by hand long ago in a shell that had `NEXTAUTH_SECRET=CHANGE_ME`,
  and Next.js never overrides a variable that already exists in
  `process.env` — so for months the web process signed with `CHANGE_ME`
  while `.env.local` said otherwise. Nothing broke only because Auth.js v5
  prefers `AUTH_SECRET`, which was absent from that environment and therefore
  came from the file. It surfaced when the realtime process started refusing
  every ticket. All four apps are now defined in `ecosystem.config.js`;
  start them from there (`pm2 start ecosystem.config.js --only <name>`) and
  check with `pm2 env <id>` when two processes disagree about a secret.
  `poolwatt-bot` still holds the stale value — harmless, it signs nothing,
  and restarting the bot kills the `claude -p` run that is doing the work.

- **Redis is now a running dependency.** `redis-server` on
  `127.0.0.1:6379` (local only, `protected-mode yes`) carries the §15
  realtime bus: the web process `PUBLISH`es, `poolwatt-realtime`
  subscribes to `poolwatt:rt:*` and fans out to browsers. Nothing is
  stored, so a Redis restart costs at most one missed tick.

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

- **rsync --delete also eats `var/` and `inbox/`.** `var/listing-docs/` holds
  the KYB documents producers uploaded (ТЗ §4, US-01) and `inbox/` holds the
  TZ and the progress tracker. Both are gitignored and exist only on the
  server, so a sync from a laptop without `--exclude='var' --exclude='inbox'`
  destroys them — and the documents are not recoverable from git. The recipe
  in the deploy section has both excludes.

- **rsync --delete eats `.env.local`.** The laptop checkout has no
  `.env.local` (gitignored, secrets live only on the server). Without
  `--exclude='.env.local'` in the rsync recipe, every sync **wipes** the
  server's secrets — including `BOT_ALLOWED_USER_IDS` for the bot.
  Symptom: bot starts with `whitelist=(empty)` after a sync. Fix: always
  use the rsync recipe in the deploy section above; it includes the
  necessary excludes.

- **Bot is a Claude-runner.** `bot/index.ts` spawns `claude -p` on the
  server for any free-form text from whitelisted Telegram users
  (`BOT_ALLOWED_USER_IDS`). Auth is via `claude auth login` on the
  server — credentials live in `~/.claude/` under user `dv`. Sessions
  must be persisted across restarts (e.g. to a JSON file or Redis) so
  that conversation context survives `pm2 restart poolwatt-bot`. The `superpowers` plugin (`obra/superpowers`) is installed
  at user scope, so the bot's spawned claude has TDD/debugging/etc.
  skills available.

- **Playwright uses system Chrome, not bundled chromium.** Ubuntu
  26.04 ("resolute") is too new for Playwright 1.60.0's chromium
  binary matrix, so `npx playwright install chromium` fails on the
  server. We use system Google Chrome (`channel: "chrome"` in
  `playwright.config.ts`), installed via the official .deb. To run
  e2e: `ssh dv@77.221.159.163 'cd ~/poolwatt && npm run test:e2e'`.
  Tests need `poolwatt-web` (the Next.js app on :3000) to be online —
  `pm2 status` to verify before running. Once Playwright ships a
  ubuntu26 chromium build, drop `channel: "chrome"` to switch back
  to bundled chromium.

- **`npx vitest run` hits the live database unless you override it.** The
  integration tests write and delete rows (`src/lib/snapshot.test.ts`,
  `src/lib/talerid/resolve-user.test.ts`), and two things conspire to point
  them at production: the shell `claude` runs in already exports the
  production `DATABASE_URL`, and `vitest.config.ts` calls `loadEnv(mode, cwd,
  "")` — with an empty prefix vite copies all of `process.env` *over* the
  `.env*` values, so a clone without env files does not help. Always pass the
  throwaway database explicitly (shell env wins, which is exactly what we
  want here):

  ```bash
  cd ~/poolwatt
  DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local | tr -d '"' \
    | sed 's|/poolwatt?|/poolwatt_test?|')" npx vitest run
  ```

  The same shell also exports `NODE_ENV=production`, and vite copies it over
  too, so gates that refuse to open in production (`ibansOpen`) stay shut and
  two cases in `gates-flow.test.ts` / `exchange-flow.test.ts` fail for reasons
  that have nothing to do with the code. Pass `NODE_ENV=test` alongside the
  database:

  ```bash
  cd ~/poolwatt
  NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local \
    | tr -d '"' | sed 's|/poolwatt?|/poolwatt_test?|')" npx vitest run
  ```

  `poolwatt_test` lives on the same local cluster, same role. Recreate it
  with `createdb poolwatt_test`, then `npx prisma migrate deploy` and
  `npx tsx scripts/seed.ts` under the same override — unseeded, the four
  `snapshot.test.ts` cases fail. Prisma's own dotenv never overrides an
  existing variable, so the override works for the CLI too. The two
  `bot/__tests__/tts-bilingual.test.ts` cases call OpenAI for real and need a
  working `OPENAI_API_KEY`.

  The Playwright suite is different: it runs against the live `poolwatt-web`
  and the live database on purpose, and cleans up the rows it creates.

## Bot response mode

When responding via Telegram, **always send the answer as a voice/audio
message** in addition to the text reply. This applies to all inputs (text and
voice), not only voice-initiated conversations. The user interacts with Claude
through the Telegram bot and prefers audio delivery.

**Bilingual audio — always two files.** Every audio reply / status report
must be delivered as **two** MP3 files: one in Russian and one in Slovak.
The Russian file keeps the base name (e.g. `status-report.mp3`); the Slovak
sibling gets a `-sk` suffix (`status-report-sk.mp3`). For ad-hoc status
reports use `scripts/status-report-audio.ts` — it takes Russian text on
stdin or as a file path and produces **both** MP3s in one run (RU original
+ SK auto-translated via `translateToSlovak` in `bot/tts.ts`):

```bash
echo "Привет — это короткий отчёт." | \
  npx tsx scripts/status-report-audio.ts -
# → status-report.mp3 + status-report-sk.mp3
```

Telegram bot replies already emit two voice messages per reply (RU then SK)
in `bot/index.ts` — wired via `synthesizeVoice()` + `translateToSlovak()`.
Slovak TTS quirk for `gpt-4o-mini-tts`: spell `@` as `zavináč` and `.` as
`bodka` inside email addresses and dotted identifiers (e.g. `Auth.js` →
`Auth bodka js`), otherwise the model reads them in Latin pronunciation.
The translation prompt in `translateToSlovak` already enforces this.

## Design specs

When writing design specs, send the full text as a message in the conversation
(not just commit to a file). The user reads specs inline, not by opening files.

## Roadmap

See [README.md](README.md#roadmap). Currently in Phase 1 (scaffold + landing
+ bot stub). Phase 2 adds real Prisma migrations, the grid worker, and
Auth.js wiring.

## Telegram file uploads → `inbox/`

Documents sent to `@poolwattbot` are saved by the `message:document` handler
in `bot/index.ts` to `~/poolwatt/inbox/` (gitignored). The bot **does not**
run Claude on upload — a multi-file send arrives as several separate Telegram
messages, and auto-prompting per file would trip `runner.isActive` and drop
everything after the first. The user uploads, then says what to do in a text
message; look in `inbox/` at that point.

Before this handler existed, uploads were silently discarded: grammy had no
`message:document` route, so Telegram delivered the file and nothing consumed
it. If a user ever says "посмотри файл, который я отправил" and `inbox/` is
empty, check that this handler is still registered.
