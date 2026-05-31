# R1 — Schema + Producer seed (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the Prisma schema fields needed for the producer side of "claim your card", and populate the `Producer` + `ProducerProfile` tables with the 100 mock entries from `src/lib/producers.ts` / `src/lib/producer-profiles.ts`. After R1: the database is populated; the UI still reads mocks (that's R2). The seed is **idempotent** — re-running it is safe.

**Architecture:** One Prisma migration adds `ProducerCategory` enum, three new columns on `Producer` (`category`, `equipment[]`, `manufactures[]`), and a new `ProducerProfile` 1:1 child table. Two pure-function seed helpers (`seedProducers`, `seedProducerProfiles`) accept the mock data and use `createMany({ skipDuplicates: true })` to insert. A `scripts/seed.ts` runner wires them to the real mock arrays.

**Tech Stack:** Prisma 5 (PostgreSQL), Vitest (real-DB integration tests, no mocks), tsx for the seed runner, existing `@/lib/prisma` client.

**Spec reference:** `docs/superpowers/specs/2026-05-31-claim-your-card-design.md`

**Out of R1 (handled in later releases):**
- Producer `claimedById` / `claimedAt` columns → R3
- `ChargerOperator` model → R5
- `ClaimToken` table → R3
- Polymorphic `BuildRequestClaim` → R4
- Switching UI readers from mocks to Prisma → R2

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `prisma/schema.prisma` | modify | Add `ProducerCategory` enum, 3 columns on `Producer`, `ProducerProfile` model. |
| `prisma/migrations/<timestamp>_add_producer_card_fields/migration.sql` | create (via Prisma CLI) | Generated migration. |
| `src/lib/seed/producers.ts` | create | Pure `seedProducers(prisma, rows)` function. |
| `src/lib/seed/producers.test.ts` | create | Vitest integration test against real DB, namespaced by `test-seed-*` handles. |
| `src/lib/seed/producer-profiles.ts` | create | Pure `seedProducerProfiles(prisma, profiles)` function. |
| `src/lib/seed/producer-profiles.test.ts` | create | Vitest integration test. |
| `scripts/seed.ts` | create | Top-level runner: calls both seed functions with the real mock data. |

The two seed functions are split because they target different tables and have different cleanup semantics in tests. Both files live under `src/lib/seed/` so tests can be discovered by the existing Vitest config.

---

## Task 1: Schema migration — Producer extensions + ProducerProfile

**Files:**
- Modify: `prisma/schema.prisma` — edit existing `Producer` model, add new enum, add new model
- Create (via Prisma CLI): `prisma/migrations/<timestamp>_add_producer_card_fields/migration.sql`

- [ ] **Step 1: Add `ProducerCategory` enum**

In `prisma/schema.prisma`, find the existing `enum RenewableSource { ... }` block and add immediately after it (keeps related enums grouped):

```prisma
enum ProducerCategory {
  ENERGY_PRODUCER
  EQUIPMENT_MANUFACTURER
}
```

- [ ] **Step 2: Extend the `Producer` model with three columns**

In `prisma/schema.prisma`, find `model Producer { ... }`. Add the three new fields after the existing `metadataFetchedAt` line (before the relations block):

```prisma
  category     ProducerCategory @default(ENERGY_PRODUCER)
  equipment    String[]         @default([])
  manufactures String[]         @default([])
```

Also add the new relation to `ProducerProfile` (1:1) — add this line in the relations block alongside `snapshots`, `offers`, `contracts`:

```prisma
  profile      ProducerProfile?
```

- [ ] **Step 3: Add the `ProducerProfile` model**

In `prisma/schema.prisma`, add this new model immediately after the closing `}` of the `Producer` model (so related models are colocated):

```prisma
// Rich profile data for a Producer: human-readable company info shown on the
// detail page (founded year, CEO, contact, certifications, key products).
// 1:1 with Producer; nullable so seed rows without a matching PRODUCER_PROFILES
// entry stay valid.
model ProducerProfile {
  producerId     String   @id
  producer       Producer @relation(fields: [producerId], references: [id], onDelete: Cascade)

  description    String?  @db.Text
  founded        Int?
  employees      String?
  website        String?
  email          String?
  phone          String?
  address        String?
  ceo            String?
  stockTicker    String?
  certifications String[] @default([])
  keyProducts    String[] @default([])

  updatedAt      DateTime @updatedAt
}
```

- [ ] **Step 4: Generate and apply the migration**

Run:

```bash
npx prisma migrate dev --name add_producer_card_fields
```

Expected output:
- Prisma writes `prisma/migrations/<timestamp>_add_producer_card_fields/migration.sql`
- "Your database is now in sync with your schema."
- "Generated Prisma Client" message.

The Producer table is empty in this project, so the new NOT-NULL columns with defaults apply without issue.

- [ ] **Step 5: Verify the schema reflects the change**

Run:

```bash
npx prisma studio --browser none &
sleep 2
pkill -f "prisma studio"
```

(That's a quick "does it boot" check. Real verification is via the seed tests in Task 3.)

Also confirm the generated client is updated:

```bash
node -e "const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient(); console.log(Object.keys(p).filter(k => k === 'producer' || k === 'producerProfile'));"
```

Expected output: `[ 'producer', 'producerProfile' ]`

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(claim-r1): add Producer category/equipment + ProducerProfile

Schema-only change for R1 of the claim-your-card spec. Producer table
gets ProducerCategory enum + equipment/manufactures String[] columns to
preserve current UI features. New ProducerProfile 1:1 child holds
founded/CEO/contacts/certifications/keyProducts.

No data populated yet; that's Task 2-5."
```

---

## Task 2: Seed function — `seedProducers`

**Files:**
- Create: `src/lib/seed/producers.ts`
- Test: `src/lib/seed/producers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/seed/producers.test.ts`:

```ts
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { seedProducers } from "./producers";
import type { ProducerRow } from "@/lib/producers";

const TEST_HANDLES = ["test-seed-a", "test-seed-b", "test-seed-c"];

const TEST_ROWS: ProducerRow[] = [
  {
    id: "p1", rank: 1, handle: "test-seed-a", displayName: "Test A",
    city: "X", country: "DE", primarySource: "SOLAR",
    capacityKwh: 100, inverterKw: 50, stateOfChargePct: 90, availableKwh: 90,
    pricePerKwhUsd: 0.04, delivered24hKwh: 100, deliveredLifetimeKwh: 1000,
    pctChange1h: 0, pctChange24h: 0, pctChange7d: 0, uptimePct: 99,
    weeklyOutput: [100, 100, 100, 100, 100, 100, 100],
    weatherCondition: "SUNNY", carbonOffsetKgCo2e: 50,
  },
  {
    id: "p2", rank: 2, handle: "test-seed-b", displayName: "Test B",
    city: "X", country: "DE", primarySource: "WIND",
    capacityKwh: 200, inverterKw: 80, stateOfChargePct: 80, availableKwh: 160,
    pricePerKwhUsd: 0.04, delivered24hKwh: 200, deliveredLifetimeKwh: 2000,
    pctChange1h: 0, pctChange24h: 0, pctChange7d: 0, uptimePct: 99,
    weeklyOutput: [200, 200, 200, 200, 200, 200, 200],
    weatherCondition: "WINDY", carbonOffsetKgCo2e: 100,
    equipment: ["X turbines"],
  },
  {
    id: "p3", rank: 3, handle: "test-seed-c", displayName: "Test C",
    city: "X", country: "DE", primarySource: "SOLAR",
    category: "EQUIPMENT_MANUFACTURER",
    capacityKwh: 50, inverterKw: 20, stateOfChargePct: 90, availableKwh: 45,
    pricePerKwhUsd: 0.05, delivered24hKwh: 50, deliveredLifetimeKwh: 500,
    pctChange1h: 0, pctChange24h: 0, pctChange7d: 0, uptimePct: 99,
    weeklyOutput: [50, 50, 50, 50, 50, 50, 50],
    weatherCondition: "SUNNY", carbonOffsetKgCo2e: 25,
    manufactures: ["Modules"],
  },
];

async function cleanup() {
  // Producer cascades to ProducerProfile via onDelete: Cascade,
  // but we keep this explicit so the test doesn't depend on cascade behavior.
  await prisma.producerProfile.deleteMany({
    where: { producer: { handle: { in: TEST_HANDLES } } },
  });
  await prisma.producer.deleteMany({
    where: { handle: { in: TEST_HANDLES } },
  });
}

beforeAll(cleanup);
afterAll(cleanup);

describe("seedProducers", () => {
  it("creates rows on first run and returns the count", async () => {
    const r = await seedProducers(prisma, TEST_ROWS);
    expect(r.created).toBe(3);
    expect(r.skipped).toBe(0);
    const all = await prisma.producer.findMany({
      where: { handle: { in: TEST_HANDLES } },
      orderBy: { rank: "asc" },
    });
    expect(all).toHaveLength(3);
    expect(all.map((p) => p.handle)).toEqual([
      "test-seed-a", "test-seed-b", "test-seed-c",
    ]);
  });

  it("is idempotent on re-run (skipDuplicates)", async () => {
    const r = await seedProducers(prisma, TEST_ROWS);
    expect(r.created).toBe(0);
    expect(r.skipped).toBe(3);
    const all = await prisma.producer.findMany({
      where: { handle: { in: TEST_HANDLES } },
    });
    expect(all).toHaveLength(3); // still 3
  });

  it("derives category — explicit EQUIPMENT_MANUFACTURER preserved, default ENERGY_PRODUCER", async () => {
    const c = await prisma.producer.findUnique({ where: { handle: "test-seed-c" } });
    expect(c?.category).toBe("EQUIPMENT_MANUFACTURER");
    const a = await prisma.producer.findUnique({ where: { handle: "test-seed-a" } });
    expect(a?.category).toBe("ENERGY_PRODUCER");
  });

  it("copies equipment and manufactures arrays (empty array when absent)", async () => {
    const a = await prisma.producer.findUnique({ where: { handle: "test-seed-a" } });
    expect(a?.equipment).toEqual([]);
    expect(a?.manufactures).toEqual([]);

    const b = await prisma.producer.findUnique({ where: { handle: "test-seed-b" } });
    expect(b?.equipment).toEqual(["X turbines"]);
    expect(b?.manufactures).toEqual([]);

    const c = await prisma.producer.findUnique({ where: { handle: "test-seed-c" } });
    expect(c?.manufactures).toEqual(["Modules"]);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- src/lib/seed/producers.test.ts
```

Expected: FAIL — error something like `Cannot find module './producers'` (file doesn't exist yet).

- [ ] **Step 3: Implement `seedProducers`**

Create `src/lib/seed/producers.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import type { ProducerRow } from "@/lib/producers";

export type SeedResult = { created: number; skipped: number };

export async function seedProducers(
  prisma: PrismaClient,
  rows: ProducerRow[],
): Promise<SeedResult> {
  const data = rows.map(toProducerData);
  const result = await prisma.producer.createMany({
    data,
    skipDuplicates: true,
  });
  return { created: result.count, skipped: rows.length - result.count };
}

function toProducerData(row: ProducerRow) {
  return {
    handle: row.handle,
    slug: row.handle,
    displayName: row.displayName,
    city: row.city,
    country: row.country,
    primarySource: row.primarySource,
    category:
      row.category === "EQUIPMENT_MANUFACTURER"
        ? ("EQUIPMENT_MANUFACTURER" as const)
        : ("ENERGY_PRODUCER" as const),
    capacityKwh: row.capacityKwh,
    inverterKw: row.inverterKw,
    rank: row.rank,
    equipment: row.equipment ?? [],
    manufactures: row.manufactures ?? [],
  };
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run:

```bash
npm test -- src/lib/seed/producers.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/seed/producers.ts src/lib/seed/producers.test.ts
git commit -m "feat(claim-r1): add idempotent seedProducers function

Pure function: takes a PrismaClient + ProducerRow[], inserts via
createMany skipDuplicates keyed on handle. Returns { created, skipped }
for caller observability. Tested against real DB with namespaced
test-seed-* handles."
```

---

## Task 3: Seed function — `seedProducerProfiles`

**Files:**
- Create: `src/lib/seed/producer-profiles.ts`
- Test: `src/lib/seed/producer-profiles.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/seed/producer-profiles.test.ts`:

```ts
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { seedProducers } from "./producers";
import { seedProducerProfiles } from "./producer-profiles";
import type { ProducerRow, ProducerProfile } from "@/lib/producers";

const TEST_HANDLES = ["test-prof-a", "test-prof-b"];

const ROWS: ProducerRow[] = [
  {
    id: "x1", rank: 901, handle: "test-prof-a", displayName: "Prof A",
    city: "X", country: "DE", primarySource: "SOLAR",
    capacityKwh: 100, inverterKw: 50, stateOfChargePct: 90, availableKwh: 90,
    pricePerKwhUsd: 0.04, delivered24hKwh: 100, deliveredLifetimeKwh: 1000,
    pctChange1h: 0, pctChange24h: 0, pctChange7d: 0, uptimePct: 99,
    weeklyOutput: [100, 100, 100, 100, 100, 100, 100],
    weatherCondition: "SUNNY", carbonOffsetKgCo2e: 50,
  },
  {
    id: "x2", rank: 902, handle: "test-prof-b", displayName: "Prof B",
    city: "X", country: "DE", primarySource: "WIND",
    capacityKwh: 100, inverterKw: 50, stateOfChargePct: 90, availableKwh: 90,
    pricePerKwhUsd: 0.04, delivered24hKwh: 100, deliveredLifetimeKwh: 1000,
    pctChange1h: 0, pctChange24h: 0, pctChange7d: 0, uptimePct: 99,
    weeklyOutput: [100, 100, 100, 100, 100, 100, 100],
    weatherCondition: "WINDY", carbonOffsetKgCo2e: 50,
  },
];

// Only "test-prof-a" has a profile; "test-prof-b" intentionally omitted
// to verify the seed gracefully skips producers without a matching profile.
const PROFILES: Record<string, ProducerProfile> = {
  "test-prof-a": {
    description: "A test company",
    founded: 1999,
    employees: "~10",
    website: "https://test-a.example",
    email: "ceo@test-a.example",
    phone: "+49 30 0000000",
    address: "Berlin, DE",
    ceo: "Jane Doe",
    certifications: ["ISO 9001"],
    keyProducts: ["Test panels"],
  },
};

async function cleanup() {
  await prisma.producerProfile.deleteMany({
    where: { producer: { handle: { in: TEST_HANDLES } } },
  });
  await prisma.producer.deleteMany({
    where: { handle: { in: TEST_HANDLES } },
  });
}

beforeAll(async () => {
  await cleanup();
  await seedProducers(prisma, ROWS); // arrange: producers must exist first
});
afterAll(cleanup);

describe("seedProducerProfiles", () => {
  it("creates profiles for matching producers only", async () => {
    const r = await seedProducerProfiles(prisma, PROFILES);
    expect(r.created).toBe(1);
    expect(r.skipped).toBe(0);

    const profA = await prisma.producerProfile.findFirst({
      where: { producer: { handle: "test-prof-a" } },
    });
    expect(profA?.description).toBe("A test company");
    expect(profA?.founded).toBe(1999);
    expect(profA?.certifications).toEqual(["ISO 9001"]);
    expect(profA?.keyProducts).toEqual(["Test panels"]);

    const profB = await prisma.producerProfile.findFirst({
      where: { producer: { handle: "test-prof-b" } },
    });
    expect(profB).toBeNull(); // no PROFILES entry → no row
  });

  it("is idempotent on re-run", async () => {
    const r = await seedProducerProfiles(prisma, PROFILES);
    expect(r.created).toBe(0);
    expect(r.skipped).toBe(1);

    const count = await prisma.producerProfile.count({
      where: { producer: { handle: { in: TEST_HANDLES } } },
    });
    expect(count).toBe(1);
  });

  it("silently skips profiles whose handle has no producer in DB", async () => {
    const r = await seedProducerProfiles(prisma, {
      ...PROFILES,
      "test-prof-nonexistent": PROFILES["test-prof-a"],
    });
    // "test-prof-a" already exists (skipped); nonexistent has no producer (skipped before insert).
    expect(r.created).toBe(0);
    expect(r.skipped).toBe(1); // only the existing one shows up; the nonexistent never enters `data`
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- src/lib/seed/producer-profiles.test.ts
```

Expected: FAIL — `Cannot find module './producer-profiles'`.

- [ ] **Step 3: Implement `seedProducerProfiles`**

Create `src/lib/seed/producer-profiles.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import type { ProducerProfile } from "@/lib/producers";
import type { SeedResult } from "./producers";

export async function seedProducerProfiles(
  prisma: PrismaClient,
  profiles: Record<string, ProducerProfile>,
): Promise<SeedResult> {
  const handles = Object.keys(profiles);
  const producers = await prisma.producer.findMany({
    where: { handle: { in: handles } },
    select: { id: true, handle: true },
  });
  const idByHandle = new Map(producers.map((p) => [p.handle, p.id]));

  const data = handles
    .filter((h) => idByHandle.has(h))
    .map((h) => {
      const p = profiles[h];
      return {
        producerId: idByHandle.get(h)!,
        description: p.description,
        founded: p.founded,
        employees: p.employees,
        website: p.website,
        email: p.email,
        phone: p.phone,
        address: p.address,
        ceo: p.ceo,
        stockTicker: p.stockTicker,
        certifications: p.certifications ?? [],
        keyProducts: p.keyProducts ?? [],
      };
    });

  const result = await prisma.producerProfile.createMany({
    data,
    skipDuplicates: true,
  });
  return { created: result.count, skipped: data.length - result.count };
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run:

```bash
npm test -- src/lib/seed/producer-profiles.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/seed/producer-profiles.ts src/lib/seed/producer-profiles.test.ts
git commit -m "feat(claim-r1): add idempotent seedProducerProfiles function

Looks up producer IDs by handle, inserts ProducerProfile rows for
handles that have a matching producer. Handles missing producers
gracefully (silent skip — caller decides whether to warn). Idempotent
via createMany skipDuplicates on producerId PK."
```

---

## Task 4: Top-level seed runner — `scripts/seed.ts`

**Files:**
- Create: `scripts/seed.ts`

- [ ] **Step 1: Create the runner**

Create `scripts/seed.ts`:

```ts
#!/usr/bin/env tsx
// Top-level seed runner: populates Producer + ProducerProfile from the mock
// arrays. Idempotent — safe to re-run after deploy. Invoked via
// `npm run db:seed`.

import { prisma } from "@/lib/prisma";
import { MOCK_PRODUCERS } from "@/lib/producers";
import { PRODUCER_PROFILES } from "@/lib/producer-profiles";
import { seedProducers } from "@/lib/seed/producers";
import { seedProducerProfiles } from "@/lib/seed/producer-profiles";

async function main() {
  console.log(`[seed] producers: starting (${MOCK_PRODUCERS.length} rows in source)`);
  const p = await seedProducers(prisma, MOCK_PRODUCERS);
  console.log(`[seed] producers: created=${p.created}, skipped=${p.skipped}`);

  console.log(`[seed] producer profiles: starting (${Object.keys(PRODUCER_PROFILES).length} entries in source)`);
  const pp = await seedProducerProfiles(prisma, PRODUCER_PROFILES);
  console.log(`[seed] producer profiles: created=${pp.created}, skipped=${pp.skipped}`);

  console.log(`[seed] done`);
}

main()
  .catch((err) => {
    console.error("[seed] FAILED:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Verify package.json already wires the runner**

Run:

```bash
grep '"db:seed"' package.json
```

Expected: `"db:seed": "tsx scripts/seed.ts",` (already present per current package.json — no edit needed).

- [ ] **Step 3: Run the seed end-to-end against the live DB**

Run:

```bash
npm run db:seed
```

Expected output (approximate counts):

```
[seed] producers: starting (100 rows in source)
[seed] producers: created=100, skipped=0
[seed] producer profiles: starting (XX entries in source)
[seed] producer profiles: created=XX, skipped=0
[seed] done
```

(XX = number of entries in `PRODUCER_PROFILES`. The exact count depends on how many of the 100 producers have a matching profile — verify after the first run; whatever number prints is the truth.)

- [ ] **Step 4: Run the seed a second time and verify idempotency**

Run:

```bash
npm run db:seed
```

Expected: `created=0, skipped=100` for producers, `created=0, skipped=XX` for profiles. No errors.

- [ ] **Step 5: Smoke-check the DB**

Run:

```bash
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const total = await p.producer.count();
  const energy = await p.producer.count({ where: { category: 'ENERGY_PRODUCER' } });
  const equip  = await p.producer.count({ where: { category: 'EQUIPMENT_MANUFACTURER' } });
  const profiles = await p.producerProfile.count();
  console.log({ total, energy, equip, profiles });
  await p.\$disconnect();
})();
"
```

Expected: `total=100`, `energy + equip === 100`, `profiles` matches the size of `PRODUCER_PROFILES`. Record these numbers in the commit message of Step 6.

- [ ] **Step 6: Commit**

```bash
git add scripts/seed.ts
git commit -m "feat(claim-r1): add scripts/seed.ts top-level runner

Calls seedProducers + seedProducerProfiles against the live DB with
the mock arrays. Idempotent: produced these counts on this run —
[fill in from Step 5: total=100, energy=N, equip=N, profiles=N]."
```

---

## Task 5: Full test suite + verify nothing else broke

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run:

```bash
npm test
```

Expected: all tests pass, including the seven new ones in `src/lib/seed/`. If any pre-existing tests fail, do NOT silence them — diagnose. The schema change should be additive and not affect any current code path.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npx tsc --noEmit
```

Expected: zero TypeScript errors. The new Prisma client types are picked up automatically because `npx prisma migrate dev` regenerates the client in Task 1.

- [ ] **Step 3: Verify the web app still boots**

Run:

```bash
pm2 restart poolwatt-web
sleep 3
pm2 logs poolwatt-web --lines 30 --nostream
```

Expected: no error lines after restart. The landing page still reads `MOCK_PRODUCERS` (reader swap is R2), so behavior should be unchanged.

Also do a curl smoke-check:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://poolwatt.com/en
```

Expected: `200`.

- [ ] **Step 4: No new commit needed — verification only**

If everything passed, R1 is done. If anything failed, fix it and add a separate commit. Do NOT amend prior commits.

---

## Self-review checklist (already done by plan author)

- **Spec coverage:** Each item from spec § "Data model > Producer (existing — extend)" and § "Data model > ProducerProfile (new — 1:1 to Producer)" maps to Task 1. § "Seeding & migration > Producer seed (R1)" maps to Tasks 2–4. Claim columns (`claimedById`, `claimedAt`), `ClaimToken`, `ChargerOperator`, polymorphic `BuildRequestClaim` deliberately excluded — they belong to R3, R5, R4 respectively.
- **Placeholders:** "XX = number of entries in `PRODUCER_PROFILES`" in Task 4 Step 3 is intentional (the engineer fills it in based on a real run); not a TBD.
- **Type consistency:** `SeedResult` defined in Task 2 (`{ created: number; skipped: number }`), reused in Task 3 via import. `seedProducers` and `seedProducerProfiles` both return it. Function signatures use `PrismaClient` from `@prisma/client`, matching the existing codebase pattern in `@/lib/prisma`.

---

## Definition of done for R1

- [ ] `prisma/schema.prisma` has `ProducerCategory` enum, three new `Producer` columns, and `ProducerProfile` model.
- [ ] A migration is recorded under `prisma/migrations/` and applied to the live DB.
- [ ] `src/lib/seed/producers.ts` + tests exist and pass.
- [ ] `src/lib/seed/producer-profiles.ts` + tests exist and pass.
- [ ] `scripts/seed.ts` runs idempotently and populates 100 producers + matching profiles.
- [ ] Full `npm test` and `npx tsc --noEmit` are green.
- [ ] `poolwatt-web` still serves the landing page (`HTTP 200` from `/en`).
- [ ] Four commits on `main`, each labeled `feat(claim-r1): …`.

**Next:** R2 — switch landing-page readers from `MOCK_PRODUCERS` to Prisma. Separate plan.
