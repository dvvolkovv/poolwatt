# Poolwatt — Contractor Registration & Admin Moderation V2a (design)

**Date:** 2026-05-30
**Scope:** Cabinet flow for a user to register their company as a Poolwatt
contractor (EPC partner — design / manufacture / installation /
commissioning / maintenance of renewable energy stations). Submitted
registrations land in an admin queue for moderation. Approved
contractors are eligible for V2b public listing and V2d build-request
matching — both of which are explicitly out of scope here.
**Out of scope:** Public `/contractors` directory and homepage block (V2b);
multi-user cabinet with teammate invites and post-approval profile editing
(V2c); Contractor ↔ BuildRequest matching / claim flow (V2d); logo
upload via blob storage; client ratings / reviews; CAPTCHA;
multi-locale slugs.
**Phase:** Phase 2 — builds on the same DB / Auth.js / Resend stack
that V1 build-request cabinet established.

---

## 0. Roadmap context

This spec is **V2a** — the first of four V2 sub-projects. Sequence:

```
V2a (this spec)   Contractor registration + admin moderation
V2b               Public listing — homepage block + /contractors directory
V2c               Contractor cabinet — invite teammates, edit post-approval
V2d               Contractor ↔ BuildRequest matching / claim
```

V2b/V2c/V2d each depend on V2a's `Contractor` model. They are
independent of each other and can ship in any order. Each gets its
own spec → plan → implementation cycle.

V1 (build-request cabinet, shipped 2026-05-30, commits `cc25739` …
`04d17c7`) introduced the `BuildRequest` model + admin moderation
pattern that V2a mirrors closely.

---

## 1. What we ship in V2a

A signed-in user can:

1. **Register a contractor company** at `/me/contractor/new` via a
   3-section form (identity / what we do / contact).
2. **View own contractor(s)** at `/me/contractor` — list (typically one).
3. **View detail with status** at `/me/contractor/[id]`.
4. **Edit** at `/me/contractor/[id]/edit` — only while `PENDING`.
5. **Withdraw** (delete) own registration — only while `PENDING`.

An admin (`User.role === ADMIN`) can:

1. **Browse all contractors** at `/admin/contractors` — table with
   filters by `status`, `country`, `entityType`; sort by `createdAt`.
2. **Open detail** at `/admin/contractors/[id]` — full profile +
   owner contact info.
3. **Change status** from `PENDING` to `APPROVED` or `REJECTED` with
   a required `adminNote`.

Email side effects:

- New submit → email to `env.ADMIN_EMAIL`.
- Status change by admin → email to first OWNER member's verified email.
- Withdraw → info email to admin.

Out of scope (explicit):

- Public `/contractors` listing and homepage block — V2b.
- Teammate invites; profile editing post-approval — V2c.
- BuildRequest ↔ Contractor matching, claim, `BuildRequest.assignedContractorId`
  field — V2d.
- Logo / portfolio upload (blob storage) — V2c+.
- CAPTCHA on registration — added later if spam appears.
- Multi-locale slug — single global slug per contractor.
- Ratings / reviews from clients — future.

---

## 2. Architecture

### Mode: Server Components + Server Actions

Mirror the V1 build-request pattern (`docs/superpowers/specs/2026-05-30-build-request-cabinet-design.md`).
Every mutation is a Server Action gated by `auth()`. No REST endpoints.

### Trust boundary

- Every server component and server action that touches `Contractor`
  runs `auth()`.
- Admin-only actions check `session.user.role === "ADMIN"`.
- Owner-only actions check that the user is a `ContractorMember` of
  the target Contractor (any role is fine for view; only OWNER may
  edit/withdraw).

### Why single Contractor model (not Request + Contractor split)

Considered mirroring `ProducerRequest → Producer` (the V1 powerbank
flow), where a request is a separate entity that gets converted into
a producer on approval. Rejected because:

- The contractor's registration fields are **identical** to their public
  profile fields. A separate request model would force a 1:1 mapping
  on approval — pure code duplication with no schema gain.
- ProducerRequest exists as a separate model because powerbank
  requests carry *intent* data (`reason: String @db.Text`) and
  *operational* data (`capacityKwh`, `inverterKw`) that aren't yet
  installed; the request and the eventual Producer are different
  things. Not true for contractor registration.
- A single model with `status` lets us preserve REJECTED rows for
  appeal / history without copying data.

### Why ContractorMember (not Contractor.ownerId)

Real-world EPC companies have multiple operational users — CEO, sales,
ops. V2c will let teammates be invited. Modeling the membership as a
join table from day 1 means V2c is purely UI work, no migration.

At V2a the user creates a Contractor and gets exactly one
`ContractorMember` row with `role = OWNER`. The DB allows more — UI
just doesn't expose it yet.

---

## 3. Data model

### New Prisma enums + models

```prisma
enum ContractorEntityType {
  LEGAL_ENTITY     // ООО / s.r.o. / Ltd / a.s.
  SOLE_TRADER      // ИП / OSVČ / ФОП
  INDIVIDUAL       // физлицо без юр.статуса
}

enum ContractorWorkCategory {
  DESIGN
  MANUFACTURE
  SUPPLY
  INSTALLATION
  COMMISSIONING
  MAINTENANCE
}

enum ContractorRenewableType {
  SOLAR
  WIND
  HYDRO
  BIOMASS
  GEOTHERMAL
  HYBRID
}

enum ContractorStatus {
  PENDING
  APPROVED
  REJECTED
  SUSPENDED       // reserved for V2c (admin temporary disable)
}

enum ContractorMemberRole {
  OWNER
  ADMIN
  MEMBER
}

model Contractor {
  id                 String                       @id @default(cuid())
  slug               String                       @unique

  // Identity
  entityType         ContractorEntityType
  displayName        String                                          // "SolarCo s.r.o."
  legalName          String?                                         // full legal name; required if entityType = LEGAL_ENTITY
  registrationNumber String?                                         // IČO / EDRPOU / etc.; required if LEGAL_ENTITY or SOLE_TRADER
  country            String                                          // HQ, ISO-2
  city               String
  foundedYear        Int?

  // What they do
  workCategories     ContractorWorkCategory[]
  renewableTypes     ContractorRenewableType[]
  countriesServed    String[]                                        // ISO-2 codes

  // Public profile
  bio                String                       @db.Text           // 100–2000 chars
  websiteUrl         String?
  logoUrl            String?                                         // URL only in V2a; upload deferred to V2c+
  contactEmail       String
  contactPhone       String                                          // E.164

  // Workflow
  status             ContractorStatus             @default(PENDING)
  adminNote          String?                      @db.Text           // internal — never shown to owner
  reviewedAt         DateTime?
  reviewedById       String?
  reviewer           User?                        @relation("ContractorReviewer", fields: [reviewedById], references: [id])

  members            ContractorMember[]
  createdAt          DateTime                     @default(now())
  updatedAt          DateTime                     @updatedAt

  @@index([status, createdAt])
  @@index([country, status])
}

model ContractorMember {
  contractorId       String
  contractor         Contractor                   @relation(fields: [contractorId], references: [id], onDelete: Cascade)
  userId             String
  user               User                         @relation("ContractorMembership", fields: [userId], references: [id], onDelete: Cascade)
  role               ContractorMemberRole         @default(OWNER)
  addedAt            DateTime                     @default(now())

  @@id([contractorId, userId])
  @@index([userId])
}
```

### User additions

```prisma
model User {
  // ...
  contractorMemberships  ContractorMember[]   @relation("ContractorMembership")
  reviewedContractors    Contractor[]         @relation("ContractorReviewer")
}
```

### Validation (zod, in `src/lib/contractor-schema.ts`)

- `entityType`: required enum
- `displayName`: 2–100 chars
- `legalName`: required if `entityType === LEGAL_ENTITY`, 2–200 chars; optional otherwise
- `registrationNumber`: required if `entityType !== INDIVIDUAL`, 4–40 chars; optional for INDIVIDUAL
- `country`, `countriesServed[*]`: ISO-2 uppercase regex `/^[A-Z]{2}$/`
- `city`: 1–80 chars
- `foundedYear`: optional, 1900–current year
- `workCategories`: length ≥ 1, no duplicates
- `renewableTypes`: length ≥ 1, no duplicates
- `countriesServed`: length ≥ 1, no duplicates
- `bio`: 100–2000 chars
- `websiteUrl`: optional, must parse as URL with http(s) scheme
- `logoUrl`: optional, must parse as URL with http(s) scheme, length ≤ 500
- `contactEmail`: valid email
- `contactPhone`: E.164 regex `/^\+[1-9]\d{6,14}$/`

### Slug generation

Server-side at `createContractor`:
1. lowercase `displayName`
2. transliterate non-Latin via existing `slugify` helper if available, else strip
3. dasherize: `/[^a-z0-9]+/g → "-"`, trim leading/trailing `-`
4. dedup: if collision, append `-2`, `-3`, … (`SELECT count(*) WHERE slug LIKE 'base-%'`)
5. cap at 60 chars

---

## 4. Routes & UI

### Owner-facing

| Route | Type | Notes |
|---|---|---|
| `/[locale]/me/contractor` | server component | List of own contractors (typically one); "+ Register company" button |
| `/[locale]/me/contractor/new` | server component + form | 3-section form; submits via `createContractor` |
| `/[locale]/me/contractor/[id]` | server component | Detail view; "Edit" and "Withdraw" buttons visible only if `status === PENDING` |
| `/[locale]/me/contractor/[id]/edit` | server component + form | Same form; renders only if `status === PENDING`, else redirect to detail |

### Admin-facing

| Route | Type | Notes |
|---|---|---|
| `/[locale]/admin/contractors` | server component | Table; `searchParams` filters (status, country, entityType); paginated 50/page |
| `/[locale]/admin/contractors/[id]` | server component | Owner contacts + full profile + status-change form |

### Layout integration

- `me/layout.tsx` gets a new sidebar item `🏢 My company` between
  `🔧 Build requests` and `⚙ Settings`. Translation key
  `cabinet.sidebar.contractor`.
- `admin/layout.tsx` gets a new sidebar item `🏢 Contractors` under
  `🔧 Build requests`. Translation key `admin.contractor.title`.

### Form layout (`new` and `edit`)

Single page, 3 collapsible sections, sticky submit bar:

1. **Identity** — entityType radio; conditional fields appear:
   - LEGAL_ENTITY → displayName + legalName + registrationNumber + country + city + foundedYear
   - SOLE_TRADER → displayName + registrationNumber + country + city + foundedYear
   - INDIVIDUAL → displayName + country + city + foundedYear
2. **What we do** — workCategories (multi-checkbox); renewableTypes
   (multi-checkbox); countriesServed (ISO-2 multi-select chips)
3. **Contact & profile** — bio (textarea 100–2000), websiteUrl,
   logoUrl, contactEmail, contactPhone

Client-side validation echoes zod. Server is the source of truth.

---

## 5. Lifecycle

```
                  ┌──── admin ────► APPROVED ─── (V2c: SUSPENDED ─── admin)
                  │
   PENDING ───────┤
   │              │
   │              └──── admin ────► REJECTED
   │
   └──── owner ─── withdraw (DELETE row, info-email to admin)
```

- **`PENDING → APPROVED`**: admin only, requires `adminNote`.
- **`PENDING → REJECTED`**: admin only, requires `adminNote`.
- **`PENDING → (deleted)`**: owner can withdraw; row physically deleted
  (cascade deletes the member). Audit kept only via admin email.
- **`APPROVED / REJECTED / SUSPENDED → PENDING`**: not allowed; reapplication
  means a new row.
- **`APPROVED → SUSPENDED → APPROVED`**: reserved for V2c.

Editability gate:
- Owner edit allowed only while `status === PENDING`.
- After APPROVED, edit form redirects to detail with notice
  "Approved contractors edit profile via the V2c flow" (which
  doesn't exist yet — clear cul-de-sac at V2a).

---

## 6. Server Actions

In `src/app/[locale]/me/contractor/actions.ts`:

```ts
"use server";

createContractor(input: ContractorInput): Promise<{ ok: true, id: string } | { ok: false, fieldErrors?, formError? }>
  // auth + zod + slug-generate + tx { create Contractor with status PENDING, create ContractorMember with role OWNER }
  // fire admin email; revalidatePath

updateContractor(id: string, input: ContractorInput): Promise<ActionResult>
  // auth + OWNER-member check + status === PENDING gate + zod + update

withdrawContractor(id: string): Promise<ActionResult>
  // auth + OWNER-member check + status === PENDING gate + delete row (cascade members)
  // fire info email to admin
```

In `src/app/[locale]/admin/contractors/actions.ts`:

```ts
"use server";

adminSetContractorStatus(
  id: string,
  status: "APPROVED" | "REJECTED",
  adminNote: string,
): Promise<AdminActionResult>
  // role=ADMIN gate, current status must be PENDING, adminNote required (non-empty after trim)
  // update status, reviewedAt = now, reviewedById = session.user.id, adminNote
  // fire owner notification email
```

All actions use `revalidatePath` for affected list/detail pages.

State machine in code:
```ts
const VALID_ADMIN_TRANSITIONS: Record<ContractorStatus, ContractorStatus[]> = {
  PENDING: ["APPROVED", "REJECTED"],
  APPROVED: [],   // SUSPENDED added in V2c
  REJECTED: [],
  SUSPENDED: [],  // APPROVED added in V2c
};
```

---

## 7. Notifications (Resend)

New module `src/lib/resend-contractor.ts` mirroring
`src/lib/resend-build-request.ts`.

### Templates

- `sendContractorNewToAdmin(contractor)` — to `env.ADMIN_EMAIL`.
  Subject: `[Poolwatt] New contractor registration #<short-id> — <displayName>, <country>`.
  Body: brief table (displayName, entityType, country, workCategories,
  renewableTypes, contact) + link to `/admin/contractors/[id]`.
- `sendContractorStatusChangedToOwner(contractorId, newStatus, ownerUserId)`
  — to first OWNER member's verified email. Subject:
  `[Poolwatt] Your contractor registration #<short-id> is now <STATUS>`.
  Body in owner's `preferredLocale`. **Does NOT include `adminNote`**
  — that field is admin-internal per §3 (schema comment). If admin
  needs to give feedback to a REJECTED owner, they reply out-of-band
  to `contactEmail`. V2c may add a separate public `feedbackToOwner`
  field if this becomes painful.
- `sendContractorWithdrawnToAdmin(contractor)` — to admin. Subject:
  `[Poolwatt] Contractor registration #<short-id> withdrawn`. Body
  identifies the contractor and notes the row is gone.

### Failure modes

- Resend failure → log + swallow (don't roll back DB).
- Missing `ADMIN_EMAIL` → log warn + skip.
- Owner email missing / unverified → silent skip on status-change.

---

## 8. i18n

All user-visible strings live in `messages/<locale>.json` under
namespaces `cabinet.contractor.*` and `admin.contractor.*`:

```
cabinet.sidebar.contractor

cabinet.contractor.title
cabinet.contractor.empty
cabinet.contractor.newButton

cabinet.contractor.new.title
cabinet.contractor.new.section.{identity, work, contact}

cabinet.contractor.field.entityType.{label, LEGAL_ENTITY, SOLE_TRADER, INDIVIDUAL}
cabinet.contractor.field.workCategories.{label, DESIGN, MANUFACTURE, SUPPLY, INSTALLATION, COMMISSIONING, MAINTENANCE}
cabinet.contractor.field.renewableTypes.{label, SOLAR, WIND, HYDRO, BIOMASS, GEOTHERMAL, HYBRID}
cabinet.contractor.field.{displayName, legalName, registrationNumber, country, city, foundedYear, countriesServed, bio, websiteUrl, logoUrl, contactEmail, contactPhone}.label

cabinet.contractor.status.{PENDING, APPROVED, REJECTED, SUSPENDED}
cabinet.contractor.action.{submit, save, edit, withdraw, back, newContractor, goToSettings}
cabinet.contractor.error.{notEditable}

admin.contractor.title
admin.contractor.filter.{status, country, entityType, all}
admin.contractor.table.{createdAt, owner, displayName, entityType, country, status}
admin.contractor.action.{setStatus, adminNote, submit, approve, reject}
```

**Locale strategy:** EN + RU + SK fully translated at merge.
Remaining 26 locales auto-fallback to EN (consistent with V1 rollout).

---

## 9. Testing

### Unit (vitest)

`src/lib/contractor-schema.test.ts` — every conditional branch of the
zod schema: entityType conditionals (legalName / registrationNumber
required), array minimums, country regex, bio length bounds,
url/phone formats.

### Integration (vitest + Prisma test DB)

Co-located `*.test.ts` next to server actions, using the existing
infra (`vitest.config.ts` with `@/` alias + `loadEnv` of `.env.local`;
`src/test-setup.ts` mocking `next/cache` + `next/headers`).

- `actions/createContractor.test.ts` — auth, zod, slug uniqueness +
  collision suffix, member-OWNER creation in transaction
- `actions/updateContractor.test.ts` — OWNER-only, status gate, zod
- `actions/withdrawContractor.test.ts` — OWNER-only, status gate,
  cascade delete of ContractorMember
- `actions/adminSetContractorStatus.test.ts` — role gate, transition
  validity, adminNote requirement

### E2E (Playwright, `npm run test:e2e`)

`tests/e2e/contractor-flow.spec.ts`:
- Register + login as owner
- `/me/contractor/new` → fill 3 sections → submit → land on detail with `PENDING`
- Edit → change bio → save → status still PENDING
- Logout, login as admin
- `/admin/contractors` → see the row in PENDING
- `/admin/contractors/[id]` → approve with adminNote → success
- Logout, log back in as owner → see APPROVED, Edit and Withdraw buttons gone

Same gotcha as V1 e2e: requires `poolwatt-web` on :3000 with the
freshly built code, uses system Chrome (`channel: "chrome"`).
Source `.env.local` for `DATABASE_URL` before invoking.

---

## 10. Migration & deployment

- Single Prisma migration `add_contractor`. Adds 5 enums +
  `Contractor` + `ContractorMember` + `User` relations.
- No data backfill (new tables).
- Env vars: only existing `ADMIN_EMAIL` and `RESEND_API_KEY` (already
  documented in `.env.example`).
- Deploy: same pattern as V1 — local commits on the server checkout,
  `npm run build && pm2 restart poolwatt-web`. No push to GitHub
  until explicit instruction.

---

## 11. Open questions deferred to V2b / V2c / V2d

- **V2b (public listing):** which fields are public? Probably
  `displayName`, `entityType`, `country`, `city`, `workCategories`,
  `renewableTypes`, `countriesServed`, `bio`, `websiteUrl`, `logoUrl`,
  `contactEmail`, `contactPhone`. Decide there.
- **V2b:** homepage block — top N by `createdAt` or by some quality
  signal? V2a has no quality signal.
- **V2c:** post-approval edit flow — admin re-review on each change?
  Or trust owner edits with audit log? Or change-request workflow?
- **V2c:** teammate invitation — email-based invite link, or
  username-based add? Role boundaries.
- **V2d:** BuildRequest matching — push (notify contractor when
  matching request appears) or pull (contractor browses a feed)?
- **V2d:** matching criteria — does country match + renewable-type
  intersection suffice, or do we need finer signals (project size,
  installer rating)?
- **V2d:** claim model — first-come-first-served, or owner-of-build-
  request picks from claimants? Multiple contractors per request?
- **All V2:** does an APPROVED contractor automatically appear on V2b
  homepage, or does admin separately "feature" them?
