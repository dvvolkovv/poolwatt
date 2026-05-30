# Poolwatt — BuildRequest ↔ Contractor Matching V2d (design)

**Date:** 2026-05-30
**Scope:** Two-sided marketplace loop. APPROVED contractors browse an
auto-filtered feed of OPEN BuildRequests at
`/me/contractor/[id]/requests`, express interest with an optional
message. Homeowners see interested contractors on their existing
`/me/build-requests/[id]` page and pick one. On accept, both sides
get full contact info; sibling claims auto-reject; BuildRequest
status → MATCHED.
**Out of scope:** Bidding with price/timeline; in-app messaging;
multi-contractor per request; auto-suggested contractors on the
homeowner page before any interest is expressed; reviews after
fulfillment; matching by workCategories (V2d uses country + renewable
only); claim re-open after WITHDRAWN.
**Phase:** Phase 2, the final V2 sub-project — closes the marketplace
loop established by V1 (homeowner-side) + V2a (contractor-side).

---

## 0. Roadmap context

V2d is the **fourth and final** V2 sub-project:

```
V1   (shipped)  Homeowner files build request, admin triages
V2a  (shipped)  Contractor registration + admin moderation
V2b  (shipped)  Public contractor listing + homepage block
V2c  (deferred) Contractor cabinet — teammates, post-approval editing
V2d  (this)    BuildRequest ↔ Contractor matching loop
```

V2d depends on V2a's `Contractor` model and V1's `BuildRequest` model.
After V2d ships, an APPROVED contractor can act on incoming build
requests and a homeowner can pick a contractor from the platform —
the basic value loop of the platform is complete.

---

## 1. What we ship in V2d

A signed-in OWNER of an APPROVED `Contractor` can:

1. **View an auto-filtered request feed** at
   `/me/contractor/[id]/requests` — `OPEN` BuildRequests whose `country`
   is in this contractor's `countriesServed` AND whose `source` is in
   this contractor's `renewableTypes`. Excludes requests where this
   contractor already has a PENDING/ACCEPTED claim.
2. **Express interest** in a request with an optional message — creates
   a `BuildRequestClaim(status=PENDING)`.
3. **Withdraw** a still-PENDING claim.
4. **See accepted requests** with full homeowner contact info after
   their claim is ACCEPTED.

A signed-in OWNER of a BuildRequest can:

1. **See interested contractors** on the existing
   `/me/build-requests/[id]` detail page — list of PENDING claims with
   limited contractor info (no email/phone yet).
2. **Accept exactly one contractor** — transitions that claim to
   ACCEPTED, all sibling claims to REJECTED, BuildRequest status →
   MATCHED. Full mutual contact reveal happens at this moment.

An admin (`User.role === ADMIN`) sees claims on
`/admin/build-requests/[id]` in read-only audit view.

Email notifications (Resend, same pattern as V1/V2a):
- Contractor expresses interest → homeowner gets email.
- Claim accepted → contractor gets email with homeowner's contacts.
- Sibling claim auto-rejected → those contractors get a "thanks, but
  the homeowner chose someone else" email.

Out of scope (explicit):
- Bidding with price/timeline.
- In-app messaging / chat between sides.
- Multi-contractor per request (one accepted, others rejected).
- Auto-suggested contractors on the homeowner's page before they have
  any incoming interest.
- Matching by `workCategories` (V2d uses country + renewable only;
  workCategories filter can be added in V2d-2 if real users ask).
- Re-opening a REJECTED or WITHDRAWN claim — contractor must wait
  until the homeowner re-files a new BuildRequest.
- Reviews / ratings after FULFILLED.

---

## 2. Architecture

### Why express-interest + homeowner-picks (not FCFS, not bidding)

Three candidate models:

| | Plan |
|---|---|
| **A: FCFS** | First contractor to click "claim" → instantly MATCHED. Rejected: a $30k installation is a multi-vendor decision, not Uber. |
| **B: Express-interest → homeowner picks** *(chosen)* | Multiple contractors can express interest; homeowner picks one. Mirrors the real-world EPC contracting flow. |
| **C: Bidding with price/timeline** | Richer comparison. Overkill for V1: most platforms add price negotiation only after the parties are in contact. |

**Chosen: B.** Bidding is a follow-on if real users ask.

### Trust boundary

- `expressInterest` requires the caller to be an OWNER member of the
  Contractor **and** the Contractor must be `APPROVED`. A rejected /
  pending / suspended contractor cannot show interest.
- `acceptClaim` requires the caller to be the BuildRequest's owner.
- `withdrawClaim` requires the caller to be an OWNER member of the
  Contractor that issued the claim.
- `adminNote` and other internal fields never leak to either side.

### Single new model

V2d adds **one** Prisma model (`BuildRequestClaim`) and **one** enum.
It does NOT add new columns to `BuildRequest` or `Contractor` — the
relation lives entirely in the join table, which already encodes the
status. `BuildRequest.status` (existing enum) already includes
`MATCHED` so no schema change there.

### Progressive contact reveal

At V2d, the platform's privacy contract is:

| Stage | Homeowner sees | Contractor sees |
|---|---|---|
| Before any claim | Nothing about any specific contractor | Public profile fields of the BR (city, country, source, bio) — already public via `/contractors` patterns |
| Claim PENDING | Contractor's `displayName`, `city`, `country`, short bio excerpt, and their message — but **NOT** `contactEmail`, `contactPhone`, `websiteUrl` | Public BR fields only — **NOT** homeowner `name`, `phone`, `email`, exact `addressLine` |
| Claim ACCEPTED | **Full** contractor contact (`contactEmail`, `contactPhone`, `websiteUrl`, `logoUrl`) | **Full** homeowner contact (`name`, `phone`, `email`, `addressLine`) |

The PENDING-stage reveal is asymmetric (homeowner sees a bit more)
because the contractor reached out first and the homeowner is
deciding. This mirrors how real-world RFP-style flows work.

---

## 3. Data model

### New enum

```prisma
enum BuildRequestClaimStatus {
  PENDING
  ACCEPTED
  REJECTED
  WITHDRAWN
}
```

### New model

```prisma
model BuildRequestClaim {
  id              String                    @id @default(cuid())
  buildRequestId  String
  buildRequest    BuildRequest              @relation(fields: [buildRequestId], references: [id], onDelete: Cascade)
  contractorId    String
  contractor      Contractor                @relation(fields: [contractorId], references: [id], onDelete: Cascade)

  status          BuildRequestClaimStatus   @default(PENDING)
  message         String?                   @db.Text          // optional intro from contractor

  createdAt       DateTime                  @default(now())
  respondedAt     DateTime?                                   // set when status leaves PENDING

  @@unique([buildRequestId, contractorId])
  @@index([buildRequestId, status])
  @@index([contractorId, status])
}
```

### Back-relations

```prisma
model BuildRequest {
  // ... existing fields ...
  claims  BuildRequestClaim[]
}

model Contractor {
  // ... existing fields ...
  claims  BuildRequestClaim[]
}
```

### Validation (zod, in `src/lib/build-request-claim-schema.ts`)

```ts
expressInterestSchema:
  - message: optional, 10–500 chars

acceptClaimSchema:
  - no payload; just claim id
```

### Why composite unique constraint

`@@unique([buildRequestId, contractorId])` prevents a contractor from
issuing multiple claims for the same request. If a contractor withdraws
and wants to re-claim, V2d does NOT support that — they'd need to wait
for the homeowner to re-file. Re-open semantics can come later.

---

## 4. Routes & UI

### Contractor-facing — new route

| Route | Type | Notes |
|---|---|---|
| `/[locale]/me/contractor/[id]/requests` | server component | OWNER + APPROVED gate; auto-filtered feed of OPEN BRs |
| `/[locale]/me/contractor/[id]/requests/[claimId]` | server component | OPTIONAL: detail of one claim — full BR fields if ACCEPTED, limited if PENDING. **Decision: skip in V2d**; the feed row already has enough info. Each row links to the homeowner BR detail page via the standard `/contractors/[slug]`-style pattern... actually no, the homeowner BR isn't a public page. The feed renders all BR fields inline. |

Sidebar in `/me/contractor/[id]` layout gets a new link: **"Available requests (N)"** where N is the number of OPEN+matching+not-yet-claimed requests. If contractor is not APPROVED, the link is hidden.

The contractor feed UI:

```
┌────────────────────────────────────────────────┐
│ Available build requests for SolarCo s.r.o.    │
│ Showing 8 OPEN requests matching your country  │
│ + renewable types.                              │
│                                                 │
│ ┌────────────────────────────────────────────┐ │
│ │ SOLAR · 10 kW · Bratislava, SK · 2 days ago│ │
│ │ Private house · Roof: S · Budget: €15-30k  │ │
│ │ Notes: "Looking for turnkey installation…" │ │
│ │ [ Express interest ]                       │ │
│ └────────────────────────────────────────────┘ │
│ ... more rows                                   │
└────────────────────────────────────────────────┘
```

`Express interest` opens an inline expandable `<textarea>` (10–500
chars optional) and a Submit button. On submit, the row converts to:

```
│ ✓ You expressed interest. Status: PENDING       │
│ [ Withdraw ]                                    │
```

### Homeowner-facing — extending the existing detail page

`/[locale]/me/build-requests/[id]` already exists from V1. V2d adds a
new section between the existing field-list and any existing buttons:

**Case: BR status === OPEN and there are PENDING claims**

```
┌────────────────────────────────────────────────┐
│ Interested contractors (3)                      │
│                                                 │
│ ┌────────────────────────────────────────────┐ │
│ │ SolarCo s.r.o. · Bratislava, SK            │ │
│ │ Legal entity · 12 years on market           │ │
│ │ "We've installed 200+ rooftop systems…"    │ │
│ │ [ Accept this contractor ]                  │ │
│ └────────────────────────────────────────────┘ │
│ ... more candidates                             │
└────────────────────────────────────────────────┘
```

The contractor profile shown is a TIGHT subset:
`displayName`, `city`, `country`, `entityType`, `foundedYear` (if set),
first 300 chars of `bio`, and the contractor's `message`. **NOT**:
contactEmail, contactPhone, websiteUrl, logoUrl, full bio,
registrationNumber. A link "View public profile →" goes to
`/contractors/[slug]` for the full public profile, which still doesn't
reveal contact (V2b decision: contact IS public — but in the MATCHING
context we keep contact gated until accept; the link still works,
since /contractors/[slug] is the regular public listing). Decision:
**hide the "View public profile" link** in V2d to keep the contact
reveal gated end-to-end. If users ask "I want to research them before
picking", we'll revisit.

Wait — `/contractors/[slug]` DOES expose contactEmail / contactPhone /
websiteUrl publicly (V2b spec). So the "gated reveal" promise in V2d
is broken if a homeowner just clicks the public profile link. **Two
options:**

- **Option X (chosen):** in V2d, don't render a "View public profile"
  link from the PENDING claim card. Homeowner only gets the tight
  subset. After accept, both contacts are revealed. This holds the
  privacy contract IF AND ONLY IF the homeowner doesn't manually
  guess the slug and visit /contractors/[slug] — which is a low
  threat (the slug is the same as displayName, so guessing is easy
  in practice).
- **Option Y:** make contact info on /contractors/[slug] gate behind
  a "sign in to see contacts" wall. This is a V2b-revisit and might
  upset existing public users who expect Yelp-style openness.

**Verdict: ship X as the V2d default.** The privacy contract is best-
effort and the threat is low (in practice a homeowner who's about to
spend €30k has every incentive to view the contractor's public
profile). The contact reveal on accept is the **affirmative** moment
that legally counts — the contractor has given consent to be contacted
by THIS homeowner by issuing the claim. We surface that asymmetry in
the UX without enforcing it cryptographically.

**Case: BR status === MATCHED**

The PENDING section is replaced with a prominent "Accepted contractor"
section showing the full contractor card with all contact info. Below
it, in muted styling, the list of REJECTED siblings (without their
contacts, just displayName + "not selected" badge).

**Case: BR status === FULFILLED / CANCELLED**

The accepted contractor remains visible. No new claims can be created.

### Admin

`/[locale]/admin/build-requests/[id]` gets an "All claims (audit)"
section listing every claim ever made on this request, with all
contractor identities + status + timestamps. Read-only for V2d (admin
manual intervention is a future feature if needed).

---

## 5. Server Actions

In `src/app/[locale]/me/contractor/[id]/requests/actions.ts` (new):

```ts
"use server";

expressInterest(input: {
  buildRequestId: string;
  contractorId: string;
  message?: string;
}): Promise<{ ok: true; claimId: string } | { ok: false; ... }>
  // - auth + OWNER membership of contractorId + contractor.status === APPROVED
  // - BR exists, status === OPEN
  // - no existing claim with same (BR, contractor) — DB unique constraint also enforces
  // - validate message
  // - INSERT BuildRequestClaim(status=PENDING)
  // - fire sendInterestExpressedToOwner email
  // - revalidate the contractor feed + homeowner BR page

withdrawClaim(input: { claimId: string; contractorId: string }): Promise<...>
  // - auth + OWNER of contractorId
  // - claim belongs to contractorId
  // - claim.status === PENDING
  // - UPDATE status=WITHDRAWN, respondedAt=now
  // - revalidate paths
```

In `src/app/[locale]/me/build-requests/actions.ts` (extend existing):

```ts
acceptClaim(claimId: string): Promise<ActionResult>
  // - auth + caller is BuildRequest owner (claim.buildRequest.userId === session.user.id)
  // - claim.status === PENDING
  // - BR.status === OPEN
  // - TX:
  //   - this claim → ACCEPTED, respondedAt=now
  //   - all sibling PENDING claims for same BR → REJECTED, respondedAt=now
  //   - BR.status → MATCHED, statusChangedAt=now, statusChangedById=session.user.id
  // - fire sendClaimAcceptedToContractor for accepted contractor
  // - fire sendClaimRejectedToContractor for each rejected sibling
  // - revalidate paths
```

### `acceptClaim` race-condition consideration

If two homeowners-of-different-BRs accept at the exact same time, no
problem (independent rows). If the SAME homeowner clicks Accept twice
quickly on two different claims for the same BR, we have a real race:
both might pass the `BR.status === OPEN` check before either commits.

Mitigation: the action runs inside `prisma.$transaction(async tx =>
{...})` with a `tx.buildRequest.update` that includes a
`where: { id, status: "OPEN" }` predicate. If the second transaction
arrives, the row no longer matches and Prisma throws
`P2025: An operation failed because it depends on one or more records
that were required but not found`. The action catches that as
`{ ok: false, formError: "Request status changed concurrently" }`.

---

## 6. Notifications (Resend)

New module `src/lib/resend-match.ts` mirroring the V1/V2a pattern.

| Function | To | Subject |
|---|---|---|
| `sendInterestExpressedToOwner(claim)` | homeowner | `[Poolwatt] Contractor X is interested in your request #<short-id>` |
| `sendClaimAcceptedToContractor(claim)` | accepted contractor | `[Poolwatt] Your interest in request #<short-id> was accepted — contact details inside` |
| `sendClaimRejectedToContractor(claim)` | rejected contractor | `[Poolwatt] Homeowner chose another contractor for request #<short-id>` |

Failure modes: same as V1/V2a — Resend failure is logged, never rolls
back the DB write. Missing email / unverified email → silent skip.

The **accepted-contractor** email is the critical one: it carries the
homeowner's name, phone, email, and the BR's `addressLine`. Without
this email reaching the contractor, the matching loop is broken. We
log every send attempt; future ops monitoring can surface failures.

---

## 7. i18n

New keys (EN + RU + SK at merge):

```
cabinet.contractor.requests.title
cabinet.contractor.requests.subtitle
cabinet.contractor.requests.empty
cabinet.contractor.requests.expressInterest
cabinet.contractor.requests.message.label
cabinet.contractor.requests.message.placeholder
cabinet.contractor.requests.submit
cabinet.contractor.requests.withdraw
cabinet.contractor.requests.youExpressedInterest

cabinet.buildRequest.claims.title         // "Interested contractors (N)"
cabinet.buildRequest.claims.empty         // "No contractors have expressed interest yet."
cabinet.buildRequest.claims.accept
cabinet.buildRequest.claims.confirmAccept
cabinet.buildRequest.matched.title        // "Your matched contractor"
cabinet.buildRequest.matched.rejectedSiblings  // "Other contractors (not selected)"

cabinet.contractor.sidebar.requests       // "Available requests"

admin.buildRequest.claims.title           // "Claims audit"
```

Sidebar entry: extend `cabinet.contractor.sidebar` with `requests`.

---

## 8. Testing

### Unit (vitest)

`src/lib/build-request-claim-schema.test.ts`:
- accepts valid (no message)
- accepts valid (with 10–500 char message)
- rejects message shorter than 10 chars (when present)
- rejects message longer than 500 chars

### Integration (vitest + Prisma)

`src/app/[locale]/me/contractor/[id]/requests/actions.test.ts`:
- `expressInterest` — auth missing → fail
- `expressInterest` — non-OWNER caller → fail
- `expressInterest` — contractor PENDING (not APPROVED) → fail
- `expressInterest` — BR not OPEN → fail
- `expressInterest` — happy path → INSERT row + status PENDING
- `expressInterest` — duplicate claim by same contractor → fail (unique constraint)
- `withdrawClaim` — non-OWNER → fail
- `withdrawClaim` — claim not PENDING → fail
- `withdrawClaim` — happy path → status WITHDRAWN

Extend existing `src/app/[locale]/me/build-requests/actions.test.ts`:
- `acceptClaim` — non-owner of BR → fail
- `acceptClaim` — claim not PENDING → fail
- `acceptClaim` — happy path → claim ACCEPTED + BR MATCHED + siblings REJECTED
- `acceptClaim` — concurrent race (second call finds BR no longer OPEN) → fail with formError

### E2E (Playwright)

`tests/e2e/matching-flow.spec.ts`:
- Seed: 1 homeowner with a fresh `BuildRequest` (status=OPEN, SOLAR, SK)
- Seed: 1 APPROVED contractor (countriesServed includes SK,
  renewableTypes includes SOLAR), with OWNER user
- As contractor's OWNER:
  - Visit `/me/contractor/[id]/requests` → see the BR in feed
  - Click Express interest, fill message, submit
  - See "You expressed interest" state
- As homeowner:
  - Visit `/me/build-requests/[id]` → see "Interested contractors (1)"
  - Click "Accept this contractor" → confirm dialog → accept
  - Status pill changes to MATCHED
  - "Matched contractor" section shows full contractor contact info
- As contractor's OWNER again:
  - Visit `/me/contractor/[id]/requests` → BR no longer in OPEN feed
    (because the claim is ACCEPTED — feed only shows OPEN BRs)

---

## 9. Migration & deployment

- Single Prisma migration `add_build_request_claim`: 1 enum + 1 table +
  2 back-relations.
- No data backfill (new table starts empty).
- No env vars added.
- Deploy: same V1/V2a/V2b pattern — local commits on the server, build,
  PM2 restart. No GitHub push.

---

## 10. Open questions deferred to future

- **Bidding** (price + timeline in the claim) — V2d-2 if real users
  ask.
- **In-app messaging** between matched parties — needs an inbox UI;
  significant work.
- **Multi-contractor per request** (e.g. one for solar panels, one
  for the powerbank) — modelling is messy; defer until real demand.
- **Auto-suggestion** on the homeowner page: "Here are 5 contractors
  who match your request — invite them to bid". Adds a push-side to
  the matching loop. V2d-2 candidate.
- **Re-opening** a WITHDRAWN claim — currently impossible by the unique
  constraint. Either drop the constraint or add a "re-express interest"
  flow.
- **Workload limits** — should a single contractor be capped at N
  active PENDING claims to prevent spam? Defer; admin can monitor.
- **Notifications to the contractor when a NEW matching BR appears**
  — push-side. Requires opt-in. Future.
- **Reviews** (homeowner rates contractor after FULFILLED) — separate
  feature.
- **Cancellation symmetry** — if BR.status moves to CANCELLED, do
  PENDING claims auto-WITHDRAW? V2d behavior: yes, cascade as part of
  the existing `cancelBuildRequest` action (one-line addition).
