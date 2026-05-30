# Poolwatt — Personal Cabinet V1 (design)

**Date:** 2026-05-30
**Scope:** Cabinet for individual users (физическое лицо). Browse + favorite
producers/chargers, manage profile, navigate to charging stations.
**Out of scope:** Business onboarding, owner/operator dashboards (V2 + V3
in the roadmap below).
**Phase:** Crosses the Phase 1 → Phase 2 boundary in a deliberately narrow
way (see §6).

---

## 0. Roadmap context

This spec is **V1 of three**. The full trajectory:

```
V1  Personal user cabinet                    ← this spec
V2  Business onboarding                      ← next spec, after V1 in prod
      ├─ Renewable-energy producer
      ├─ Equipment manufacturer
      └─ EV-charging network operator
V3  Per-actor business dashboards            ← independent specs each
      ├─ V3a Producer dashboard
      ├─ V3b Manufacturer dashboard
      └─ V3c Charging-network dashboard
```

Sequence is mandatory: V2 depends on the auth + DB foundation from V1; V3
depends on the business-entity model from V2. Inside V3 the three
dashboards are independent and can ship in parallel.

---

## 1. What we ship in V1

A signed-in individual user can:

1. **Register** with nickname + password (no email at this step).
2. **Sign in** with nickname + password.
3. **Favorite** producers and charging stations from the existing UI
   (star button on cards, map popups, detail pages).
4. **View favorites** at `/me/favorites` with two tabs (producers, chargers).
5. **Manage profile** at `/me/settings`: nickname, optional recovery email,
   password change, language / currency / theme.
6. **Recover password** by email — only available if the user has added
   one. Uses a Resend-backed magic link.
7. **Open a charger detail page** at `/[locale]/c/[id]` with full station
   info and a "Get directions" button that deep-links to the native maps
   app (Apple Maps on iOS, Google Maps elsewhere).

Out of scope: business onboarding, social features (reviews/comments),
email notifications beyond password reset, real-time producer
streaming, charger booking/payments.

---

## 2. Auth model

### Provider

Auth.js v5 (`next-auth@5.0.0-beta.31`, already in `package.json`) with a
single **Credentials provider** wired to bcrypt-hashed passwords.

Sessions are JWT-based (`session.strategy = "jwt"`) so requests don't
incur a DB lookup. The session JWT carries `{ userId, username, role,
hasEmail }`. JWT cookie is HttpOnly, SameSite=Lax, Secure (in prod).

Prisma adapter (`@auth/prisma-adapter`, already a dep) used **only for
account-linking in V2+** (OAuth providers). V1 reads/writes directly via
Prisma in our Credentials `authorize()` callback.

### Registration flow

```
POST /api/auth/register  (server action, not Auth.js endpoint)
  body: { username, password }

  validate:
    - username: 3–30 chars, [a-z0-9_-], lowercased, unique
    - password: 8–72 chars (bcrypt cap), at least one letter + one digit

  if ok:
    - hash = bcrypt.hash(password, 12)
    - create User { username, passwordHash: hash, role: USER }
    - sign user in (write JWT cookie)
    - redirect to /me?welcome=1
```

The `?welcome=1` query triggers a one-time dismissable banner
"Добавьте email для восстановления пароля" with a CTA to settings.

### Login flow

```
signIn("credentials", { username, password })

  Credentials.authorize():
    - lookup User by username
    - bcrypt.compare(password, user.passwordHash)
    - if mismatch: throw → form shows "Неверный ник или пароль"
    - if ok: return { id, username, role, hasEmail: email != null }
```

Login form lives at `/[locale]/login`; redirects to `callbackUrl` (the
page where the user clicked "Войти") or `/me/favorites` by default.

### Password recovery flow

Two stages, both **opt-in** because email is optional:

1. **Add email** (in `/me/settings`):
   - User types email → POST to server action
   - Server generates a 32-byte token, stores in `EmailVerificationToken`
     table with 1 h expiry
   - Resend sends `https://poolwatt.com/verify-email?token=…`
   - On hit, mark `user.email = pending` → `user.email` once verified,
     `emailVerified = now()`
   - Until verified, password recovery does NOT work for this email

2. **Forgot password** (on `/login` "Forgot password?" link):
   - User types nickname or email
   - If user has verified email → generate 32-byte reset token, store in
     `PasswordResetToken` with 1 h expiry; Resend sends magic link
   - If user has no email → show "У вас не указан email; восстановление
     невозможно. Свяжитесь с поддержкой через @poolwattbot"
   - Reset link `/reset-password?token=…` shows a form to enter new
     password; submission consumes the token

### Why username + password (not OAuth)

User's explicit preference. Tradeoff acknowledged:

- ✗ Less convenient than Google/Telegram OAuth
- ✗ Need to remember a poolwatt-specific credential
- ✓ Zero third-party dependency
- ✓ No identity provider can deny service
- ✓ Bot users (the `@poolwattbot` audience) often don't have Google
  ecosystem accounts — Telegram-style nicknames are familiar

V2 can add OAuth providers alongside Credentials without breaking V1
users (Auth.js makes this trivial).

---

## 3. Database

### Cutover scope

Phase 1 was strictly mock-only (`src/lib/snapshot.ts` returns mocks; no
Prisma at runtime). V1 makes a **narrow exception**:

- Add Prisma runtime usage **only** for user-owned data:
  `User`, `Account`, `Session`, `Watchlist`, `HubWatchlist`,
  `EmailVerificationToken`, `PasswordResetToken`
- Producers and chargers **stay as mocks**. `Watchlist` rows reference
  producers by their `handle` string (which is the stable mock identifier),
  not by a Prisma FK.
- `Hub` table is included in the schema but unused in V1.

This keeps Phase 2 producer / charger DB migration as a separate spec.
The `snapshot.ts` readers stay mock-backed; only `readMe()` and friends
are new and DB-backed.

### Schema changes

Existing Prisma schema needs:

```diff
 model User {
   id                String    @id @default(cuid())
   email             String?   @unique
+  username          String    @unique     // 3–30 chars, lowercased
+  passwordHash      String                 // bcrypt
   name              String?
   image             String?
   role              Role      @default(USER)
   …
+  emailVerificationTokens EmailVerificationToken[]
+  passwordResetTokens     PasswordResetToken[]
 }

+model EmailVerificationToken {
+  token     String   @id                  // hex of 32 random bytes
+  userId    String
+  email     String                         // the candidate email to verify
+  expiresAt DateTime
+  createdAt DateTime @default(now())
+  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
+  @@index([userId])
+  @@index([expiresAt])
+}
+
+model PasswordResetToken {
+  token     String   @id
+  userId    String
+  expiresAt DateTime
+  usedAt    DateTime?
+  createdAt DateTime @default(now())
+  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
+  @@index([userId])
+  @@index([expiresAt])
+}
```

`Watchlist` and `HubWatchlist` are already in the schema and used
verbatim. Their `producerId String` field becomes a producer-handle
during V1 (since real producers aren't in DB yet) — a hidden contract
documented at the model level. V2 cutover replaces this with a real FK.

### Migration

Currently the Prisma schema has never been migrated. V1 introduces the
first migration: `2026-05-30-bootstrap-personal-cabinet`. Includes:

- All Auth.js tables (User, Account, Session, VerificationToken)
- Watchlist, HubWatchlist
- EmailVerificationToken, PasswordResetToken

The producer/hub/offer/contract tables stay in the schema for V2 but
aren't part of this migration.

### Connection string

Server already has Postgres available (per CLAUDE.md infra). Connection
string lives in `.env.local` (server-only). Migration runs once on the
server via `npm run db:migrate`.

---

## 4. Cabinet shell

### Layout

New route group: `src/app/[locale]/me/`

```
me/
  layout.tsx        — sidebar + content area, gates on session
  favorites/
    page.tsx        — server component, two-tab favorites view
  settings/
    page.tsx        — server component, settings form (client child)
  page.tsx          — redirects to /me/favorites
```

`layout.tsx` does:

```tsx
const session = await auth();
if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me`);
```

So every `/me/*` page is private by construction.

### Sidebar (desktop, ≥ md)

160 px left column inside the existing 1600 px landing wrapper:

```
┌─────────────────┐
│ @nickname       │  ← clickable → /me/settings
│ (avatar)        │
├─────────────────┤
│ ★ Favorites     │
│ ⚙ Settings      │
├─────────────────┤
│ ↗ Sign out      │
└─────────────────┘
```

### Mobile (< md)

Sidebar becomes a horizontal pill row above the content:
`[★ Favorites] [⚙ Settings] [↗ Out]`

### Navbar changes

The site's main `Navbar` (already exists) replaces "Войти" with a
profile pill when logged in:

```
[ @nickname ▾ ]   ← dropdown: Кабинет / Настройки / Выйти
```

`/login` and `/register` are reachable from the navbar pill when
logged-out; logged-in users see a profile dropdown instead.

---

## 5. Favorites

### Existing schema, used verbatim

```prisma
model Watchlist {
  userId     String
  producerId String           // V1: stores producer.handle, not Prisma FK
  addedAt    DateTime @default(now())
  user       User     @relation(...)
  @@id([userId, producerId])
}
```

For chargers we introduce a parallel table (chargers aren't producers):

```prisma
+model ChargerFavorite {
+  userId    String
+  chargerId String           // stores ChargerStation.id (currently mock)
+  addedAt   DateTime @default(now())
+  user      User    @relation(fields: [userId], references: [id], onDelete: Cascade)
+  @@id([userId, chargerId])
+  @@index([userId, addedAt])
+}
```

(`HubWatchlist` exists but isn't used in V1 — hubs aren't in the user-
facing UI yet.)

### `FavoriteButton` component

Single component reused everywhere:

```tsx
<FavoriteButton kind="producer" id={producer.handle} initial={isFav} />
<FavoriteButton kind="charger"  id={charger.id}      initial={isFav} />
```

Behavior:

- Star icon, outlined when not favorited, filled in `--color-accent`
  when favorited
- On click: optimistic toggle + POST to `/api/favorites`
- Not signed in → button opens the login modal instead of POSTing
  (modal collects callback to retry the favorite after auth)
- Network failure → silent revert + sonner toast

### API

`POST /api/favorites`
- Body: `{ kind: "producer" | "charger", id: string, action: "add" | "remove" }`
- Auth: requires session
- Server action under the hood (no separate route file needed — Next 16
  Server Actions are appropriate here)

### `/me/favorites` page

Two tabs implemented as URL search-param state (`?tab=producers` /
`?tab=chargers`). Default tab = `producers`. Each tab uses the existing
list components:

- Producers tab → `<ProducerListClient rows={...} />` (same component
  the landing uses), filtered to the user's favorites
- Chargers tab → reuses charger cards from the navigator side panel,
  with the same map preview thumbnail

Empty state per tab:

```
☆ Пока ничего не добавлено
Открой [список производителей] или [навигатор] и нажми звёздочку, чтобы
сохранить производителя или зарядку сюда.
```

---

## 6. Charger detail page

### Route

New `/[locale]/c/[id]/page.tsx`. Server component, reads charger from
mock `getChargerById(id)` in `src/lib/chargers.ts` (helper exists; if
not, add one — trivial).

### Layout

```
┌─────────────────────────────────────────────┐
│ ‹ Back to navigator      [★ Favorite]       │
├─────────────────────────────────────────────┤
│ <Station name>                              │
│ <Operator badge>                            │
│ <Address>                                   │
├─────────────────────────────────────────────┤
│ [ 🧭 Build a route ]  ← deep link            │
├─────────────────────────────────────────────┤
│ Connectors                                   │
│  • CCS2 — 350 kW DC × 2                      │
│  • Type 2 — 22 kW AC × 4                     │
├─────────────────────────────────────────────┤
│ Operator info                                │
│  Website / Phone / Email / App              │
├─────────────────────────────────────────────┤
│ Map preview (smaller; tap → /navigator?…)   │
└─────────────────────────────────────────────┘
```

### "Build a route" deep-link

Client component `MapsDeepLink` does platform detection at click time
(not render time — SSR would always pick the wrong one):

| Platform | URL format |
| --- | --- |
| iOS Safari | `maps://?daddr=${lat},${lng}&q=${urlencode(name)}` |
| Android Chrome | `geo:0,0?q=${lat},${lng}(${urlencode(name)})` |
| Desktop / other | `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` |

Detection: `navigator.userAgent` match for `iPad|iPhone|iPod` → iOS;
match for `Android` → Android; else desktop.

Falls back to the Google Maps web URL if anything goes wrong — it works
everywhere.

### Navigator integration

The existing navigator's marker popup gets a "Подробнее" link to
`/c/[id]` and a `<FavoriteButton kind="charger" />`.

---

## 7. Settings page

`/me/settings`, server component with client form children.

### Sections

1. **Profile** — nickname (read-only after registration in V1; rename
   would invalidate URLs if we add public profiles in V2), avatar
   upload (stubbed for V1, returns "coming soon").
2. **Email & recovery** — current email (or "не указан"), input to add
   or change. Submitting triggers verification email. Banner here when
   email is missing.
3. **Password** — current password + new password (twice). Server
   action calls `bcrypt.compare` then re-hashes.
4. **Preferences** — language (already exists via `LocaleSwitcher`),
   currency (already exists via cookie), theme (light/dark/system,
   stored on `user.preferredTheme`).
5. **Danger zone** — "Удалить аккаунт" with type-the-nickname-to-confirm
   dialog. Cascade-deletes via Prisma.

### Server actions

Each section is its own server action under `src/app/[locale]/me/settings/
actions.ts`:

- `updateProfile(formData)`
- `addOrChangeEmail(formData)`
- `verifyEmail(token)` (called from `/verify-email`)
- `changePassword(formData)`
- `requestPasswordReset(formData)` (also called from `/login`)
- `resetPassword(token, formData)` (called from `/reset-password`)
- `deleteAccount(formData)`

Each starts with `const session = await auth()` (except `requestPassword
Reset` and `resetPassword` and `verifyEmail`, which are token-gated).

---

## 7.5. New dependencies

- `bcryptjs` (pure JS — works in serverless / next runtime)
- `resend` (Node SDK)
- `zod` is already in `dependencies` and used for validation
- `@auth/prisma-adapter` is already a dep but used only for V2+ OAuth.

`.env.local` adds:

```
RESEND_API_KEY=…
AUTH_SECRET=…                  # 32-byte random, signs JWT cookie
DATABASE_URL=postgres://…       # already implied by Prisma; promote to runtime
```

`AUTH_SECRET` must be present in prod; generation: `openssl rand -base64 32`.

## 8. New & changed files

```
prisma/
  schema.prisma                              # add username/passwordHash/tokens/ChargerFavorite
  migrations/2026-05-30-bootstrap/migration.sql

src/lib/
  auth.ts                                    # Auth.js v5 config (Credentials provider) + auth() helper
  password.ts                                # bcrypt wrapper: hashPassword, verifyPassword
  resend.ts                                  # Resend client + sendVerificationEmail / sendPasswordResetEmail
  validation.ts                              # zod schemas: username, password, email
  favorites.ts                               # readUserFavorites(userId), addFavorite, removeFavorite
  chargers.ts                                # add getChargerById helper if missing

src/app/[locale]/
  login/page.tsx                             # login form
  register/page.tsx                          # registration form
  verify-email/page.tsx                      # consumes ?token=…
  reset-password/page.tsx                    # consumes ?token=… + new-password form
  me/
    layout.tsx                               # sidebar + auth gate
    page.tsx                                 # redirect → /me/favorites
    favorites/page.tsx
    settings/page.tsx
    settings/actions.ts                      # server actions for settings
  c/[id]/page.tsx                            # charger detail
  api/auth/[...nextauth]/route.ts            # Auth.js handler

src/components/
  cabinet/sidebar.tsx
  cabinet/profile-pill.tsx                   # navbar dropdown when logged in
  cabinet/add-email-banner.tsx
  favorite-button.tsx                        # the star, used everywhere
  maps-deep-link.tsx                         # "Build a route" button
  login-form.tsx
  register-form.tsx
  settings/profile-section.tsx
  settings/email-section.tsx
  settings/password-section.tsx
  settings/preferences-section.tsx
  settings/danger-zone.tsx

src/components/navbar.tsx                    # add profile pill / sign-in branching
src/components/producer-row.tsx              # add <FavoriteButton kind="producer"/>
src/components/navigator/charger-card.tsx    # add <FavoriteButton kind="charger"/>

messages/{en,ru,sk,…}.json                   # cabinet + auth strings (29 locales)
```

---

## 9. Error handling

| Failure                                  | Behaviour                                                 |
| ---------------------------------------- | --------------------------------------------------------- |
| Invalid login                            | Form-level error "Неверный ник или пароль"                |
| Nickname taken on registration           | Inline error "Этот ник уже занят"                         |
| Password too short / weak                | Inline error                                              |
| Favorite toggle network failure          | Optimistic revert + sonner toast                          |
| Star clicked while logged-out            | Open login modal with callback to retry favorite          |
| Forgot password, no email on file        | Form shows: "У вас не указан email; восстановление невозможно. Свяжитесь с поддержкой через @poolwattbot." |
| Email verification token expired         | Verification page shows "Ссылка устарела, запросите заново" |
| Password reset token expired             | Reset page shows same                                      |
| Resend (email provider) outage           | Server logs + user sees "Не удалось отправить письмо. Попробуйте позже." |
| Charger ID not in mock                   | 404 page                                                  |
| Maps deep-link fails on click            | Fallback to Google Maps web URL                           |

---

## 10. Testing

### Unit (vitest)

- `validation.ts`: nickname regex, password rules, email regex (against
  edge cases — unicode, very long, common typos)
- `bcrypt.ts`: hash round-trip, wrong password returns false
- `favorites.ts`: add / remove / read with prisma-mock

### Integration / E2E (Playwright, system Chrome)

Spec `tests/e2e/cabinet.spec.ts`:

1. Register → land on `/me?welcome=1` → banner visible
2. Dismiss banner → reload → banner not visible
3. Add producer to favorites from landing → /me/favorites shows it
4. Add charger to favorites from /c/[id] → /me/favorites shows it
5. Click "Build a route" → window.location set to Google Maps URL
6. Add email → verify token from DB → email becomes verified
7. Forgot password without email → form shows "no email" message
8. Forgot password with email → reset → log in with new password
9. Delete account → user gone, favorites gone, redirect to home

### Manual smoke on prod

After deploy:
- Register new test user, add 1 producer + 1 charger
- Verify favorites page shows both
- Build route on iPhone Simulator → Apple Maps opens
- Build route on Android emulator → Google Maps opens
- Build route on desktop Chrome → Google Maps web

---

## 11. Risks & mitigations

| Risk                                                       | Mitigation                                                 |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| Forgotten password with no email = lost account            | Welcome banner + persistent settings banner; documented on registration form. |
| Phase 1 mock cutover bleeds into V1 (scope creep)          | §3 explicitly forbids it. Producers / chargers stay mock. Only user-owned tables move to DB. |
| Auth.js v5 still beta — API churn                          | Pin exact version; quarterly review of release notes. |
| Resend free tier limit (3 k/month)                         | V1 traffic far below this. Upgrade path documented. |
| `Watchlist.producerId` stores `handle` not real FK         | Cutover spec (V2 / later) must rename column or maintain shim. Documented as known migration step. |
| Username squatting (anyone can grab "admin", "support")    | Reserve a small allowlist of forbidden nicks in `validation.ts`. |

---

## 12. Acceptance criteria

1. Anonymous visitor sees current landing unchanged; navbar still works.
2. `/register` accepts ник + пароль, creates user, signs in.
3. `/login` accepts ник + пароль, signs in, redirects.
4. Logged-in user sees profile pill in navbar; click → dropdown with
   Кабинет / Настройки / Выйти.
5. Star button on producer row / charger marker / charger detail —
   immediate visual feedback, survives reload.
6. `/me/favorites` lists user's favorited producers and chargers.
7. `/me/settings` lets user add email; verification email arrives;
   clicking link sets `emailVerified`.
8. `/me/settings` lets user change password; old password required.
9. "Forgot password" with verified email triggers reset email; reset
   link sets new password.
10. `/c/[id]` shows full charger info; "Build a route" deep-links to
    native maps on iOS / Android / desktop fallback.
11. Account deletion cascades favorites and signs the user out.
12. Anonymous click on star opens login modal; after auth, original
    favorite is added.
13. 12 unit + 9 e2e tests pass; manual smoke passes on prod.

---

## 13. Explicit out-of-scope

- Business onboarding and per-actor business dashboards (V2 + V3)
- Producer / charger / hub DB cutover (separate spec, scheduled to land before V2 so business onboarding can write to real producer rows)
- Social: producer reviews, comments, ratings
- Public profiles (`/u/<nickname>` pages)
- Avatar upload (stubbed)
- Email notifications beyond verification + password reset
- 2FA / passkeys
- Linking OAuth providers to existing accounts
- Mobile push notifications
- Real-time data (no streaming SoC, no live charger occupancy)
