# Claim-your-card — design

**Status:** draft · **Date:** 2026-05-31 · **Phase:** 2

## One-line goal

Let real companies whose cards are already shown on the site — 100 producers
(`MOCK_PRODUCERS`) and ~50–200 EV-charger operators surfaced via OSM in the
navigator — verify ownership via corporate email, edit their card from a
personal cabinet, and (for producers) see and respond to incoming
BuildRequests via the existing V2d matching mechanism.

## Why now

Phase 1 closed with V2d matching: homeowners file BuildRequests, contractors
respond, both sides see contacts. That works end-to-end but assumes a single
provider type — `Contractor` — built ~from scratch by us. Yet the landing
page already shows 100 detailed cards of *real* companies (JinkoSolar, Tesla
Energy, CATL, …) and the navigator shows real EV stations from OSM (IONITY,
GreenWay, Tesla Supercharger). These companies have no way to claim, edit,
or interact with potential buyers today. Adding that capability:

1. Turns the existing landing page from a static demo into a live directory.
2. Multiplies the supply side of the BuildRequest marketplace — not just the
   ~handful of registered contractors, but every producer / OEM that wants
   to bid on residential solar/wind projects.
3. Solves the orthogonal "mock producers → real Prisma" item from the
   Phase 2 roadmap as a by-product (seeding 100 cards into the DB *is* the
   migration).

## Out of scope (V1)

| Excluded | Why | When |
|---|---|---|
| Multi-user organizations | One `claimedById` per card is enough at first. | Phase 3+ via an `OrganizationMember` model patterned on existing `ContractorMember`. |
| File upload (logos, banners) | URL fields are good enough; S3/R2 obvious follow-up. | After R5. |
| "Create a producer from scratch" UI | Floods admin queue with impostors. | Admin-only `/admin/producers/new` in R3. |
| Cabinet analytics (views, leads) | Not needed to ship the loop. | Phase 3. |
| In-app chat | mutual contact reveal + email is the V2d contract. | Maybe never — email is the contract. |
| EV-charger BuildRequests ("install a charger at my home") | New BR sub-type, big design of its own. | Future release. |
| Transfer-ownership UI | Admin can revoke + recipient re-claims. | Phase 3. |
| Removal of `MOCK_PRODUCERS` from source | Stays as seed source. | One month after R2 stable. |

## Note on Contractor (deliberately not changed)

`Contractor` already has its own registration flow (homeowner-initiated, no
seeded cards, admin-moderated approval at `/admin/contractors`). We do **not**
add domain-email claim to `Contractor` — the seeded-card-claim path is for
entities (Producer, ChargerOperator) where the card exists *before* the
company shows up. Contractors stay on the existing approval flow.

The only change to Contractor in this design is in R4: the foreign key from
`BuildRequestClaim` is replaced with a polymorphic `(providerType, providerId)`
pair, and `(CONTRACTOR, <contractorId>)` becomes the new way to reference
a contractor's claim. Backfill preserves all existing rows.

## Architecture (TL;DR)

Three new cabinets — mostly copy-paste off the working `/me/contractor`
shape — plus a polymorphic claim mechanism on `BuildRequestClaim` so any
provider type can respond to a BR.

```
Public card ─── "This is our company" ──▶ /me/claim/[entityType]/[entityId]
                                                       │
                                          corporate email at domain
                                                       │
                                            6-digit code via Resend
                                                       │
                                          Producer.claimedById = userId
                                                       │
                            ┌──────────────────────────┼──────────────────────────┐
                            ▼                          ▼                          ▼
                   /me/producer/[id]      /me/charger-operator/[id]      /me/contractor/[id]
                            │                          │                          │
                ┌───────────┼───────────┐              │                          │
                ▼           ▼           ▼              ▼                          │
              Card       Profile    BR feed         Card + stations               │
                                       │                                          │
                                       └───── BuildRequestClaim ──────────────────┘
                                          (providerType, providerId)
```

## Data model

### Producer (existing — extend)

Add to `prisma/schema.prisma`:

```prisma
enum ProducerCategory {
  ENERGY_PRODUCER       // Tesla Energy, Vestas, JinkoSolar
  EQUIPMENT_MANUFACTURER // CATL, ABB, SMA, NEXTracker
}

model Producer {
  // ... existing fields ...

  category      ProducerCategory @default(ENERGY_PRODUCER)
  equipment     String[]                       // ["Huawei SUN2000 inverters", ...]
  manufactures  String[]                       // for OEMs: ["Tiger Neo modules", ...]

  // claim
  claimedById   String?
  claimedBy     User?            @relation("ProducerClaims", fields: [claimedById], references: [id])
  claimedAt     DateTime?

  profile       ProducerProfile?

  @@index([claimedById])
}
```

### ProducerProfile (new — 1:1 to Producer)

```prisma
model ProducerProfile {
  producerId     String   @id
  producer       Producer @relation(fields: [producerId], references: [id], onDelete: Cascade)

  description    String?  @db.Text
  founded        Int?
  employees      String?     // human-readable: "~40,000"
  website        String?
  email          String?
  phone          String?
  address        String?
  ceo            String?
  stockTicker    String?
  certifications String[]
  keyProducts    String[]

  updatedAt      DateTime @updatedAt
}
```

### ChargerOperator (new)

```prisma
model ChargerOperator {
  id            String   @id @default(cuid())
  slug          String   @unique
  displayName   String
  aliases       String[]   // OSM operator/network/brand variants for matching
  description   String?  @db.Text
  websiteUrl    String?
  logoUrl       String?
  email         String?
  phone         String?

  claimedById   String?
  claimedBy     User?    @relation("ChargerOperatorClaims", fields: [claimedById], references: [id])
  claimedAt     DateTime?

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([claimedById])
}
```

### BuildRequestClaim — polymorphic

```prisma
enum ProviderType {
  CONTRACTOR
  PRODUCER
  // CHARGER_OPERATOR — not in V1
}

model BuildRequestClaim {
  // ... existing fields ...

  // REMOVED: contractorId, contractor relation
  providerType ProviderType
  providerId   String

  @@index([providerType, providerId])
}
```

Migration steps (safe rollout):

1. Add `providerType` and `providerId` as nullable columns.
2. SQL backfill: `UPDATE BuildRequestClaim SET providerType='CONTRACTOR', providerId=contractorId WHERE providerType IS NULL`.
3. NOT NULL constraints.
4. Drop FK + `contractorId` column.

Server-action signatures change: `expressInterest({ buildRequestId, providerType, providerId })` etc. Local refactor — call sites in `/me/contractor/[id]/requests` switch from passing `contractorId` to `{ providerType: 'CONTRACTOR', providerId: contractorId }`.

**Tradeoff:** Prisma cannot enforce a polymorphic FK at the DB level. We enforce existence in the server-action layer (zod validation + `prisma.findUnique` before write). Risk accepted in favor of avoiding an EAV/supertable refactor. Alternative — three nullable FKs with a CHECK constraint — was considered and rejected as more code for marginal correctness gain at our scale.

### ClaimToken (new)

```prisma
enum ClaimEntityType {
  PRODUCER
  CHARGER_OPERATOR
}

model ClaimToken {
  id          String           @id @default(cuid())
  token       String           @unique      // 6-digit code
  entityType  ClaimEntityType
  entityId    String
  email       String                          // the corporate email to verify
  userId      String                          // user who initiated the claim
  user        User             @relation(fields: [userId], references: [id])
  expiresAt   DateTime                        // now + 30 min
  consumedAt  DateTime?
  createdAt   DateTime         @default(now())

  @@index([entityType, entityId])
  @@index([userId])
}
```

## Claim flow

**Entry point:** every public card (`/p/[handle]`, `/c/[id]`) shows a
"**This is our company — claim this card**" button when the entity has no
`claimedById`. Hidden once claimed.

**Step 1 — Login.** Standard Auth.js, no changes.

**Step 2 — Submit form** at `/me/claim/[entityType]/[entityId]`:
- Single field: corporate email.
- Server validation: extract `claimantDomain` from email (the part after
  `@`), and `cardHost` from the registered hostname on the card
  (`profile.website` for producer, `websiteUrl` for charger-operator).
  Accept iff `claimantDomain === cardHost` OR `claimantDomain` ends with
  `"." + cardHost`. Example: card `tesla.com` accepts
  `ceo@tesla.com` and `sales@subsidiary.tesla.com`, but rejects
  `tesla.com.evil.com` (because `tesla.com.evil.com` does not end with
  `.tesla.com`). Strip `www.` from `cardHost` before comparison.
- If the card has no `website` value (typical for small EV operators from
  OSM): the claim button is **hidden**. Card shows a footer note:
  "No public website on file — write `admin@poolwatt.com` to claim manually."
  Manual admin claim flow tracked separately, out of scope for V1.

**Step 3 — Send code.** Create `ClaimToken { token: 6-digit code,
expiresAt: now()+30min }`, send via existing Resend helper.

**Step 4 — Verify code** at `/me/claim/[entityType]/[entityId]/verify`:
- Match `token` (case-insensitive), not expired, not consumed.
- On success: set `claimedById = userId`, `claimedAt = now()`,
  `ClaimToken.consumedAt = now()`. Audit log entry.
- Redirect to `/me/producer/[id]` (or `/me/charger-operator/[id]`).

**Step 5 — One claim per entity.** If a card is already claimed, the
button shows "Already claimed by verified owner" (no identity disclosure).

**Multi-card claimer.** `claimedById` is not unique — one user can claim
many cards (Tesla Energy producer + Tesla Supercharger operator + ...).

**Revocation.** `/admin/claims` is a minimal admin page listing claimed
entities with a "Revoke" action that nulls `claimedById` and writes an
`AdminAuditLog` entry. No "transfer" UI — recipient re-claims.

## Cabinets

### `/me/producer`

**Empty state** (no claims yet): redirect-ish CTA — "Find your company in
the [directory] and claim its card." No "create from scratch" option in V1.

**Has claims**: list of claimed Producer cards (usually 1, sometimes
several). Each links to detail.

### `/me/producer/[id]`

Four tabs, mirroring `/me/contractor/[id]` structure:

1. **Card** — edits `Producer` columns: `displayName`, `bio`, `logoUrl`,
   `bannerUrl`, `websiteUrl`, `twitterUrl`, `city/region/country/lat/lng`,
   `primarySource`, `category`, `capacityKwh`, `inverterKw`,
   `equipment[]`, `manufactures[]`. Form on left, live preview on right.
   Save → server action → `prisma.producer.update`.

2. **Profile** — edits `ProducerProfile` columns (founded, employees,
   CEO, contacts, certifications, keyProducts).

3. **BuildRequests** — `/me/producer/[id]/requests`. Direct copy of
   `/me/contractor/[id]/requests` page:
   - Open BR list with filters (location, source type, budget, timeline).
   - "Express interest" button → creates `BuildRequestClaim { providerType:
     'PRODUCER', providerId: <thisProducer> }`.
   - "My responses" section listing the producer's `BuildRequestClaim`s
     with withdraw / view-status.

4. **Settings** — change notification email, unlink claim (in case of
   wrong card).

### `/me/charger-operator/[id]`

Same shape **minus the BuildRequests tab**:

1. **Card** — edits `ChargerOperator` columns.
2. **Stations** — read-only list of OSM stations matching this operator
   via `aliases`. Each links to public `/c/[id]`.
3. **Settings** — same as producer.

### Public-UI visibility

- `/p/[handle]`: if `producer.claimedById != null` → **"✓ Verified"** badge
  next to name; the `Profile` section shows truly-edited data (instead of
  seed data).
- `/c/[id]`: if the OSM station's `operator` matches a ChargerOperator
  with `claimedById != null` → **"✓ Verified operator"** badge + an
  "About operator" panel with the claimed description, logo, contacts.
- "Claim this card" CTA hidden when the entity already has a claim.

## Seeding & migration

### Producer seed (R1)

`prisma/seed/producers.ts`:
- Reads `MOCK_PRODUCERS` from `src/lib/producers.ts` and `PRODUCER_PROFILES`
  from `src/lib/producer-profiles.ts`.
- `prisma.producer.createMany({ skipDuplicates: true })` keyed on `handle`.
- `prisma.producerProfile.createMany({ skipDuplicates: true })` for entries
  with a matching key (also idempotent — won't clobber a real owner's edits).
- Idempotent: safe to run repeatedly.

Run: `npx prisma db seed` (configured in `package.json`).

### Reader swap (R2)

`src/lib/snapshot.ts:readTopProducers()` switches from `MOCK_PRODUCERS`
to:

```ts
return prisma.producer.findMany({
  orderBy: { rank: 'asc' },
  take: 100,
  include: { profile: true },
});
```

`src/app/[locale]/p/[handle]/page.tsx` switches from `MOCK_PRODUCERS.find`
to `prisma.producer.findUnique({ where: { handle }, include: { profile: true } })`.

`MOCK_PRODUCERS` and `PRODUCER_PROFILES` stay in source as seed input; deletion
deferred until R2 is one-month stable.

### ChargerOperator seed (R5)

One-time `scripts/seed-charger-operators.ts`:
1. Overpass query with bbox covering Slovakia + Czechia + neighbors;
   extract unique `operator`/`network`/`brand` tag values from
   `amenity=charging_station` nodes.
2. Normalize (lowercase, trim, dedupe variants like
   "Tesla, Inc." / "Tesla Supercharger" → `tesla`). Slug-ify.
3. For top-30 operators by station count, hand-curate `websiteUrl` +
   `description` so the claim flow works out of the box.
4. `prisma.chargerOperator.createMany({ skipDuplicates: true })` keyed
   on `slug`.

Matching on `/c/[id]`:
```ts
const op = await prisma.chargerOperator.findFirst({
  where: { aliases: { has: charger.operator } },
});
```

### Polymorphic BuildRequestClaim migration (R4)

Four-step migration as described in the data-model section. Backwards-
compatible during R4 deploy:
1. Add columns nullable.
2. Backfill.
3. NOT NULL.
4. Drop old FK + column.

Tests: append e2e covering `expressInterest({ providerType: 'PRODUCER',
... })` end-to-end; existing contractor e2e from V2d continues to pass
unchanged.

## Release plan

Five independent, valuable-on-their-own releases:

| Release | Content | Visible to users |
|---|---|---|
| **R1** | Schema migrations + producer seed | Nothing visible (data populated, UI still reads mocks). |
| **R2** | `/p/[handle]` and landing readers switched to Prisma | Visually identical; no longer requires a code deploy to change data. |
| **R3** | Producer cabinet — claim flow + edit (no BR feed yet) | Real companies can claim cards. "✓ Verified" badges appear. |
| **R4** | Polymorphic `BuildRequestClaim` + Producer BR feed tab | Producers can respond to BRs. Marketplace supply side multiplies. |
| **R5** | ChargerOperator: seed + cabinet + claim | EV operators get their cabinet. No BR matching for them. |

Each release: separate PR, separate plan written via the writing-plans skill,
TDD by our usual pattern.

## Risks

| Risk | Mitigation |
|---|---|
| Spam claims with disposable-email domains (`@10minutemail`) that pass domain validation but are not the real company | V1: ignore (low volume). V2: disposable-domain blocklist via existing npm lib. |
| Disgruntled-employee claim (ex-Tesla employee claims after leaving) | Admin revoke. Full audit log of claim/revoke events. |
| OSM operator normalization is noisy ("Tesla Supercharger" vs "Tesla, Inc." vs "Tesla Charging") | `aliases String[]` field + hand-curation of top-30 operators in seed script. Long-tail = best effort. |
| Polymorphic FK loses DB-level integrity | Validation in server-action layer (zod + `findUnique` precheck). Acceptable tradeoff vs EAV/supertable cost. |
| Producer seed overwrites real edits on re-run | `createMany skipDuplicates: true` keyed on `handle`. Idempotent by construction. |
| Landing-page perf regression after Prisma switch (N+1 on `profile`) | `include: { profile: true }` joins in one query. Next page-cache `revalidate: 300`. 100 rows is small. |
| Corporate email goes to a generic inbox no one reads | UX copy on form: "Didn't receive? Write `admin@poolwatt.com`." Manual fallback by admin. |

## Effort estimate

| Release | Sessions | Includes |
|---|---|---|
| R1 | 1 | Schema migration, seed script, idempotency test |
| R2 | 1 | Reader swap, e2e on landing + detail |
| R3 | 2–3 | Claim flow (form, email, verify, audit), cabinet card+profile edit, e2e on claim happy path |
| R4 | 2 | Polymorphic migration, action refactor, BR feed page reuse, e2e on cross-type matching |
| R5 | 2 | OSM seed script, cabinet, claim reuse, station-list rendering |
| **Total** | **8–10** | |

Each release is a separately shippable deploy.

## Files most affected

- `prisma/schema.prisma` — all five new models / extensions
- `prisma/seed/producers.ts`, `scripts/seed-charger-operators.ts` — new
- `src/lib/snapshot.ts`, `src/app/[locale]/p/[handle]/page.tsx` — reader swap
- `src/app/[locale]/me/producer/**` — new cabinet (R3+R4)
- `src/app/[locale]/me/charger-operator/**` — new cabinet (R5)
- `src/app/[locale]/me/claim/**` — new claim flow (R3)
- `src/app/[locale]/admin/claims/page.tsx` — new revoke page (R3)
- `src/app/[locale]/me/contractor/[id]/requests/actions.ts` — refactor for
  polymorphic claim (R4)
- `messages/{en,ru,sk}.json` — copy for all new pages (R3 + R5)
