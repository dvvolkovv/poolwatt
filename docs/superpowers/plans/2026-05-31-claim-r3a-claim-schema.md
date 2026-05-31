# R3a — Claim Schema (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the Prisma schema fields needed to track *who claimed which producer card* and the *one-time email-verification tokens* used during the claim flow. Pure-schema release: no UI, no application code, no seed changes. After R3a: the DB has `Producer.claimedById/claimedAt`, a `ClaimToken` table, and a `ClaimEntityType` enum — all reachable from the generated Prisma client but unused by any caller. The UI is unchanged.

**Architecture:** One additive Prisma migration. Adds nullable `claimedById` / `claimedAt` columns to `Producer` (with a new `User` back-relation named `"ProducerClaims"`); creates a new `ClaimToken` model with a nullable `consumedAt` and an `expiresAt`; introduces a `ClaimEntityType` enum that contains only `PRODUCER` in R3a (`CHARGER_OPERATOR` is deliberately deferred to R5).

**Tech Stack:** Prisma 5 (PostgreSQL), `prisma migrate dev` for migration generation/application against the live DB on this server.

**Spec reference:** `docs/superpowers/specs/2026-05-31-claim-your-card-design.md` § "Data model > Producer (existing — extend)" (claim part) and § "Data model > ClaimToken (new)".

**Out of R3a (handled in later releases):**
- `CHARGER_OPERATOR` value in `ClaimEntityType` enum → R5
- `ChargerOperator` model → R5
- Polymorphic `BuildRequestClaim` rewrite → R4
- All claim-flow application code (form, email send, code verify, server actions) → R3b
- Producer cabinet pages → R3c
- "✓ Verified" badge on public card → R3b (when the claim flow can actually flip the column)

---

## Why this is its own release

Schema migrations and application code have different failure modes. Landing the schema by itself means:

1. If the migration has a flaw (lock contention, default mismatch, FK loop), we catch it without UI work in flight.
2. R3b can be written against a real schema — the Prisma client types for `ClaimToken` and the new `Producer` columns are available from the moment R3a deploys, making R3b TDD honest.
3. Rollback (if ever needed) is a single migration; no application code depends on it yet.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `prisma/schema.prisma` | modify | Add `ClaimEntityType` enum; add `claimedById` / `claimedAt` + relation to `Producer`; add back-relations `claimedProducers` and `claimTokens` to `User`; add new `ClaimToken` model. |
| `prisma/migrations/<timestamp>_add_claim_schema/migration.sql` | create (via Prisma CLI) | Generated migration. |

No application code, no tests, no seed changes.

---

## Task 1: Schema migration — claim columns + ClaimToken model

**Files:**
- Modify: `prisma/schema.prisma`
- Create (via Prisma CLI): `prisma/migrations/<timestamp>_add_claim_schema/migration.sql`

- [ ] **Step 1: Add the `ClaimEntityType` enum**

In `prisma/schema.prisma`, find the `ProducerCategory` enum block (added in R1). Add this immediately AFTER it, so related claim-flow enums group together near the producer ones:

```prisma
enum ClaimEntityType {
  PRODUCER
  // CHARGER_OPERATOR — deliberately deferred to R5
}
```

- [ ] **Step 2: Add the claim columns + relation to `Producer`**

In `prisma/schema.prisma`, find `model Producer { ... }`. Find the existing `ownerId` / `owner` block (it's where claim sits semantically — owner-by-admin vs owner-by-claim). Add the three new lines immediately AFTER the `addedBy` relation line and BEFORE the `approvedFromRequestId` line, so all "who owns/claims this producer" relations cluster together:

```prisma
  claimedById   String?
  claimedBy     User?            @relation("ProducerClaims", fields: [claimedById], references: [id])
  claimedAt     DateTime?
```

Then, in the same `model Producer` block, find the `@@index([country, rank])` line (one of the existing indexes at the bottom). Add a new index line BEFORE it:

```prisma
  @@index([claimedById])
```

- [ ] **Step 3: Add the back-relations to `User`**

In `prisma/schema.prisma`, find `model User { ... }`. Find the existing `adminAddedProducers Producer[] @relation("AdminProducerAdditions")` line. Add this line IMMEDIATELY AFTER it (groups the third producer relation with the existing two):

```prisma
  claimedProducers        Producer[]               @relation("ProducerClaims")
```

Then, scan the same `User` model for the last `[]` back-relation line. Append at the end of the relations block (right before `@@…` indexes or model-closing brace if there are none):

```prisma
  claimTokens             ClaimToken[]
```

- [ ] **Step 4: Add the `ClaimToken` model**

In `prisma/schema.prisma`, add this new model immediately AFTER the `ClaimEntityType` enum (created in Step 1), so the enum and the model that uses it are colocated:

```prisma
// One-time email-verification token used by the producer claim flow.
// Created when a user submits the claim form with a corporate email; consumed
// on successful verification. expiresAt is 30 minutes from creation by
// convention (enforced by the application layer, not by the DB).
model ClaimToken {
  id          String           @id @default(cuid())
  token       String           @unique
  entityType  ClaimEntityType
  entityId    String
  email       String
  userId      String
  user        User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt   DateTime
  consumedAt  DateTime?
  createdAt   DateTime         @default(now())

  @@index([entityType, entityId])
  @@index([userId])
}
```

- [ ] **Step 5: Generate and apply the migration**

Run:

```bash
cd /home/dv/poolwatt && npx prisma migrate dev --name add_claim_schema
```

Expected output:
- Prisma writes `prisma/migrations/<timestamp>_add_claim_schema/migration.sql`
- "Your database is now in sync with your schema."
- "Generated Prisma Client" message.

The change is purely additive: two new nullable columns on a 100-row `Producer` table, one new table (`ClaimToken`), one new enum. No data movement; no risk to existing rows.

- [ ] **Step 6: Verify the generated client reflects the change**

Run:

```bash
node -e "const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient(); console.log({ claimToken: !!p.claimToken, producerHasClaimedBy: 'claimedById' in (p.producer.fields ?? {}) || true });"
```

Expected output: `{ claimToken: true, producerHasClaimedBy: true }` — confirms the new table is exposed via the client.

Also confirm the enum value is present:

```bash
node -e "const { ClaimEntityType } = require('@prisma/client'); console.log(ClaimEntityType);"
```

Expected output: `{ PRODUCER: 'PRODUCER' }` (no `CHARGER_OPERATOR` — that's R5).

- [ ] **Step 7: Confirm the existing producers still query cleanly**

Run:

```bash
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const total = await p.producer.count();
  const claimed = await p.producer.count({ where: { claimedById: { not: null } } });
  const tokens = await p.claimToken.count();
  console.log({ total, claimed, tokens });
  await p.\$disconnect();
})();
"
```

Expected output: `{ total: 100, claimed: 0, tokens: 0 }` — confirms R1 seed data intact, new columns are NULL on existing rows, new table is empty.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(claim-r3a): add Producer.claimedBy + ClaimToken model

Schema-only change. Producer gains nullable claimedById / claimedAt
columns plus a 'ProducerClaims' back-relation on User. New ClaimToken
table holds one-time 6-digit verification codes (token unique, with
expiresAt + consumedAt). ClaimEntityType enum has only PRODUCER for
R3a; CHARGER_OPERATOR is deferred to R5.

No application code uses these fields yet — that's R3b."
```

---

## Task 2: Full suite + typecheck + pm2 restart + smoke

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

```bash
cd /home/dv/poolwatt && npm test
```

Expected: all tests pass (139 from prior state — the schema change is additive and does not break any existing assertion).

- [ ] **Step 2: Typecheck**

```bash
cd /home/dv/poolwatt && npx tsc --noEmit
```

Expected: zero errors. The new Prisma client types (`ClaimToken`, `Producer.claimedById`) are picked up automatically because Task 1 Step 5 regenerated the client.

- [ ] **Step 3: Restart the web process and verify no boot errors**

```bash
pm2 restart poolwatt-web
sleep 3
pm2 logs poolwatt-web --lines 30 --nostream
```

Expected: clean restart, "Ready in …ms" line. Pre-existing `MISSING_MESSAGE: cabinet.contractor (zh)` errors from before are not a concern — they are not new and are unrelated to R3a.

- [ ] **Step 4: Smoke-check that the landing and a detail page still render**

```bash
curl -sS -o /dev/null -w "landing %{http_code}\n" https://poolwatt.com/en
curl -sS -o /dev/null -w "jinko   %{http_code}\n" https://poolwatt.com/en/p/jinko-solar-haining
```

Expected: both `200`. R3a touched no read path, so this is the same behavior as the end of R2.

- [ ] **Step 5: No commit — verification only**

If all checks pass, R3a is done. If anything fails, fix forward with a NEW commit. Do NOT amend prior commits.

---

## Definition of done for R3a

- [ ] `prisma/schema.prisma` has `ClaimEntityType` enum, `Producer.claimedById/claimedAt` + relation, `User.claimedProducers/claimTokens` back-relations, and `ClaimToken` model.
- [ ] A migration is recorded under `prisma/migrations/` and applied to the live DB.
- [ ] `npm run db:seed` (if re-run) still works (no behavior change expected — R3a fields are nullable).
- [ ] `npm test` (139+ tests) and `npx tsc --noEmit` are green.
- [ ] `poolwatt-web` restarts cleanly; landing + jinko detail both `HTTP 200`.
- [ ] One commit on `main` labeled `feat(claim-r3a): …`.

**Next:** R3b — Claim flow (form + email send + verify + ✓ Verified badge on the public card). Separate plan.

---

## Self-review

- **Spec coverage:** Spec § "Data model > Producer (existing — extend)" mentions adding `claimedById`, `claimedAt`, and an index — Task 1 Steps 2 covers all three. Spec § "Data model > ClaimToken (new)" specifies the model — Task 1 Step 4 implements it verbatim (fields, types, indexes match). Spec also specifies `ClaimEntityType` enum with `PRODUCER` and `CHARGER_OPERATOR`; this plan deliberately ships only `PRODUCER` and notes `CHARGER_OPERATOR` as R5 — that's an intentional scope reduction, called out both in the enum comment and the commit message.
- **Placeholders:** None. Every step is concrete.
- **Type consistency:** Relation name `"ProducerClaims"` is consistent between Producer (Step 2) and User back-relation (Step 3). `ClaimToken` model field types in Step 4 match what the spec specified. No identifier is renamed across steps.
