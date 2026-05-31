# R5 — ChargerOperator Cabinet (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** EV-charging-network operators (IONITY, GreenWay, Tesla, ChargePoint, etc.) can prove ownership of their brand on Poolwatt, edit their company profile, and a "✓ Verified operator" badge + about-block appears on the public `/c/[id]` station detail pages for stations matching their alias. End-to-end mirror of the producer-side flow (R3a+R3b+R3c), but **without BR matching** (operators don't fulfill build requests).

**Architecture:** New `ChargerOperator` table with `aliases String[]` for matching OSM `operator`/`network`/`brand` tag variants. Reuse existing R3b claim flow by extending `submitClaim`/`verifyClaim` actions + extending the `ClaimEntityType` enum with `CHARGER_OPERATOR`. New cabinet at `/me/charger-operator` mirroring `/me/producer` but with only one form (Card) since there's no separate "Profile" model and no BR feed. Seed the 32 unique operators from `src/lib/chargers-mock.ts` so claim flow has targets out of the box.

**Tech Stack:** Prisma 5 (PostgreSQL), Next.js 16 App Router, Resend (reuses R3b's `resend-claim.ts`), Vitest (real-DB integration tests for actions, mocked auth + email).

**Spec reference:** `docs/superpowers/specs/2026-05-31-claim-your-card-design.md` § "Data model > ChargerOperator (new)" + § "Cabinets > /me/charger-operator" + § "Public-UI visibility".

**Builds on:** R3a (`ClaimToken`, `ClaimEntityType`), R3b (claim flow), R3c (cabinet pattern).

---

## Out of R5

- **Real OSM seed extraction** — spec calls for a `scripts/seed-charger-operators.ts` that hits Overpass; for V1 we use a hand-curated list from `chargers-mock.ts` (32 operators is enough to validate the flow). Full OSM extraction deferred until needed.
- **Read-only "stations under this operator" list in cabinet** — V1 cabinet just shows a link to the public navigator filtered by operator. Full list view is a follow-up.
- **Domain-less claim path (manual admin)** — if the operator has no `websiteUrl`, claim is hidden. Spec calls for an "email admin@poolwatt.com" fallback; for V1 the UI shows the note but there's no admin queue UI.
- **Polymorphic refactor** — Like R4, we don't unify under one table.

---

## What success looks like (manual smoke after R5)

1. Visitor opens `/en/c/g11` (IONITY Himmelkron) → sees "**This is our company — claim this card**" button.
2. Click → land on `/me/claim/CHARGER_OPERATOR/<ionity-id>` → email field.
3. Enter `ops@ionity.eu` → submit → 6-digit code on email → enter on verify → land in `/me/charger-operator/<id>?claimed=1`.
4. Edit description / contacts → save.
5. Refresh `/en/c/g11` → see "**✓ Verified operator**" badge + about-block with the edited description.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `prisma/schema.prisma` | modify | Add `ChargerOperator` model + `CHARGER_OPERATOR` to `ClaimEntityType`. |
| `prisma/migrations/<timestamp>_add_charger_operator/migration.sql` | create | Generated. |
| `src/lib/seed/charger-operators.ts` | create | Pure `seedChargerOperators(prisma, rows)` function + 32-entry data list. |
| `src/lib/seed/charger-operators.test.ts` | create | Real-DB integration test. |
| `scripts/seed.ts` | modify | Call `seedChargerOperators` after producers. |
| `src/app/[locale]/me/claim/[entityType]/[entityId]/actions.ts` | modify | Extend `submitClaim` to accept `CHARGER_OPERATOR`. |
| `src/app/[locale]/me/claim/[entityType]/[entityId]/verify/actions.ts` | modify | Extend `verifyClaim` to accept `CHARGER_OPERATOR`. |
| `src/app/[locale]/me/claim/[entityType]/[entityId]/page.tsx` | modify | Drop the `entityType !== "PRODUCER"` notFound; load entity dynamically. |
| `src/app/[locale]/me/claim/[entityType]/[entityId]/verify/page.tsx` | modify | Same. |
| `src/app/[locale]/me/charger-operator/actions.ts` | create | `updateChargerOperatorCard` + `unlinkChargerOperatorClaim`. |
| `src/app/[locale]/me/charger-operator/actions.test.ts` | create | DB-integration tests. |
| `src/app/[locale]/me/charger-operator/page.tsx` | create | List page. |
| `src/app/[locale]/me/charger-operator/[id]/page.tsx` | create | Detail page. |
| `src/app/[locale]/me/charger-operator/[id]/card-form.tsx` | create | Client form. |
| `src/app/[locale]/me/charger-operator/[id]/unlink-button.tsx` | create | Client button. |
| `src/app/[locale]/c/[id]/page.tsx` | modify | Add verified badge + about-block + claim CTA (alias-matched lookup). |
| `messages/{en,ru,sk}.json` | modify | Add `cabinet.chargerOperator.*` namespace + extend `claim.*` for the new entity type label. |

---

## Task 1: Schema migration — `ChargerOperator` + enum extension

**Files:**
- Modify: `prisma/schema.prisma`
- Create (via Prisma CLI): `prisma/migrations/<timestamp>_add_charger_operator/migration.sql`

- [ ] **Step 1: Extend the `ClaimEntityType` enum**

In `prisma/schema.prisma`, find:

```prisma
enum ClaimEntityType {
  PRODUCER
  // CHARGER_OPERATOR — deliberately deferred to R5
}
```

Replace with:

```prisma
enum ClaimEntityType {
  PRODUCER
  CHARGER_OPERATOR
}
```

- [ ] **Step 2: Add the `ChargerOperator` model**

In `prisma/schema.prisma`, add immediately after the existing `ClaimToken` model (groups claim-related models together):

```prisma
// EV-charging-network operator (IONITY, GreenWay, Tesla, ChargePoint, …).
// Aliases hold the variations of operator/network/brand tags from OSM data
// so a single ChargerOperator row matches all stations of that network.
model ChargerOperator {
  id            String   @id @default(cuid())
  slug          String   @unique
  displayName   String
  aliases       String[] @default([])
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

- [ ] **Step 3: Add the User back-relation**

In `prisma/schema.prisma`, find `model User { ... }`. Find the existing `claimedProducers` back-relation (added in R3a). Add IMMEDIATELY AFTER:

```prisma
  claimedChargerOperators Producer[]               @relation("ChargerOperatorClaims")
```

Wait — that's wrong. The relation target is `ChargerOperator`, not `Producer`. Use:

```prisma
  claimedChargerOperators ChargerOperator[]        @relation("ChargerOperatorClaims")
```

- [ ] **Step 4: Generate and apply the migration**

```bash
cd /home/dv/poolwatt && npx prisma migrate dev --name add_charger_operator
```

Expected: new migration directory, "Your database is now in sync", "Generated Prisma Client".

- [ ] **Step 5: Verify the client**

```bash
node -e "const { PrismaClient, ClaimEntityType } = require('@prisma/client'); const p = new PrismaClient(); console.log({ has: !!p.chargerOperator, enum: ClaimEntityType });"
```

Expected: `{ has: true, enum: { PRODUCER: 'PRODUCER', CHARGER_OPERATOR: 'CHARGER_OPERATOR' } }`.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(claim-r5): add ChargerOperator + extend ClaimEntityType

New ChargerOperator model with aliases[] for OSM operator-tag matching.
ClaimEntityType enum gains CHARGER_OPERATOR (was deferred). User
gains claimedChargerOperators back-relation."
```

---

## Task 2: Seed charger operators from chargers-mock + integrate into runner

**Files:**
- Create: `src/lib/seed/charger-operators.ts`
- Test: `src/lib/seed/charger-operators.test.ts`
- Modify: `scripts/seed.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/seed/charger-operators.test.ts`:

```ts
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { seedChargerOperators, type ChargerOperatorSeedRow } from "./charger-operators";

const TEST_SLUGS = ["test-cop-a", "test-cop-b"];

const TEST_ROWS: ChargerOperatorSeedRow[] = [
  { slug: "test-cop-a", displayName: "Test Op A", aliases: ["Test Op A", "Op A"], websiteUrl: "https://opa.example" },
  { slug: "test-cop-b", displayName: "Test Op B", aliases: ["Test Op B"], websiteUrl: null },
];

async function cleanup() {
  await prisma.chargerOperator.deleteMany({ where: { slug: { in: TEST_SLUGS } } });
}

beforeAll(cleanup);
afterAll(cleanup);

describe("seedChargerOperators", () => {
  it("creates rows on first run with correct fields", async () => {
    const r = await seedChargerOperators(prisma, TEST_ROWS);
    expect(r.created).toBe(2);
    expect(r.skipped).toBe(0);

    const a = await prisma.chargerOperator.findUnique({ where: { slug: "test-cop-a" } });
    expect(a?.displayName).toBe("Test Op A");
    expect(a?.aliases).toEqual(["Test Op A", "Op A"]);
    expect(a?.websiteUrl).toBe("https://opa.example");

    const b = await prisma.chargerOperator.findUnique({ where: { slug: "test-cop-b" } });
    expect(b?.websiteUrl).toBeNull();
  });

  it("is idempotent on re-run", async () => {
    const r = await seedChargerOperators(prisma, TEST_ROWS);
    expect(r.created).toBe(0);
    expect(r.skipped).toBe(2);
  });
});
```

- [ ] **Step 2: Run and verify fail**

```bash
cd /home/dv/poolwatt && npm test -- src/lib/seed/charger-operators.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the seed function + the curated 32-row data**

Create `src/lib/seed/charger-operators.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import type { SeedResult } from "./producers";

export type ChargerOperatorSeedRow = {
  slug: string;
  displayName: string;
  aliases: string[];
  websiteUrl?: string | null;
  description?: string | null;
};

export async function seedChargerOperators(
  prisma: PrismaClient,
  rows: ChargerOperatorSeedRow[],
): Promise<SeedResult> {
  const data = rows.map((r) => ({
    slug: r.slug,
    displayName: r.displayName,
    aliases: r.aliases,
    websiteUrl: r.websiteUrl ?? null,
    description: r.description ?? null,
  }));
  const result = await prisma.chargerOperator.createMany({ data, skipDuplicates: true });
  return { created: result.count, skipped: rows.length - result.count };
}

// Curated from the 32 distinct operators in src/lib/chargers-mock.ts.
// `aliases` lists every spelling found in OSM/mock data so a single row
// matches all stations of the same network. `websiteUrl` is hand-curated.
export const CHARGER_OPERATOR_SEED: ChargerOperatorSeedRow[] = [
  { slug: "tesla", displayName: "Tesla", aliases: ["Tesla", "Tesla Supercharger", "Tesla, Inc."], websiteUrl: "https://www.tesla.com" },
  { slug: "ionity", displayName: "IONITY", aliases: ["IONITY"], websiteUrl: "https://ionity.eu" },
  { slug: "electrify-america", displayName: "Electrify America", aliases: ["Electrify America"], websiteUrl: "https://www.electrifyamerica.com" },
  { slug: "chargepoint", displayName: "ChargePoint", aliases: ["ChargePoint"], websiteUrl: "https://www.chargepoint.com" },
  { slug: "enbw", displayName: "EnBW", aliases: ["EnBW"], websiteUrl: "https://www.enbw.com" },
  { slug: "totalenergies", displayName: "TotalEnergies", aliases: ["TotalEnergies", "Total"], websiteUrl: "https://totalenergies.com" },
  { slug: "bp-pulse", displayName: "BP Pulse", aliases: ["BP Pulse", "BP"], websiteUrl: "https://www.bppulse.com" },
  { slug: "circle-k-mer", displayName: "Circle K / Mer", aliases: ["Circle K / Mer", "Circle K", "Mer"], websiteUrl: "https://www.circlek.com" },
  { slug: "chargefox", displayName: "Chargefox", aliases: ["Chargefox"], websiteUrl: "https://www.chargefox.com" },
  { slug: "nio", displayName: "NIO", aliases: ["NIO"], websiteUrl: "https://www.nio.com" },
  { slug: "state-grid", displayName: "State Grid", aliases: ["State Grid"], websiteUrl: "https://www.sgcc.com.cn" },
  { slug: "tepco", displayName: "TEPCO", aliases: ["TEPCO"], websiteUrl: "https://www.tepco.co.jp" },
  { slug: "hyundai", displayName: "Hyundai", aliases: ["Hyundai", "Hyundai E-pit"], websiteUrl: "https://www.hyundai.com" },
  { slug: "tata-power", displayName: "Tata Power", aliases: ["Tata Power"], websiteUrl: "https://www.tatapower.com" },
  { slug: "dewa", displayName: "DEWA", aliases: ["DEWA"], websiteUrl: "https://www.dewa.gov.ae" },
  { slug: "tupinamba", displayName: "Tupinambá", aliases: ["Tupinambá"], websiteUrl: null },
  { slug: "gridcars", displayName: "GridCars", aliases: ["GridCars"], websiteUrl: "https://www.gridcars.net" },
  { slug: "zes", displayName: "ZES (Zorlu)", aliases: ["ZES (Zorlu)", "ZES"], websiteUrl: "https://zes.net" },
  { slug: "electromin", displayName: "Electromin", aliases: ["Electromin"], websiteUrl: null },
  { slug: "energy-absolute", displayName: "Energy Absolute", aliases: ["Energy Absolute"], websiteUrl: "https://www.energyabsolute.co.th" },
  { slug: "petro-canada", displayName: "Petro-Canada", aliases: ["Petro-Canada"], websiteUrl: "https://www.petro-canada.ca" },
  { slug: "aqniet", displayName: "AQNIET", aliases: ["AQNIET"], websiteUrl: null },
  { slug: "uzcharge", displayName: "UzCharge", aliases: ["UzCharge"], websiteUrl: null },
  { slug: "ev-point-georgia", displayName: "EV Point Georgia", aliases: ["EV Point Georgia"], websiteUrl: null },
  { slug: "greenway", displayName: "GreenWay", aliases: ["GreenWay"], websiteUrl: "https://greenway.sk" },
  { slug: "kaufland", displayName: "Kaufland", aliases: ["Kaufland"], websiteUrl: "https://www.kaufland.de" },
  { slug: "lidl", displayName: "Lidl", aliases: ["Lidl"], websiteUrl: "https://www.lidl.com" },
  { slug: "mol-plugee", displayName: "MOL Plugee", aliases: ["MOL Plugee", "MOL"], websiteUrl: "https://molgroup.info" },
  { slug: "omv", displayName: "OMV", aliases: ["OMV"], websiteUrl: "https://www.omv.com" },
];
```

- [ ] **Step 4: Run tests and verify pass**

```bash
npm test -- src/lib/seed/charger-operators.test.ts
```

Expected: 2 pass.

- [ ] **Step 5: Wire into `scripts/seed.ts`**

Open `scripts/seed.ts`. Add the new import near the others:

```ts
import { seedChargerOperators, CHARGER_OPERATOR_SEED } from "@/lib/seed/charger-operators";
```

Inside `main()`, after the `seedProducerProfiles` block, append:

```ts
  console.log(`[seed] charger operators: starting (${CHARGER_OPERATOR_SEED.length} rows in source)`);
  const co = await seedChargerOperators(prisma, CHARGER_OPERATOR_SEED);
  console.log(`[seed] charger operators: created=${co.created}, skipped=${co.skipped}`);
```

- [ ] **Step 6: Run the seed**

```bash
npm run db:seed
```

Expected output ends with `[seed] charger operators: created=29, skipped=0` (or however many rows are in the curated list).

- [ ] **Step 7: Re-run to verify idempotency**

```bash
npm run db:seed
```

Expected: `created=0, skipped=29`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/seed/charger-operators.ts src/lib/seed/charger-operators.test.ts scripts/seed.ts
git commit -m "feat(claim-r5): add ChargerOperator seed + runner integration

Curated 29-row seed mirroring the operators in src/lib/chargers-mock.ts.
Each row has aliases[] capturing OSM variants ('Tesla' / 'Tesla
Supercharger' / 'Tesla, Inc.' → tesla slug). Hand-curated websiteUrl
for the major networks; null for small regional operators (no claim
path until they have a public website)."
```

---

## Task 3: Extend `submitClaim` + `verifyClaim` to accept `CHARGER_OPERATOR`

**Files:**
- Modify: `src/app/[locale]/me/claim/[entityType]/[entityId]/actions.ts`
- Modify: `src/app/[locale]/me/claim/[entityType]/[entityId]/verify/actions.ts`
- Modify: `src/app/[locale]/me/claim/[entityType]/[entityId]/page.tsx`
- Modify: `src/app/[locale]/me/claim/[entityType]/[entityId]/verify/page.tsx`

- [ ] **Step 1: Update `submitClaim` action**

Open `src/app/[locale]/me/claim/[entityType]/[entityId]/actions.ts`. Find:

```ts
  if (input.entityType !== "PRODUCER") {
    return { ok: false, formError: "Unsupported entity type." };
  }

  const producer = await prisma.producer.findUnique({
    where: { id: input.entityId },
    include: { profile: true },
  });
  if (!producer) return { ok: false, formError: "Producer not found." };
  if (producer.claimedById) return { ok: false, formError: "Already claimed." };

  const website = producer.profile?.website ?? null;
```

Replace with:

```ts
  let entity: { displayName: string; website: string | null; claimedById: string | null } | null = null;
  if (input.entityType === "PRODUCER") {
    const producer = await prisma.producer.findUnique({
      where: { id: input.entityId },
      include: { profile: true },
    });
    if (producer) {
      entity = {
        displayName: producer.displayName,
        website: producer.profile?.website ?? null,
        claimedById: producer.claimedById,
      };
    }
  } else if (input.entityType === "CHARGER_OPERATOR") {
    const op = await prisma.chargerOperator.findUnique({
      where: { id: input.entityId },
      select: { displayName: true, websiteUrl: true, claimedById: true },
    });
    if (op) {
      entity = {
        displayName: op.displayName,
        website: op.websiteUrl,
        claimedById: op.claimedById,
      };
    }
  } else {
    return { ok: false, formError: "Unsupported entity type." };
  }

  if (!entity) return { ok: false, formError: "Entity not found." };
  if (entity.claimedById) return { ok: false, formError: "Already claimed." };

  const website = entity.website;
```

Then later in the file, find the `sendClaimVerificationEmail(input.email, token, producer.displayName)` call — change `producer.displayName` to `entity.displayName`.

- [ ] **Step 2: Update `verifyClaim` action**

Open `src/app/[locale]/me/claim/[entityType]/[entityId]/verify/actions.ts`. Find:

```ts
  if (input.entityType !== "PRODUCER") return { ok: false, formError: "Unsupported entity type." };
```

Replace with:

```ts
  if (input.entityType !== "PRODUCER" && input.entityType !== "CHARGER_OPERATOR") {
    return { ok: false, formError: "Unsupported entity type." };
  }
```

Then find the part that sets `producer.claimedById = userId`. Replace the producer-only block:

```ts
  const producer = await prisma.producer.findUnique({ where: { id: input.entityId } });
  if (!producer) return { ok: false, formError: "Producer not found." };
  if (producer.claimedById) return { ok: false, formError: "Already claimed by someone else." };

  await prisma.$transaction([
    prisma.producer.update({
      where: { id: input.entityId },
      data: { claimedById: session.user.id, claimedAt: new Date() },
    }),
    prisma.claimToken.update({
      where: { id: token.id },
      data: { consumedAt: new Date() },
    }),
  ]);
```

With a branched version:

```ts
  let entityClaimedById: string | null = null;
  if (input.entityType === "PRODUCER") {
    const producer = await prisma.producer.findUnique({ where: { id: input.entityId } });
    if (!producer) return { ok: false, formError: "Producer not found." };
    entityClaimedById = producer.claimedById;
  } else {
    const op = await prisma.chargerOperator.findUnique({ where: { id: input.entityId } });
    if (!op) return { ok: false, formError: "Operator not found." };
    entityClaimedById = op.claimedById;
  }
  if (entityClaimedById) return { ok: false, formError: "Already claimed by someone else." };

  await prisma.$transaction(
    input.entityType === "PRODUCER"
      ? [
          prisma.producer.update({
            where: { id: input.entityId },
            data: { claimedById: session.user.id, claimedAt: new Date() },
          }),
          prisma.claimToken.update({
            where: { id: token.id },
            data: { consumedAt: new Date() },
          }),
        ]
      : [
          prisma.chargerOperator.update({
            where: { id: input.entityId },
            data: { claimedById: session.user.id, claimedAt: new Date() },
          }),
          prisma.claimToken.update({
            where: { id: token.id },
            data: { consumedAt: new Date() },
          }),
        ],
  );
```

- [ ] **Step 3: Update claim form page**

Open `src/app/[locale]/me/claim/[entityType]/[entityId]/page.tsx`. Find:

```tsx
  if (entityType !== "PRODUCER") notFound();

  const producer = await prisma.producer.findUnique({
    where: { id: entityId },
    include: { profile: true },
  });
  if (!producer) notFound();
  if (producer.claimedById) {
    redirect(`/${locale}/p/${producer.handle}`);
  }
```

Replace with:

```tsx
  let entity:
    | { id: string; displayName: string; website: string | null; claimedById: string | null; publicPath: string }
    | null = null;

  if (entityType === "PRODUCER") {
    const producer = await prisma.producer.findUnique({
      where: { id: entityId },
      include: { profile: true },
    });
    if (producer) {
      entity = {
        id: producer.id,
        displayName: producer.displayName,
        website: producer.profile?.website ?? null,
        claimedById: producer.claimedById,
        publicPath: `/${locale}/p/${producer.handle}`,
      };
    }
  } else if (entityType === "CHARGER_OPERATOR") {
    const op = await prisma.chargerOperator.findUnique({
      where: { id: entityId },
      select: { id: true, displayName: true, websiteUrl: true, claimedById: true },
    });
    if (op) {
      entity = {
        id: op.id,
        displayName: op.displayName,
        website: op.websiteUrl,
        claimedById: op.claimedById,
        publicPath: `/${locale}/navigator`, // no per-operator public page; navigator is the closest
      };
    }
  } else {
    notFound();
  }

  if (!entity) notFound();
  if (entity.claimedById) redirect(entity.publicPath);
```

Then in the JSX, where you currently reference `producer.displayName` and `producer.profile?.website` and `producer.id`, replace with `entity.displayName`, `entity.website`, and `entity.id`. Pass `entityType` (which is `"PRODUCER"` or `"CHARGER_OPERATOR"` from the URL) to `ClaimForm` instead of hardcoded `"PRODUCER"`. The `<ClaimForm>` currently has `entityType="PRODUCER"`; change to `entityType={entityType as "PRODUCER" | "CHARGER_OPERATOR"}` (or extend the form's prop type).

Update `ClaimForm` in `claim-form.tsx` Props if needed: change `entityType: "PRODUCER";` to `entityType: "PRODUCER" | "CHARGER_OPERATOR";`.

- [ ] **Step 4: Update verify page**

Open `src/app/[locale]/me/claim/[entityType]/[entityId]/verify/page.tsx`. Same pattern: drop the `entityType !== "PRODUCER" → notFound()` guard, branch on the two valid types, find the entity, redirect to public path if already claimed. The `VerifyForm` component should also accept `entityType: "PRODUCER" | "CHARGER_OPERATOR"`. Update its Props type in `verify-form.tsx` accordingly.

After successful verify in `verify-form.tsx`, the redirect currently points to `/me/producer/${entityId}` — for CHARGER_OPERATOR that's the wrong path. Update `verify-form.tsx`:

```tsx
      if (result.ok) {
        const cabinetPath = entityType === "PRODUCER"
          ? `/${locale}/me/producer/${entityId}`
          : `/${locale}/me/charger-operator/${entityId}`;
        router.push(`${cabinetPath}?claimed=1`);
      }
```

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Run existing R3b claim tests** (they should still pass — the producer code paths are preserved):

```bash
npm test -- src/app/\[locale\]/me/claim/
```

Expected: 9 pass (4 submitClaim + 5 verifyClaim from R3b — unchanged behavior).

- [ ] **Step 7: Commit**

```bash
git add src/app/\[locale\]/me/claim/
git commit -m "feat(claim-r5): extend claim flow to support CHARGER_OPERATOR

submitClaim, verifyClaim, claim form page, and verify page all
branch on entityType to load Producer or ChargerOperator. Post-verify
redirect routes to the correct cabinet path. R3b producer tests
unchanged — same behavior for PRODUCER branch."
```

---

## Task 4: ChargerOperator cabinet server actions

**Files:**
- Create: `src/app/[locale]/me/charger-operator/actions.ts`
- Test: `src/app/[locale]/me/charger-operator/actions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/[locale]/me/charger-operator/actions.test.ts`:

```ts
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/prisma";

let mockUserId: string | null = null;
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (mockUserId ? { user: { id: mockUserId } } : null)),
}));

import { updateChargerOperatorCard, unlinkChargerOperatorClaim } from "./actions";

const TEST_SLUG = "test-co-cabinet";
const TEST_USERNAME = "test_co_user";
const OTHER_USERNAME = "test_co_other";

let testOpId: string;
let ownerUserId: string;
let otherUserId: string;

async function cleanup() {
  await prisma.chargerOperator.deleteMany({ where: { slug: TEST_SLUG } });
  await prisma.user.deleteMany({ where: { username: { in: [TEST_USERNAME, OTHER_USERNAME] } } });
}

beforeAll(async () => {
  await cleanup();
  ownerUserId = (await prisma.user.create({ data: { username: TEST_USERNAME, passwordHash: "x" } })).id;
  otherUserId = (await prisma.user.create({ data: { username: OTHER_USERNAME, passwordHash: "x" } })).id;
  testOpId = (await prisma.chargerOperator.create({
    data: {
      slug: TEST_SLUG, displayName: "Test Op", aliases: ["Test Op"],
      claimedById: ownerUserId, claimedAt: new Date(),
    },
  })).id;
});

afterAll(cleanup);

beforeEach(async () => {
  mockUserId = ownerUserId;
  await prisma.chargerOperator.update({
    where: { id: testOpId },
    data: {
      displayName: "Test Op",
      description: null, websiteUrl: null, logoUrl: null, email: null, phone: null,
      claimedById: ownerUserId, claimedAt: new Date(),
    },
  });
});

describe("updateChargerOperatorCard", () => {
  it("updates fields when caller is the owner", async () => {
    const r = await updateChargerOperatorCard({
      operatorId: testOpId,
      displayName: "Renamed Op",
      description: "We run fast chargers.",
      websiteUrl: "https://renamed.example",
      logoUrl: "https://renamed.example/l.png",
      email: "ops@renamed.example",
      phone: "+1",
    });
    expect(r.ok).toBe(true);
    const after = await prisma.chargerOperator.findUnique({ where: { id: testOpId } });
    expect(after?.displayName).toBe("Renamed Op");
    expect(after?.description).toBe("We run fast chargers.");
    expect(after?.email).toBe("ops@renamed.example");
  });

  it("rejects when caller is not the owner", async () => {
    mockUserId = otherUserId;
    const r = await updateChargerOperatorCard({
      operatorId: testOpId,
      displayName: "Hostile rename",
    });
    expect(r.ok).toBe(false);
    const after = await prisma.chargerOperator.findUnique({ where: { id: testOpId } });
    expect(after?.displayName).toBe("Test Op");
  });

  it("rejects when displayName is empty", async () => {
    const r = await updateChargerOperatorCard({
      operatorId: testOpId,
      displayName: "",
    });
    expect(r.ok).toBe(false);
    expect(r.fieldErrors?.displayName).toBeDefined();
  });
});

describe("unlinkChargerOperatorClaim", () => {
  it("clears claim when owner unlinks", async () => {
    const r = await unlinkChargerOperatorClaim({ operatorId: testOpId });
    expect(r.ok).toBe(true);
    const after = await prisma.chargerOperator.findUnique({ where: { id: testOpId } });
    expect(after?.claimedById).toBeNull();
  });

  it("rejects when caller is not the owner", async () => {
    mockUserId = otherUserId;
    const r = await unlinkChargerOperatorClaim({ operatorId: testOpId });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run and verify fail**

```bash
npm test -- src/app/\[locale\]/me/charger-operator/actions.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement actions**

Create `src/app/[locale]/me/charger-operator/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type ActionResult = {
  ok: boolean;
  fieldErrors?: Record<string, string>;
  formError?: string;
};

function nullify(s: string | undefined): string | null {
  return s && s.trim() !== "" ? s : null;
}

async function assertOwner(operatorId: string): Promise<
  | { ok: true; userId: string }
  | { ok: false; result: ActionResult }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, result: { ok: false, formError: "Not authenticated." } };
  const op = await prisma.chargerOperator.findUnique({
    where: { id: operatorId },
    select: { claimedById: true },
  });
  if (!op) return { ok: false, result: { ok: false, formError: "Operator not found." } };
  if (op.claimedById !== session.user.id) {
    return { ok: false, result: { ok: false, formError: "Not authorized." } };
  }
  return { ok: true, userId: session.user.id };
}

const cardSchema = z.object({
  operatorId: z.string().min(1),
  displayName: z.string().min(1, "Display name is required.").max(120),
  description: z.string().max(2000).optional(),
  websiteUrl: z.string().url().or(z.literal("")).optional(),
  logoUrl: z.string().url().or(z.literal("")).optional(),
  email: z.string().email().or(z.literal("")).optional(),
  phone: z.string().max(50).optional(),
});

export type UpdateChargerOperatorCardInput = z.input<typeof cardSchema>;

export async function updateChargerOperatorCard(input: UpdateChargerOperatorCardInput): Promise<ActionResult> {
  const parsed = cardSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]?.toString();
      if (key) fieldErrors[key] = issue.message;
    }
    return { ok: false, fieldErrors };
  }
  const owner = await assertOwner(parsed.data.operatorId);
  if (!owner.ok) return owner.result;

  await prisma.chargerOperator.update({
    where: { id: parsed.data.operatorId },
    data: {
      displayName: parsed.data.displayName,
      description: nullify(parsed.data.description),
      websiteUrl: nullify(parsed.data.websiteUrl),
      logoUrl: nullify(parsed.data.logoUrl),
      email: nullify(parsed.data.email),
      phone: nullify(parsed.data.phone),
    },
  });

  revalidatePath(`/[locale]/c`, "page");
  return { ok: true };
}

export async function unlinkChargerOperatorClaim(input: { operatorId: string }): Promise<ActionResult> {
  const owner = await assertOwner(input.operatorId);
  if (!owner.ok) return owner.result;

  await prisma.chargerOperator.update({
    where: { id: input.operatorId },
    data: { claimedById: null, claimedAt: null },
  });

  return { ok: true };
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- src/app/\[locale\]/me/charger-operator/actions.test.ts
```

Expected: 5 pass.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/\[locale\]/me/charger-operator/
git commit -m "feat(claim-r5): add ChargerOperator cabinet server actions

updateChargerOperatorCard (6 editable fields: displayName, description,
websiteUrl, logoUrl, email, phone) and unlinkChargerOperatorClaim.
Both gated on claimedById === session.user.id. Mirror of the producer
cabinet actions pattern."
```

---

## Task 5: Cabinet pages — list + detail + card form + unlink button

**Files:**
- Create: `src/app/[locale]/me/charger-operator/page.tsx`
- Create: `src/app/[locale]/me/charger-operator/[id]/page.tsx`
- Create: `src/app/[locale]/me/charger-operator/[id]/card-form.tsx`
- Create: `src/app/[locale]/me/charger-operator/[id]/unlink-button.tsx`

- [ ] **Step 1: Create the list page**

Create `src/app/[locale]/me/charger-operator/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function ChargerOperatorListPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/charger-operator`);

  const operators = await prisma.chargerOperator.findMany({
    where: { claimedById: session.user.id },
    orderBy: { displayName: "asc" },
    select: { id: true, slug: true, displayName: true },
  });

  const t = await getTranslations("cabinet.chargerOperator");

  return (
    <div className="max-w-2xl">
      <h1 className="text-[28px] font-bold mb-6">{t("listTitle")}</h1>
      {operators.length === 0 ? (
        <div className="bg-card border border-hairline rounded-xl p-8">
          <p className="text-sm text-muted mb-4">{t("emptyState")}</p>
          <Link href={`/${locale}/navigator`} className="text-sm text-accent hover:underline">{t("emptyStateCta")} →</Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {operators.map((op) => (
            <li key={op.id}>
              <Link href={`/${locale}/me/charger-operator/${op.id}`}
                className="block p-4 bg-card border border-hairline rounded-xl hover:border-accent/40 transition-colors">
                <div className="font-semibold">{op.displayName}</div>
                <div className="text-xs text-muted mt-1">@{op.slug}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the unlink button**

Create `src/app/[locale]/me/charger-operator/[id]/unlink-button.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { unlinkChargerOperatorClaim } from "../actions";

type Props = {
  operatorId: string;
  locale: string;
  labels: { button: string; confirm: string };
};

export function UnlinkButton({ operatorId, locale, labels }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    if (!confirm(labels.confirm)) return;
    startTransition(async () => {
      const r = await unlinkChargerOperatorClaim({ operatorId });
      if (r.ok) {
        router.push(`/${locale}/me/charger-operator`);
        router.refresh();
      } else {
        alert(r.formError ?? "Unlink failed.");
      }
    });
  }

  return (
    <button type="button" onClick={onClick} disabled={pending}
      className="text-xs text-down border border-down/40 rounded px-3 py-1.5 hover:bg-down/10 disabled:opacity-50">
      {labels.button}
    </button>
  );
}
```

- [ ] **Step 3: Create the card form**

Create `src/app/[locale]/me/charger-operator/[id]/card-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateChargerOperatorCard } from "../actions";

type Props = {
  operatorId: string;
  initial: {
    displayName: string;
    description: string | null;
    websiteUrl: string | null;
    logoUrl: string | null;
    email: string | null;
    phone: string | null;
  };
  labels: {
    sectionTitle: string;
    displayName: string; description: string; websiteUrl: string; logoUrl: string;
    email: string; phone: string; submit: string; saved: string;
  };
};

export function CardForm({ operatorId, initial, labels }: Props) {
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [description, setDescription] = useState(initial.description ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(initial.websiteUrl ?? "");
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl ?? "");
  const [email, setEmail] = useState(initial.email ?? "");
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    startTransition(async () => {
      const result = await updateChargerOperatorCard({
        operatorId, displayName, description, websiteUrl, logoUrl, email, phone,
      });
      if (result.ok) {
        setSavedAt(Date.now());
        router.refresh();
      } else {
        setErrors(result.fieldErrors ?? { _form: result.formError ?? "Save failed." });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">{labels.sectionTitle}</h2>

      <Field id="displayName" label={labels.displayName} error={errors.displayName}>
        <input id="displayName" type="text" required maxLength={120}
          value={displayName} onChange={(e) => setDisplayName(e.target.value)}
          className="w-full px-3 py-2 rounded border border-hairline bg-card" />
      </Field>

      <Field id="description" label={labels.description} error={errors.description}>
        <textarea id="description" rows={4} maxLength={2000}
          value={description} onChange={(e) => setDescription(e.target.value)}
          className="w-full px-3 py-2 rounded border border-hairline bg-card" />
      </Field>

      <Field id="websiteUrl" label={labels.websiteUrl} error={errors.websiteUrl}>
        <input id="websiteUrl" type="url" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)}
          className="w-full px-3 py-2 rounded border border-hairline bg-card" />
      </Field>

      <Field id="logoUrl" label={labels.logoUrl} error={errors.logoUrl}>
        <input id="logoUrl" type="url" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)}
          className="w-full px-3 py-2 rounded border border-hairline bg-card" />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field id="email" label={labels.email} error={errors.email}>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 rounded border border-hairline bg-card" />
        </Field>
        <Field id="phone" label={labels.phone} error={errors.phone}>
          <input id="phone" type="text" maxLength={50}
            value={phone} onChange={(e) => setPhone(e.target.value)}
            className="w-full px-3 py-2 rounded border border-hairline bg-card" />
        </Field>
      </div>

      {errors._form && <p className="text-sm text-down">{errors._form}</p>}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending}
          className="px-4 py-2 rounded-full font-semibold text-sm bg-accent text-accent-foreground disabled:opacity-50">
          {labels.submit}
        </button>
        {savedAt && <span className="text-xs text-up">✓ {labels.saved}</span>}
      </div>
    </form>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium mb-1">{label}</label>
      {children}
      {error && <p className="text-xs text-down mt-1">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Create the detail page**

Create `src/app/[locale]/me/charger-operator/[id]/page.tsx`:

```tsx
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CardForm } from "./card-form";
import { UnlinkButton } from "./unlink-button";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ claimed?: string }>;
};

export default async function ChargerOperatorCabinetPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const { claimed } = await searchParams;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/charger-operator/${id}`);

  const op = await prisma.chargerOperator.findUnique({ where: { id } });
  if (!op) notFound();
  if (op.claimedById !== session.user.id) notFound();

  const t = await getTranslations("cabinet.chargerOperator");

  return (
    <div className="max-w-3xl space-y-10">
      <div>
        <Link href={`/${locale}/me/charger-operator`} className="text-sm text-muted hover:text-foreground">← {t("backToList")}</Link>
        <h1 className="text-[28px] font-bold mt-2 mb-2">{op.displayName}</h1>
        <p className="text-sm text-muted">
          <Link href={`/${locale}/navigator`} className="hover:underline">{t("viewOnMap")} →</Link>
        </p>
        {claimed === "1" && (
          <div className="mt-4 p-3 rounded-xl bg-up/10 border border-up/30 text-sm">
            ✓ {t("justClaimedBanner")}
          </div>
        )}
      </div>

      <CardForm
        operatorId={op.id}
        initial={{
          displayName: op.displayName,
          description: op.description,
          websiteUrl: op.websiteUrl,
          logoUrl: op.logoUrl,
          email: op.email,
          phone: op.phone,
        }}
        labels={{
          sectionTitle: t("cardSection"),
          displayName: t("displayName"),
          description: t("description"),
          websiteUrl: t("websiteUrl"),
          logoUrl: t("logoUrl"),
          email: t("email"),
          phone: t("phone"),
          submit: t("save"),
          saved: t("saved"),
        }}
      />

      <div className="pt-6 border-t border-hairline">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">{t("dangerSection")}</h2>
        <p className="text-xs text-muted mb-3">{t("unlinkHint")}</p>
        <UnlinkButton
          operatorId={op.id}
          locale={locale}
          labels={{ button: t("unlinkButton"), confirm: t("unlinkConfirm") }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck**

```bash
cd /home/dv/poolwatt && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/\[locale\]/me/charger-operator/
git commit -m "feat(claim-r5): add ChargerOperator cabinet pages

List page (/me/charger-operator), detail page (/me/charger-operator/[id])
with single Card form (6 fields) + UnlinkButton + post-claim banner.
Pattern mirrors /me/producer cabinet (R3c) minus Profile form (no
separate profile model) and minus BR feed (operators don't fulfill
build requests)."
```

---

## Task 6: Public `/c/[id]` page — verified badge + about-block + claim CTA

**Files:**
- Modify: `src/app/[locale]/c/[id]/page.tsx`

- [ ] **Step 1: Read current state of the page**

```bash
sed -n '1,80p' src/app/[locale]/c/[id]/page.tsx
```

Identify the charger object structure and where the header / about section is.

- [ ] **Step 2: Add the operator lookup**

In `src/app/[locale]/c/[id]/page.tsx`, after the existing `getChargerById(id)` call (or however the charger is loaded), ADD:

```tsx
  const operator = charger.operator
    ? await prisma.chargerOperator.findFirst({
        where: { aliases: { has: charger.operator } },
        select: { id: true, displayName: true, description: true, websiteUrl: true, logoUrl: true, email: true, phone: true, claimedById: true },
      })
    : null;
  const isVerified = !!operator?.claimedById;
```

Make sure `prisma` is imported at the top.

- [ ] **Step 3: Add the "Verified" badge near the operator name**

Find where `charger.operator` is rendered in the JSX. Add immediately after it:

```tsx
              {isVerified && (
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-up/10 text-up border border-up/30">
                  ✓ Verified operator
                </span>
              )}
```

- [ ] **Step 4: Add the "About operator" block**

After the existing main content (e.g. after the connections section), insert (only when operator is loaded):

```tsx
        {operator && (
          <section className="mt-8 p-5 bg-card border border-hairline rounded-xl">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">About {operator.displayName}</h2>
            {operator.description && <p className="text-sm text-muted-strong mb-3">{operator.description}</p>}
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
              {operator.websiteUrl && <a href={operator.websiteUrl} target="_blank" rel="noopener" className="text-accent hover:underline">{operator.websiteUrl.replace(/^https?:\/\//, "")}</a>}
              {operator.email && <a href={`mailto:${operator.email}`} className="text-accent hover:underline">{operator.email}</a>}
              {operator.phone && <span className="text-muted">{operator.phone}</span>}
            </div>
            {!isVerified && (
              <Link href={`/${locale}/me/claim/CHARGER_OPERATOR/${operator.id}`}
                className="inline-block mt-4 text-xs uppercase tracking-wider px-3 py-1.5 rounded border border-accent/40 text-accent hover:bg-accent/5">
                This is our company — claim this card
              </Link>
            )}
          </section>
        )}
```

(Hardcoded English in this task — swap to i18n in Task 7.)

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/\[locale\]/c/\[id\]/page.tsx
git commit -m "feat(claim-r5): show verified-operator badge + about-block on /c/[id]

Public charger detail now looks up ChargerOperator via aliases[] match
on charger.operator. When found, shows About-operator section with
description + contacts. When claimed (claimedById set), shows
'✓ Verified operator' badge. When NOT claimed, shows claim CTA so the
real operator can take ownership."
```

---

## Task 7: i18n strings — `cabinet.chargerOperator.*` + extend `claim.*`

**Files:**
- Modify: `messages/{en,ru,sk}.json`
- Modify: `src/app/[locale]/c/[id]/page.tsx` (swap hardcoded English to t() calls)

- [ ] **Step 1: Add `cabinet.chargerOperator.*` to `messages/en.json`**

Under `cabinet`, alongside the existing `producer` sub-namespace, add:

```json
    "chargerOperator": {
      "listTitle": "My charger networks",
      "emptyState": "You haven't claimed any charger network cards yet.",
      "emptyStateCta": "Open the navigator",
      "backToList": "Back to my networks",
      "viewOnMap": "View on map",
      "justClaimedBanner": "You've just claimed this network. Edits will appear on station pages within a minute.",
      "cardSection": "Network info",
      "displayName": "Display name",
      "description": "About the network",
      "websiteUrl": "Website URL",
      "logoUrl": "Logo URL",
      "email": "Contact email",
      "phone": "Phone",
      "save": "Save",
      "saved": "Saved",
      "dangerSection": "Danger zone",
      "unlinkHint": "Unlinks this network from your account. Someone else can re-claim it later.",
      "unlinkButton": "Unlink claim",
      "unlinkConfirm": "Are you sure? This unlinks the network from your account."
    }
```

Then for the public `/c/[id]` strings, add a `charger.operatorSection` namespace (or extend existing `charger.*`):

```json
    "operatorSection": {
      "title": "About {name}",
      "verifiedBadge": "Verified operator",
      "claimCta": "This is our company — claim this card"
    }
```

- [ ] **Step 2: Add Russian translations to `messages/ru.json`**

Under `cabinet.chargerOperator`:

```json
    "chargerOperator": {
      "listTitle": "Мои сети зарядок",
      "emptyState": "Вы пока не заявили права ни на одну сеть зарядок.",
      "emptyStateCta": "Открыть навигатор",
      "backToList": "К моим сетям",
      "viewOnMap": "Открыть на карте",
      "justClaimedBanner": "Вы только что заявили права на эту сеть. Изменения появятся на страницах станций в течение минуты.",
      "cardSection": "Информация о сети",
      "displayName": "Отображаемое имя",
      "description": "О сети",
      "websiteUrl": "URL сайта",
      "logoUrl": "URL логотипа",
      "email": "Контактный email",
      "phone": "Телефон",
      "save": "Сохранить",
      "saved": "Сохранено",
      "dangerSection": "Опасная зона",
      "unlinkHint": "Отвязывает сеть от вашего аккаунта. Заявить права снова сможет любой.",
      "unlinkButton": "Отвязать",
      "unlinkConfirm": "Уверены? Это отвяжет сеть от вашего аккаунта."
    }
```

Under `charger`:

```json
    "operatorSection": {
      "title": "О {name}",
      "verifiedBadge": "Подтверждённый оператор",
      "claimCta": "Это наша компания — забрать карточку"
    }
```

- [ ] **Step 3: Add Slovak translations to `messages/sk.json`**

Under `cabinet.chargerOperator`:

```json
    "chargerOperator": {
      "listTitle": "Moje siete nabíjačiek",
      "emptyState": "Zatiaľ ste neprevzali žiadnu sieť nabíjačiek.",
      "emptyStateCta": "Otvoriť navigátor",
      "backToList": "Späť na moje siete",
      "viewOnMap": "Zobraziť na mape",
      "justClaimedBanner": "Práve ste prevzali túto sieť. Zmeny sa zobrazia na stránkach staníc do minúty.",
      "cardSection": "Informácie o sieti",
      "displayName": "Zobrazované meno",
      "description": "O sieti",
      "websiteUrl": "URL webu",
      "logoUrl": "URL loga",
      "email": "Kontaktný e-mail",
      "phone": "Telefón",
      "save": "Uložiť",
      "saved": "Uložené",
      "dangerSection": "Nebezpečná zóna",
      "unlinkHint": "Odpojí túto sieť od vášho účtu. Iný používateľ ju môže prevziať.",
      "unlinkButton": "Odpojiť",
      "unlinkConfirm": "Naozaj? Toto odpojí sieť od vášho účtu."
    }
```

Under `charger`:

```json
    "operatorSection": {
      "title": "O {name}",
      "verifiedBadge": "Overený prevádzkovateľ",
      "claimCta": "Toto je naša spoločnosť — prevziať kartu"
    }
```

- [ ] **Step 4: Verify JSON parses**

```bash
cd /home/dv/poolwatt && \
node -e "JSON.parse(require('fs').readFileSync('messages/en.json'))" && \
node -e "JSON.parse(require('fs').readFileSync('messages/ru.json'))" && \
node -e "JSON.parse(require('fs').readFileSync('messages/sk.json'))" && \
echo "all locales valid JSON"
```

Expected: `all locales valid JSON`.

- [ ] **Step 5: Swap hardcoded strings in `/c/[id]` to t() calls**

In `src/app/[locale]/c/[id]/page.tsx`, ensure `getTranslations` is imported. Add at top of the page function (where other `t = await getTranslations(...)` are):

```tsx
  const tOp = await getTranslations("charger.operatorSection");
```

Then replace:
- `✓ Verified operator` → `✓ {tOp("verifiedBadge")}`
- `About {operator.displayName}` → `{tOp("title", { name: operator.displayName })}`
- `This is our company — claim this card` → `{tOp("claimCta")}`

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add messages/ src/app/\[locale\]/c/\[id\]/page.tsx
git commit -m "feat(claim-r5): add EN/RU/SK i18n strings

- cabinet.chargerOperator.* namespace (~20 keys per locale) for the
  ChargerOperator cabinet pages.
- charger.operatorSection.* (3 keys) for the verified badge, about
  section title, and claim CTA on the public /c/[id] page.

Swaps hardcoded English from Task 6."
```

---

## Task 8: Build + restart + smoke

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

```bash
cd /home/dv/poolwatt && npm test
```

Expected: 180 baseline + 7 R5 new (2 seed + 5 cabinet actions) = 187 pass.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Rebuild + restart**

```bash
npm run build && pm2 restart poolwatt-web
sleep 4
pm2 logs poolwatt-web --lines 30 --nostream
```

Expected: build completes, "Ready in …ms". Pre-existing zh-locale errors are NOT new — ignore.

- [ ] **Step 4: Smoke landing + a charger detail**

```bash
curl -sS -o /dev/null -w "landing  %{http_code}\n" https://poolwatt.com/en
curl -sS -o /dev/null -w "ionity   %{http_code}\n" https://poolwatt.com/en/c/g11
curl -sS https://poolwatt.com/en/c/g11 | grep -c "claim this card"
```

Expected: landing 200, ionity 200, claim CTA count ≥ 1 (IONITY exists as ChargerOperator row, no claim yet).

- [ ] **Step 5: Smoke cabinet pages anonymous → /login**

```bash
curl -sS -o /dev/null -w "co_list  %{http_code}\n" "https://poolwatt.com/en/me/charger-operator"

IONITY_ID=$(node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const o = await p.chargerOperator.findUnique({ where: { slug: 'ionity' }, select: { id: true } });
  console.log(o?.id);
  await p.\$disconnect();
})();
")
echo "IONITY_ID=$IONITY_ID"
curl -sS -o /dev/null -w "co_det   %{http_code}\n" "https://poolwatt.com/en/me/charger-operator/$IONITY_ID"
curl -sS -o /dev/null -w "co_claim %{http_code}\n" "https://poolwatt.com/en/me/claim/CHARGER_OPERATOR/$IONITY_ID"
```

Expected: all 307 (or similar redirect codes). NOT 500. NOT 200.

- [ ] **Step 6: No commit — verification only.**

---

## Definition of done for R5

- [ ] `ChargerOperator` model exists; `ClaimEntityType.CHARGER_OPERATOR` added; migration applied.
- [ ] 29-row seed populated (`{ created: 29, skipped: 0 }` on first run, idempotent after).
- [ ] `submitClaim` + `verifyClaim` accept `CHARGER_OPERATOR`; R3b producer tests still pass.
- [ ] Cabinet actions exist; 5 tests pass.
- [ ] Cabinet pages render; anonymous redirected to login.
- [ ] Public `/c/[id]` shows operator section + claim CTA (for matched operators).
- [ ] EN/RU/SK i18n complete.
- [ ] `npm test` 187 + `npx tsc --noEmit` green.
- [ ] `npm run build && pm2 restart` succeeds; ionity page renders with claim CTA.
- [ ] 7 commits on main labeled `feat(claim-r5): …`.

---

## Self-review

- **Spec coverage:** § "Data model > ChargerOperator (new)" → Task 1. § "Cabinets > /me/charger-operator" → Task 5 (less the read-only stations list — deferred). § "Public-UI visibility" badge + about block → Task 6. Claim flow extension → Task 3. OSM seed → simplified to curated 29 from chargers-mock (deviation noted at top).
- **Placeholders:** None.
- **Type consistency:** `ActionResult` redefined in Task 4 (parallel to existing — consistent with R3c/R4 pattern). `cardSchema` zod uses same `nullify` + `.url().or(z.literal("")).optional()` pattern as R3c.
