# Poolwatt — Build-Request Cabinet V1 (design)

**Date:** 2026-05-30
**Scope:** Cabinet form for individuals (физическое лицо) to file a
"build me a home power station" request (solar / wind / hybrid, optional
powerbank, optional EV charger). Submitted requests land in an order
pool ("стол заказов") visible to admins. Admins manually triage and
contact installers offline.
**Out of scope:** Installer-side cabinet (V2); public anonymized listing
of requests on landing (V2); in-app inbox; photo upload; map picker;
contracts / payments; matching algorithm.
**Phase:** Phase 2 in spirit (requires DB writes from day one) but ships
on the existing Phase 1+ auth/DB stack already used by the personal
cabinet — see `2026-05-30-personal-cabinet-design.md`.

---

## 0. Roadmap context

This spec is the **homeowner side** of a two-sided marketplace:

```
V1 (this spec)   Homeowner files build request, admin triages offline
V2               Installer/EPC company cabinet
                   ├─ Self-registration with admin moderation
                   ├─ Subscribe to / claim requests from the order pool
                   └─ Profile listing on a public /installers directory
V3               Producer + EV-charger operator cabinets (separate specs)
```

V2 directly depends on V1's `BuildRequest` model; the installer cabinet
will read the same table. V3 is independent.

---

## 1. What we ship in V1

A signed-in user can:

1. **File a build request** at `/me/build-requests/new` via a 4-section form
   (what to build / where / money & timeline / contact recap).
2. **List own requests** at `/me/build-requests` with status pills.
3. **View request detail** at `/me/build-requests/[id]`.
4. **Edit a request** at `/me/build-requests/[id]/edit` — only while
   status is `OPEN`.
5. **Cancel a request** from the detail page — allowed in any status
   except `FULFILLED`.

An admin (`User.role === ADMIN`) can:

1. **Browse all requests** at `/admin/build-requests` — table with
   filters (status, country) and sort by `createdAt`.
2. **Open request detail** at `/admin/build-requests/[id]`.
3. **Change status** with an internal `adminNote` (required for
   `MATCHED` and `CANCELLED`).

Email side effects:

- New submit → email to `env.ADMIN_EMAIL` (no-op if unset).
- Status change by admin → email to owner's verified email
  (no-op if unverified or missing).

Out of scope (explicit):

- Photo upload (requires blob storage — V2).
- Assigning a specific installer (no installers in DB yet — V2).
- Public anonymized request list on landing — V2.
- In-app inbox / push — V2.
- Online contracts / payments — V2.
- Lat/lng via map picker — V2 (column exists but stays null in V1 UI).

---

## 2. Architecture

### Mode: Server Components + Server Actions, no REST

Follow the existing pattern in `src/app/[locale]/me/settings/actions.ts`
and the personal-cabinet spec: every mutation is a Server Action gated
by `auth()`. No `/api/build-requests/*` route handlers.

### Trust boundary

- `auth()` runs in every server component and every server action that
  touches `BuildRequest`. Anonymous users get redirected to login.
- Admin-only actions check `session.user.role === "ADMIN"` and throw
  on mismatch (Next.js converts to 500; surfaces as generic error).
- Owner-only actions check `request.userId === session.user.id`.

### Why no admin UI in V1 was rejected

Considered email-only + CLI script for status changes — rejected because
the user-visible status on `/me/build-requests/[id]` would then be
mutable only via shell, blocking the V1 merge for anyone but the
single shell-holder. A read-only admin list + CLI was the worst of
both worlds. A minimal `/admin/build-requests` is needed regardless,
so we build it now and let V2 extend it (installer assignment, notes,
bulk actions).

---

## 3. Data model

### New Prisma model

```prisma
enum BuildRequestSource {
  SOLAR
  WIND
  HYBRID            // solar + wind combined
}

enum BuildRequestSiteType {
  PRIVATE_HOUSE
  APARTMENT_ROOF
  LAND_PLOT
  COMMERCIAL
}

enum BuildRequestRoofOrientation {
  S
  SE
  SW
  E
  W
  UNKNOWN
}

enum BuildRequestBudget {
  UNDER_5K
  FROM_5K_TO_15K
  FROM_15K_TO_30K
  FROM_30K_TO_60K
  OVER_60K
  AWAITING_QUOTE
}

enum BuildRequestTimeline {
  URGENT_1_3M
  WITHIN_YEAR
  EXPLORING
}

enum BuildRequestStatus {
  OPEN          // newly submitted, in the order pool
  MATCHED       // admin marked it as taken by an offline installer
  FULFILLED     // station built, request closed
  CANCELLED     // owner cancelled or admin invalidated
}

model BuildRequest {
  id                String                       @id @default(cuid())
  userId            String
  user              User                         @relation("BuildRequestOwner", fields: [userId], references: [id], onDelete: Cascade)

  // What to build
  source            BuildRequestSource
  peakKw            Decimal                      @db.Decimal(8, 2)
  wantPowerbank     Boolean                      @default(false)
  powerbankKwh      Decimal?                     @db.Decimal(8, 2)
  wantEvCharger     Boolean                      @default(false)
  evChargerPorts    Int?
  evPublicForSale   Boolean                      @default(false)   // intent flag for future V2 marketplace

  // Where to build
  country           String                                          // ISO 3166-1 alpha-2
  city              String
  addressLine       String
  lat               Float?
  lng               Float?
  siteType          BuildRequestSiteType
  availableAreaM2   Int?
  roofOrientation   BuildRequestRoofOrientation?                    // null when source = WIND

  // Money & timeline
  budget            BuildRequestBudget           @default(AWAITING_QUOTE)
  timeline          BuildRequestTimeline         @default(EXPLORING)
  notes             String?                      @db.Text           // max 1000 chars, validated in zod

  // Workflow
  status            BuildRequestStatus           @default(OPEN)
  adminNote         String?                      @db.Text           // internal — never shown to owner
  statusChangedAt   DateTime?
  statusChangedById String?
  statusChangedBy   User?                        @relation("BuildRequestReviewer", fields: [statusChangedById], references: [id])

  createdAt         DateTime                     @default(now())
  updatedAt         DateTime                     @updatedAt

  @@index([userId, createdAt])
  @@index([status, createdAt])
  @@index([country, status])
}
```

### User additions

```prisma
model User {
  // ...
  phone                  String?                                  // E.164, optional, settable in /me/settings
  buildRequests          BuildRequest[] @relation("BuildRequestOwner")
  reviewedBuildRequests  BuildRequest[] @relation("BuildRequestReviewer")
}
```

`phone` lives on `User` (not on `BuildRequest`) because it's profile data
reused across requests. Required at submit time — see §4 form layout.
Validation: optional E.164 format `/^\+[1-9]\d{6,14}$/`. Existing
`/me/settings` page gets a new field + save handler (small additive
change to `me/settings/actions.ts`).

### Validation (zod, in `src/lib/build-request-schema.ts`)

- `peakKw`: 0.5–500, two decimals
- `powerbankKwh`: required iff `wantPowerbank`, 1–500
- `evChargerPorts`: required iff `wantEvCharger`, 1–10 integer
- `evPublicForSale` only allowed if `wantEvCharger`
- `country`: ISO-2, regex `/^[A-Z]{2}$/`
- `city`: 1–80 chars
- `addressLine`: 1–200 chars
- `availableAreaM2`: 0–100000
- `roofOrientation`: required iff `source ∈ {SOLAR, HYBRID}`
- `notes`: 0–1000 chars

---

## 4. Routes & UI

### Owner-facing

| Route | Type | Notes |
|---|---|---|
| `/[locale]/me/build-requests` | server component | List of own requests, status pills, "+ New request" button |
| `/[locale]/me/build-requests/new` | server component + form | 4-section form; submits via `createBuildRequest` server action |
| `/[locale]/me/build-requests/[id]` | server component | Detail view; "Cancel" button visible unless `FULFILLED` |
| `/[locale]/me/build-requests/[id]/edit` | server component + form | Same form; only renders if status is `OPEN`, else redirects to detail |

### Admin-facing

| Route | Type | Notes |
|---|---|---|
| `/[locale]/admin/build-requests` | server component | Table; filters via `searchParams` (status, country); paginated 50/page |
| `/[locale]/admin/build-requests/[id]` | server component | Owner contact info + full request + status-change form |

### Layout integration

- `me/layout.tsx` gets a new sidebar item `🔧 Build requests` between
  `★ Favorites` and `⚙ Settings`. Translation key
  `cabinet.sidebar.buildRequests`.
- New `admin/layout.tsx` mirrors `me/layout.tsx` but with admin sidebar
  (`🔧 Build requests` only in V1). Server-side check
  `session.user.role === "ADMIN"`, else 404 (not 403 — don't reveal
  the route exists).

### Form layout

Single-page, 4 collapsible sections, sticky submit bar:

1. **Что строить** — source radio, peak kW input, powerbank checkbox
   (reveals kWh input), EV-charger checkbox (reveals ports + public-sale
   sub-checkbox)
2. **Где строить** — country dropdown, city, address, site-type radio,
   area input, roof orientation (hidden if `source === WIND`)
3. **Деньги и сроки** — budget radio, timeline radio, notes textarea
4. **Контакт** — read-only recap of `user.name` / `user.email` / `user.phone`;
   if phone or name missing, the submit button is disabled with an inline
   link to `/me/settings` to add them. Email is optional (not all V1 users
   have one — see personal-cabinet spec); if missing, installer reaches
   the owner by phone only.

Client-side validation echoes zod. Server is the source of truth.

---

## 5. Lifecycle

```
                    ┌────── (admin) ──────► MATCHED ──── (admin) ──► FULFILLED
                    │                          │
   OPEN ────────────┤                          │
   ▲                │                          │
   │                └──────────────────────────┴──── (owner | admin) ──► CANCELLED
   │
(can edit while OPEN; transition allowed only forward, no reopening)
```

- **`OPEN → MATCHED`**: admin only, requires `adminNote` (who they
  contacted, expected response date).
- **`MATCHED → FULFILLED`**: admin only, optional `adminNote`.
- **`* → CANCELLED`** (except from `FULFILLED`): owner or admin. If
  admin, requires `adminNote`.
- **No reopening.** A new request must be filed.

Owner edit gate:
- Editable only while `status === OPEN`.
- After MATCHED, edit form redirects to detail page (don't blow up;
  show inline notice "This request is being processed and can no
  longer be edited").

---

## 6. Server Actions

In `src/app/[locale]/me/build-requests/actions.ts`:

```ts
"use server";

createBuildRequest(input: BuildRequestInput): Promise<{ id: string }>
  // auth + zod, insert with status OPEN, fire admin email, return new id

updateBuildRequest(id: string, input: BuildRequestInput): Promise<void>
  // auth + owner check + status === OPEN gate + zod, update

cancelBuildRequest(id: string): Promise<void>
  // auth + owner check + status !== FULFILLED, set CANCELLED
```

In `src/app/[locale]/admin/build-requests/actions.ts`:

```ts
"use server";

adminSetBuildRequestStatus(
  id: string,
  status: BuildRequestStatus,
  adminNote?: string,
): Promise<void>
  // role ADMIN gate, validate transition, validate adminNote presence per rule above,
  // update status + statusChangedAt + statusChangedById, fire owner email
```

All actions use `revalidatePath` to refresh list/detail views.

---

## 7. Notifications (Resend)

Reuse `src/lib/resend.ts` (already wired for verification + password reset).

### New email templates in `src/lib/email-templates/`

- `buildRequestNew.ts` — to admin. Subject:
  `[Poolwatt] New build request #<short-id> — <source> <peakKw>kW, <country>`
  Body: summary table + link to `/admin/build-requests/[id]`.
- `buildRequestStatusChanged.ts` — to owner. Subject:
  `[Poolwatt] Your build request #<short-id> is now <STATUS>`
  Body: status + (optional, owner-safe) message. Link to detail page.
  Localized via `getTranslations(user.preferredLocale)`.

### Failure modes

- Resend failure is logged but does **not** roll back the DB write.
  A failed admin notification doesn't punish the user; admin can
  always check `/admin/build-requests` directly.
- Missing `env.ADMIN_EMAIL`: log warn, skip send, succeed.
- Owner email unverified: skip send, succeed.

---

## 8. i18n

All user-visible strings in `messages/<locale>.json`, namespace
`cabinet.buildRequest.*`:

```
cabinet.buildRequest.title
cabinet.buildRequest.new.title
cabinet.buildRequest.new.section.what
cabinet.buildRequest.new.section.where
cabinet.buildRequest.new.section.money
cabinet.buildRequest.new.section.contact
cabinet.buildRequest.field.source.*
cabinet.buildRequest.field.siteType.*
cabinet.buildRequest.field.roofOrientation.*
cabinet.buildRequest.field.budget.*
cabinet.buildRequest.field.timeline.*
cabinet.buildRequest.status.OPEN | MATCHED | FULFILLED | CANCELLED
cabinet.buildRequest.action.submit | save | cancel | edit | back
cabinet.buildRequest.error.*
admin.buildRequest.*
```

**Locale strategy:** ship **EN + RU + SK** translated at merge.
Remaining 26 locales fall back to EN (next-intl auto-fallback) and
are filled in a follow-up MR. This is consistent with the news-block
spec's locale rollout.

---

## 9. Testing

### Unit (vitest)

- `src/lib/build-request-schema.test.ts` — zod schema: every conditional
  branch (powerbank requires kWh, EV requires ports, wind suppresses
  roof orientation, etc.)

### Integration (vitest + Prisma against test DB)

- `actions/createBuildRequest.test.ts` — happy path, auth missing,
  invalid input
- `actions/updateBuildRequest.test.ts` — owner-only, status-gate
- `actions/cancelBuildRequest.test.ts` — status-gate (cannot cancel
  FULFILLED)
- `actions/adminSetBuildRequestStatus.test.ts` — role gate, state
  machine valid/invalid transitions, adminNote requirement

### E2E (Playwright, `npm run test:e2e`)

- `e2e/build-request-flow.spec.ts`:
  - Register + login as owner
  - Navigate to `/me/build-requests/new`
  - Fill all required fields → submit → land on list with new row
  - Open detail → status is `OPEN`
  - Logout, login as a seeded admin user
  - Open `/admin/build-requests` → see the row
  - Set status to `MATCHED` with adminNote → owner detail page shows
    `MATCHED` after relogin

Same gotcha as other e2e tests: requires `poolwatt-web` on :3000 and
uses system Chrome (`channel: "chrome"`).

---

## 10. Migration & deployment

- Single Prisma migration `add_build_request`. Adds enums + `BuildRequest`
  + `User` relations + nullable `User.phone` column.
- No data backfill needed (new table; new column is nullable).
- Env var `ADMIN_EMAIL` documented in `.env.example`. Server
  `.env.local` updated separately (per the CLAUDE.md deploy gotcha — never
  rsync `.env.local`).
- Seeding: optional `prisma/seed-admin.ts` script that sets
  `role = ADMIN` for a username passed via CLI. Used once on prod
  to grant the first admin.

---

## 11. Open questions deferred to V2

- Should public anonymized requests appear on the landing page as
  social proof ("3 new homeowners want solar this week")? Probably
  yes — V2 spec.
- Installer-side "claim this request" flow — V2 spec.
- Auto-matching by region — V3 idea, not committed.
- Photo upload — V2 spec; needs blob storage decision (S3 vs Vercel
  Blob vs self-hosted).
- Map picker — V2 spec; needs map provider decision (Mapbox vs
  OpenStreetMap + Leaflet, the `/navigator` route already picks one
  — reuse it).
