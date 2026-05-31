# R2 — Readers on Prisma (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch `readTopProducers()` (landing) and the `/p/[handle]` detail page from reading the in-process `MOCK_PRODUCERS` array to reading the seeded `Producer` + `ProducerProfile` rows from Postgres. Operational/telemetry fields (state of charge, prices, weekly output, weather) remain sourced from the mock array since we have no telemetry pipeline yet — the DB is the source of truth for *card* data, the mock is the source of truth for *snapshot* data. UI is **byte-identical** after R2.

**Architecture:** A pure `mergeProducer(dbProducer, mockSnapshot): ProducerRow` helper combines the two sources into the same `ProducerRow` shape the UI already consumes. `readTopProducers()` joins `Producer` rows (top-100 by rank) to mock entries by handle. The detail page does a `findUnique({ where: { handle }, include: { profile: true } })` and merges the same way. No schema changes.

**Tech Stack:** Prisma 5 (PostgreSQL), Next.js 16 App Router, Vitest (real-DB integration tests), existing `@/lib/prisma` client.

**Spec reference:** `docs/superpowers/specs/2026-05-31-claim-your-card-design.md` § "Reader swap (R2)".

**Out of R2 (later releases):**
- Claim flow / cabinet / edit forms → R3
- Polymorphic `BuildRequestClaim` + Producer BR feed → R4
- `ChargerOperator` cabinet → R5
- Real `ProducerSnapshot` reads (replacing the mock-snapshot enrichment) → when grid worker lands in Phase 2

---

## Why the merge layer (and not a snapshot seed)

The `ProducerSnapshot` table exists in schema but is not populated, and the mock arrays contain seven "fake telemetry" fields per row (`stateOfChargePct`, `availableKwh`, `pricePerKwhUsd`, `delivered24hKwh`, `deliveredLifetimeKwh`, `pctChange1h/24h/7d`, `uptimePct`, `weeklyOutput[]`, `weatherCondition`, `carbonOffsetKgCo2e`). Three options were considered:

1. Seed `ProducerSnapshot` rows from the mock — but `weeklyOutput[]` has no column in the schema, and adding columns to chase the mock's fake data is wrong scope.
2. Generate snapshot data deterministically from the handle — same UI, but throws away the curated mock numbers and loses the visual continuity.
3. Keep mock as snapshot source, DB as card source (this plan) — minimal change, byte-identical UI, easy to swap to real `ProducerSnapshot` later.

Option 3 wins on YAGNI grounds. When real telemetry lands, the merge layer's snapshot-source argument is the only thing that changes.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/merge-producer.ts` | create | Pure `mergeProducer(db, snapshot)` returning `ProducerRow`. |
| `src/lib/merge-producer.test.ts` | create | Unit tests for the merge (no DB — fixtures only). |
| `src/lib/snapshot.ts` | modify | `readTopProducers()` body switches to Prisma + merge. |
| `src/lib/snapshot.test.ts` | create | Integration test against live-seeded DB. Asserts `readTopProducers()` returns 100 well-shaped rows. |
| `src/app/[locale]/p/[handle]/page.tsx` | modify | Both `generateMetadata` and `ProducerPage` switch to `prisma.producer.findUnique`. Removes `MOCK_PRODUCERS` + `PRODUCER_PROFILES` imports. |

The merge helper is split out so it can be unit-tested without any DB and so R3 (cabinet edits) can reuse it without touching `snapshot.ts`.

---

## Task 1: Pure merge helper `mergeProducer`

**Files:**
- Create: `src/lib/merge-producer.ts`
- Test: `src/lib/merge-producer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/merge-producer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mergeProducer, type ProducerSnapshotData } from "./merge-producer";
import type { Producer, ProducerProfile as DbProducerProfile } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

function fakeDb(overrides: Partial<Producer> = {}, profile: DbProducerProfile | null = null) {
  const base: Producer = {
    id: "p_test",
    slug: "test-handle",
    handle: "test-handle",
    displayName: "Test Co",
    city: "Berlin",
    region: null,
    country: "DE",
    lat: null,
    lng: null,
    primarySource: "SOLAR",
    sourceMix: null,
    capacityKwh: new Decimal(500),
    inverterKw: new Decimal(180),
    installedAt: null,
    source: "SELF_ENROLLED",
    isActive: true,
    rank: 42,
    logoUrl: null,
    bannerUrl: null,
    bio: null,
    websiteUrl: null,
    twitterUrl: null,
    ownerId: null,
    addedByAdminId: null,
    approvedFromRequestId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    metadataFetchedAt: null,
    category: "ENERGY_PRODUCER",
    equipment: [],
    manufactures: [],
    ...overrides,
  };
  return { ...base, profile };
}

const SNAPSHOT: ProducerSnapshotData = {
  stateOfChargePct: 88,
  availableKwh: 440,
  pricePerKwhUsd: 0.052,
  delivered24hKwh: 960,
  deliveredLifetimeKwh: 3_800_000,
  pctChange1h: 0.3,
  pctChange24h: 1.8,
  pctChange7d: 4.5,
  uptimePct: 99.6,
  weeklyOutput: [940, 970, 950, 980, 960, 955, 960],
  weatherCondition: "SUNNY",
  carbonOffsetKgCo2e: 429,
};

describe("mergeProducer", () => {
  it("takes card fields from DB and operational fields from snapshot", () => {
    const db = fakeDb({ displayName: "Renamed", country: "FR" });
    const row = mergeProducer(db, SNAPSHOT);
    expect(row.displayName).toBe("Renamed");
    expect(row.country).toBe("FR");
    expect(row.stateOfChargePct).toBe(88);
    expect(row.weeklyOutput).toEqual([940, 970, 950, 980, 960, 955, 960]);
    expect(row.weatherCondition).toBe("SUNNY");
  });

  it("converts Decimal to number for capacityKwh and inverterKw", () => {
    const db = fakeDb({
      capacityKwh: new Decimal("420.5"),
      inverterKw: new Decimal("150"),
    });
    const row = mergeProducer(db, SNAPSHOT);
    expect(typeof row.capacityKwh).toBe("number");
    expect(row.capacityKwh).toBe(420.5);
    expect(typeof row.inverterKw).toBe("number");
    expect(row.inverterKw).toBe(150);
  });

  it("copies category enum (string) through", () => {
    const db = fakeDb({ category: "EQUIPMENT_MANUFACTURER" });
    const row = mergeProducer(db, SNAPSHOT);
    expect(row.category).toBe("EQUIPMENT_MANUFACTURER");
  });

  it("copies equipment[] and manufactures[]", () => {
    const db = fakeDb({
      equipment: ["Inverter X"],
      manufactures: ["Module Y"],
    });
    const row = mergeProducer(db, SNAPSHOT);
    expect(row.equipment).toEqual(["Inverter X"]);
    expect(row.manufactures).toEqual(["Module Y"]);
  });

  it("converts DB profile to mock-profile shape when present", () => {
    const profile: DbProducerProfile = {
      producerId: "p_test",
      description: "About",
      founded: 2010,
      employees: "~100",
      website: "https://test.example",
      email: "ceo@test.example",
      phone: "+49 30 1",
      address: "Berlin",
      ceo: "Jane",
      stockTicker: "TST",
      certifications: ["ISO 9001"],
      keyProducts: ["Panels"],
      updatedAt: new Date(),
    };
    const db = fakeDb({}, profile);
    const row = mergeProducer(db, SNAPSHOT);
    expect(row.profile).toBeDefined();
    expect(row.profile?.description).toBe("About");
    expect(row.profile?.founded).toBe(2010);
    expect(row.profile?.certifications).toEqual(["ISO 9001"]);
    expect(row.profile?.stockTicker).toBe("TST");
  });

  it("omits profile field when DB profile is null", () => {
    const row = mergeProducer(fakeDb({}, null), SNAPSHOT);
    expect(row.profile).toBeUndefined();
  });

  it("falls back to empty string when DB city is null (mock requires string)", () => {
    const row = mergeProducer(fakeDb({ city: null }), SNAPSHOT);
    expect(row.city).toBe("");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm test -- src/lib/merge-producer.test.ts
```

Expected: FAIL — `Cannot find module './merge-producer'`.

- [ ] **Step 3: Implement `mergeProducer`**

Create `src/lib/merge-producer.ts`:

```ts
import type { Producer, ProducerProfile as DbProducerProfile } from "@prisma/client";
import type { ProducerRow, ProducerProfile as MockProducerProfile } from "@/lib/producers";

export type ProducerSnapshotData = Pick<
  ProducerRow,
  | "stateOfChargePct"
  | "availableKwh"
  | "pricePerKwhUsd"
  | "delivered24hKwh"
  | "deliveredLifetimeKwh"
  | "pctChange1h"
  | "pctChange24h"
  | "pctChange7d"
  | "uptimePct"
  | "weeklyOutput"
  | "weatherCondition"
  | "carbonOffsetKgCo2e"
>;

export type DbProducerWithProfile = Producer & {
  profile: DbProducerProfile | null;
};

export function mergeProducer(
  db: DbProducerWithProfile,
  snapshot: ProducerSnapshotData,
): ProducerRow {
  return {
    // DB-sourced card fields
    id: db.id,
    rank: db.rank,
    handle: db.handle,
    displayName: db.displayName,
    city: db.city ?? "",
    country: db.country,
    primarySource: db.primarySource,
    category: db.category,
    capacityKwh: Number(db.capacityKwh),
    inverterKw: Number(db.inverterKw),
    equipment: db.equipment,
    manufactures: db.manufactures,
    profile: db.profile ? toMockProfile(db.profile) : undefined,
    // Mock-sourced operational fields (until a real telemetry pipeline lands)
    stateOfChargePct: snapshot.stateOfChargePct,
    availableKwh: snapshot.availableKwh,
    pricePerKwhUsd: snapshot.pricePerKwhUsd,
    delivered24hKwh: snapshot.delivered24hKwh,
    deliveredLifetimeKwh: snapshot.deliveredLifetimeKwh,
    pctChange1h: snapshot.pctChange1h,
    pctChange24h: snapshot.pctChange24h,
    pctChange7d: snapshot.pctChange7d,
    uptimePct: snapshot.uptimePct,
    weeklyOutput: snapshot.weeklyOutput,
    weatherCondition: snapshot.weatherCondition,
    carbonOffsetKgCo2e: snapshot.carbonOffsetKgCo2e,
  };
}

function toMockProfile(db: DbProducerProfile): MockProducerProfile {
  return {
    description: db.description ?? "",
    founded: db.founded ?? 0,
    employees: db.employees ?? "",
    website: db.website ?? "",
    email: db.email ?? "",
    phone: db.phone ?? "",
    address: db.address ?? "",
    ceo: db.ceo ?? "",
    stockTicker: db.stockTicker ?? undefined,
    certifications: db.certifications,
    keyProducts: db.keyProducts,
  };
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
npm test -- src/lib/merge-producer.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 5: Verify isolation**

```bash
npm test -- src/lib/merge-producer.test.ts -t "DB profile is null"
```

Expected: 1 pass, 6 skipped. (Confirms tests don't share state — they're pure unit tests.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/merge-producer.ts src/lib/merge-producer.test.ts
git commit -m "feat(claim-r2): add pure mergeProducer helper

Combines a Prisma Producer (+ProducerProfile) row with mock snapshot
data into the existing ProducerRow shape the UI consumes. DB is
authoritative for card fields (name, country, equipment, profile);
snapshot arg provides the operational fields (SoC, prices, weekly
output) until a real telemetry pipeline lands. Pure function, no DB
dependency in tests."
```

---

## Task 2: Switch `readTopProducers` to Prisma

**Files:**
- Modify: `src/lib/snapshot.ts` (lines 13-15)
- Test: `src/lib/snapshot.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `src/lib/snapshot.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readTopProducers } from "./snapshot";

describe("readTopProducers (DB-backed)", () => {
  it("returns 100 rows ordered by rank ascending", async () => {
    const rows = await readTopProducers();
    expect(rows).toHaveLength(100);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].rank).toBeGreaterThanOrEqual(rows[i - 1].rank);
    }
  });

  it("returns rows shaped like ProducerRow with both card and snapshot fields", async () => {
    const rows = await readTopProducers();
    const r = rows[0];
    // card (from DB)
    expect(typeof r.handle).toBe("string");
    expect(typeof r.displayName).toBe("string");
    expect(typeof r.country).toBe("string");
    expect(typeof r.capacityKwh).toBe("number"); // Decimal → number
    expect(typeof r.inverterKw).toBe("number");
    // snapshot (from mock)
    expect(typeof r.stateOfChargePct).toBe("number");
    expect(typeof r.pricePerKwhUsd).toBe("number");
    expect(Array.isArray(r.weeklyOutput)).toBe(true);
    expect(r.weeklyOutput).toHaveLength(7);
    expect(typeof r.weatherCondition).toBe("string");
  });

  it("returns the rank-1 producer matching the seed (jinko-solar-haining)", async () => {
    const rows = await readTopProducers();
    const top = rows.find((r) => r.rank === 1);
    expect(top?.handle).toBe("jinko-solar-haining");
    expect(top?.displayName).toBe("JinkoSolar — Haining");
    expect(top?.country).toBe("CN");
    expect(top?.primarySource).toBe("SOLAR");
  });

  it("populates profile from DB when the producer has one (jinko has a PRODUCER_PROFILES entry)", async () => {
    const rows = await readTopProducers();
    const jinko = rows.find((r) => r.handle === "jinko-solar-haining");
    expect(jinko?.profile).toBeDefined();
    expect(jinko?.profile?.ceo).toBe("Xiande Li");
    expect(jinko?.profile?.founded).toBe(2006);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm test -- src/lib/snapshot.test.ts
```

Expected: ALL FOUR tests fail. The first three with assertions on `displayName` / `profile` will still fail in current state because `readTopProducers()` returns mock objects with mock `displayName` (which happens to match) but **`r.profile` will be undefined** (mocks don't populate profile that way) and **`r.capacityKwh` is already a number** (passes by coincidence). The actual signal is `profile?.ceo` — the mock doesn't attach profile, so this assertion fails.

(If by coincidence all four tests pass, that means the mock array happens to satisfy the assertions even without DB integration. That's fine — proceed to Step 3, where after the swap, the same tests must STILL pass against DB-backed data, which is the real verification.)

- [ ] **Step 3: Switch `readTopProducers` to Prisma**

Edit `src/lib/snapshot.ts`. Replace this block:

```ts
import { unstable_cache } from "next/cache";
import { MOCK_PRODUCERS, MOCK_GRID_STATS, type ProducerRow, type GridSnap } from "./producers";
```

with:

```ts
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { MOCK_PRODUCERS, MOCK_GRID_STATS, type ProducerRow, type GridSnap } from "./producers";
import { mergeProducer } from "@/lib/merge-producer";
```

Then replace this function body:

```ts
export async function readTopProducers(): Promise<ProducerRow[]> {
  return MOCK_PRODUCERS;
}
```

with:

```ts
export async function readTopProducers(): Promise<ProducerRow[]> {
  const dbProducers = await prisma.producer.findMany({
    orderBy: { rank: "asc" },
    take: 100,
    include: { profile: true },
  });
  const snapshotByHandle = new Map(MOCK_PRODUCERS.map((m) => [m.handle, m]));
  return dbProducers.map((db) => {
    const snapshot = snapshotByHandle.get(db.handle);
    if (!snapshot) {
      throw new Error(
        `[readTopProducers] no mock snapshot for handle "${db.handle}" — seed inconsistency`,
      );
    }
    return mergeProducer(db, snapshot);
  });
}
```

Leave `readGridStats`, `readGreenIndex`, `readNews`, `readExchangeRates` untouched.

- [ ] **Step 4: Run tests and verify they pass**

```bash
npm test -- src/lib/snapshot.test.ts
```

Expected: 4 tests pass. (Reads 100 rows from DB, merges with mock snapshots, profile/CEO present.)

- [ ] **Step 5: Run the full test suite to confirm no regressions**

```bash
npm test
```

Expected: all suites green.

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/snapshot.ts src/lib/snapshot.test.ts
git commit -m "feat(claim-r2): switch readTopProducers to Prisma + merge

Landing-page producer list now reads Producer + ProducerProfile from
Postgres (top 100 by rank), enriched with mock snapshot data via
mergeProducer. UI shape unchanged."
```

---

## Task 3: Switch `/p/[handle]` detail page to Prisma

**Files:**
- Modify: `src/app/[locale]/p/[handle]/page.tsx`

- [ ] **Step 1: Read the current file to confirm starting state**

```bash
head -50 src/app/[locale]/p/[handle]/page.tsx
```

Confirm that `generateMetadata` and `ProducerPage` both call `MOCK_PRODUCERS.find((p) => p.handle === handle)` and that `PRODUCER_PROFILES[handle]` is used for the profile lookup.

- [ ] **Step 2: Edit the imports**

Open `src/app/[locale]/p/[handle]/page.tsx`. Replace the top imports block:

```ts
import { MOCK_PRODUCERS } from "@/lib/producers";
import { PRODUCER_PROFILES } from "@/lib/producer-profiles";
```

with:

```ts
import { MOCK_PRODUCERS } from "@/lib/producers";
import { prisma } from "@/lib/prisma";
import { mergeProducer } from "@/lib/merge-producer";
```

Note: `MOCK_PRODUCERS` stays imported (used as snapshot source). `PRODUCER_PROFILES` import is removed — profile now comes from DB via `mergeProducer`.

- [ ] **Step 3: Replace the `generateMetadata` body**

Find:

```ts
export async function generateMetadata({ params }: Props) {
  const { handle } = await params;
  const producer = MOCK_PRODUCERS.find((p) => p.handle === handle);
  if (!producer) return { title: "Not Found — Poolwatt" };
  return {
    title: `${producer.displayName} — Poolwatt`,
    description: `${producer.displayName} — renewable energy producer on the Poolwatt grid. ${producer.primarySource} · ${producer.city}, ${producer.country}`,
  };
}
```

Replace with:

```ts
export async function generateMetadata({ params }: Props) {
  const { handle } = await params;
  const producer = await prisma.producer.findUnique({
    where: { handle },
    select: { displayName: true, primarySource: true, city: true, country: true },
  });
  if (!producer) return { title: "Not Found — Poolwatt" };
  return {
    title: `${producer.displayName} — Poolwatt`,
    description: `${producer.displayName} — renewable energy producer on the Poolwatt grid. ${producer.primarySource} · ${producer.city ?? ""}, ${producer.country}`,
  };
}
```

- [ ] **Step 4: Replace the `ProducerPage` body's producer lookup**

Find:

```ts
  const producer = MOCK_PRODUCERS.find((p) => p.handle === handle);
  if (!producer) notFound();

  const profile = PRODUCER_PROFILES[handle] ?? null;
  const isOEM = producer.category === "EQUIPMENT_MANUFACTURER";
```

Replace with:

```ts
  const dbProducer = await prisma.producer.findUnique({
    where: { handle },
    include: { profile: true },
  });
  if (!dbProducer) notFound();

  const snapshot = MOCK_PRODUCERS.find((m) => m.handle === handle);
  if (!snapshot) notFound();

  const producer = mergeProducer(dbProducer, snapshot);
  const profile = producer.profile ?? null;
  const isOEM = producer.category === "EQUIPMENT_MANUFACTURER";
```

(The rest of the JSX uses `producer.*` and `profile.*` — these continue to work because the merged `ProducerRow` has the same shape as the old mock entry.)

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Run the test suite**

```bash
npm test
```

Expected: all suites green. (No new tests for the page — it's covered by visual smoke check in Task 4.)

- [ ] **Step 7: Commit**

```bash
git add src/app/[locale]/p/[handle]/page.tsx
git commit -m "feat(claim-r2): switch /p/[handle] detail page to Prisma

generateMetadata and ProducerPage now read Producer (and profile) from
Postgres via findUnique, then merge with the mock snapshot for
operational fields. Removed PRODUCER_PROFILES import (profile sourced
from DB now)."
```

---

## Task 4: Visual / smoke verification + pm2 restart

**Files:** none (verification only)

- [ ] **Step 1: Restart the web process and tail logs for errors**

```bash
pm2 restart poolwatt-web
sleep 4
pm2 logs poolwatt-web --lines 40 --nostream
```

Expected: no new error lines after the restart timestamp. If you see runtime errors mentioning `mergeProducer`, `prisma.producer.findUnique`, or `Cannot read properties of undefined`, STOP and report — the swap is broken.

- [ ] **Step 2: Smoke-check the landing page**

```bash
curl -sS -o /dev/null -w "HTTP %{http_code}  size=%{size_download}\n" https://poolwatt.com/en
```

Expected: `HTTP 200` and `size_download` > 50000 bytes (the landing has ~200KB of HTML; if the size is suspiciously small the page rendered an error state).

- [ ] **Step 3: Smoke-check a producer detail page**

```bash
curl -sS https://poolwatt.com/en/p/jinko-solar-haining | grep -c "JinkoSolar"
```

Expected: a number ≥ 3 (the brand appears in title, header, and body sections). If 0, the detail page is broken.

```bash
curl -sS https://poolwatt.com/en/p/jinko-solar-haining | grep -c "Xiande Li"
```

Expected: ≥ 1 (CEO from `ProducerProfile`). Confirms the profile was loaded from DB.

- [ ] **Step 4: Spot-check an equipment manufacturer page**

```bash
curl -sS https://poolwatt.com/en/p/catl-ningde | grep -c "Equipment Manufacturer"
```

Expected: ≥ 1 (the OEM badge in the header). Confirms the `category` field flowed through.

- [ ] **Step 5: Confirm a non-existent handle returns 404**

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://poolwatt.com/en/p/this-does-not-exist
```

Expected: `404`.

- [ ] **Step 6: No commit — verification only**

If all five checks passed, R2 is done. If anything failed, fix forward with a new commit. Do NOT amend prior commits.

---

## Definition of done for R2

- [ ] `src/lib/merge-producer.ts` exports a pure `mergeProducer` function + `ProducerSnapshotData` type, tested with 7 unit tests.
- [ ] `src/lib/snapshot.ts:readTopProducers()` reads from Prisma and merges with mock snapshots, tested with 4 integration tests against the live-seeded DB.
- [ ] `src/app/[locale]/p/[handle]/page.tsx` (both `generateMetadata` and `ProducerPage`) reads from Prisma. `PRODUCER_PROFILES` import removed.
- [ ] `npm test` and `npx tsc --noEmit` green.
- [ ] Landing page renders 100 producers correctly (HTTP 200, large response).
- [ ] Detail page renders correctly for `jinko-solar-haining` (brand + CEO present) and `catl-ningde` (OEM badge present).
- [ ] Non-existent handle returns 404.
- [ ] 3 commits on `main`, each `feat(claim-r2): …`.

**Next:** R3 — Producer cabinet (claim flow + edit, no BR feed yet). Separate plan.

---

## Self-review (already done)

- **Spec coverage:** Spec § "Reader swap (R2)" calls out exactly two read sites — `readTopProducers()` in `snapshot.ts` and the `findUnique` on the detail page. Tasks 2 and 3 cover both. The spec also says "`MOCK_PRODUCERS` and `PRODUCER_PROFILES` stay in source as seed input; deletion deferred until R2 is one-month stable" — this plan respects that: only `PRODUCER_PROFILES` import is removed from the detail page (its export remains for the seed script in `scripts/seed.ts`); `MOCK_PRODUCERS` import is kept (now used as snapshot source).
- **Placeholders:** None. Every code block is complete. The Step 2 "expected fail" in Task 2 has a paragraph explaining the test may pass by coincidence — that's documentation, not a placeholder.
- **Type consistency:** `mergeProducer(db, snapshot): ProducerRow` is consistent in Tasks 1, 2, 3. `ProducerSnapshotData` is defined in Task 1 and not redefined elsewhere. `DbProducerWithProfile` is exported from `merge-producer.ts` but not re-used by Tasks 2/3 (they pass the raw `findMany`/`findUnique` result, whose inferred Prisma type assigns to it implicitly).
