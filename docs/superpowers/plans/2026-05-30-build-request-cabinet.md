# Build-Request Cabinet V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the V1 build-request cabinet — a 4-section form in `/me/build-requests/new` that lets a signed-in homeowner file a "build me a home power station" request, with admin-only triage at `/admin/build-requests`.

**Architecture:** Server Components + Server Actions (no REST). All mutations go through `"use server"` actions that gate on `auth()`. New Prisma model `BuildRequest` (no relation to existing `Producer`). Resend-backed email side effects with graceful no-key fallback (same pattern as `src/lib/resend.ts`).

**Tech Stack:** Next.js 16 App Router, React 19 server components, Prisma 5, PostgreSQL, Auth.js v5 (Credentials), zod 4, next-intl 4, Resend 6, Vitest, Playwright (system Chrome).

**Spec:** `docs/superpowers/specs/2026-05-30-build-request-cabinet-design.md`

---

## Conventions across this plan

- **TDD**: every server action + every schema → failing test first.
- **Test layout**: unit/integration tests are co-located `*.test.ts` next to source (matches `src/lib/news.test.ts`). E2E specs live in `tests/e2e/`.
- **Commits**: one commit per task, message format `feat(build-request): <what>` or `chore(build-request): <what>`. After every commit run `npm run lint && npm run test` and only commit if green.
- **i18n**: every user-visible string in EN + RU + SK at task time. Other 26 locales fall back to EN; a follow-up task is not in this plan.
- **Path aliases**: `@/lib/*`, `@/components/*`, etc. — see `tsconfig.json`. Use them everywhere.

---

## Task 1: Prisma schema — BuildRequest model + User.phone

**Files:**
- Modify: `prisma/schema.prisma` (add enums, model, User relations + phone column)
- Create: `prisma/migrations/<timestamp>_add_build_request/migration.sql` (auto-generated)

- [ ] **Step 1: Add enums to schema**

Append to `prisma/schema.prisma` (after the existing `AdminAction` enum, before any model that would reference them — Prisma is order-insensitive, but keep enums grouped at the bottom for grep-ability):

```prisma
enum BuildRequestSource {
  SOLAR
  WIND
  HYBRID
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
  OPEN
  MATCHED
  FULFILLED
  CANCELLED
}
```

- [ ] **Step 2: Add `BuildRequest` model**

Append after the enums:

```prisma
model BuildRequest {
  id                String                       @id @default(cuid())
  userId            String
  user              User                         @relation("BuildRequestOwner", fields: [userId], references: [id], onDelete: Cascade)

  source            BuildRequestSource
  peakKw            Decimal                      @db.Decimal(8, 2)
  wantPowerbank     Boolean                      @default(false)
  powerbankKwh      Decimal?                     @db.Decimal(8, 2)
  wantEvCharger     Boolean                      @default(false)
  evChargerPorts    Int?
  evPublicForSale   Boolean                      @default(false)

  country           String
  city              String
  addressLine       String
  lat               Float?
  lng               Float?
  siteType          BuildRequestSiteType
  availableAreaM2   Int?
  roofOrientation   BuildRequestRoofOrientation?

  budget            BuildRequestBudget           @default(AWAITING_QUOTE)
  timeline          BuildRequestTimeline         @default(EXPLORING)
  notes             String?                      @db.Text

  status            BuildRequestStatus           @default(OPEN)
  adminNote         String?                      @db.Text
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

- [ ] **Step 3: Extend `User` model**

In the existing `User { ... }` block, add `phone` after `image` (alphabetically with other optional contact fields) and add two new relations at the bottom alongside `producerRequests`:

```prisma
model User {
  // existing fields…
  image             String?
  phone             String?                                       // E.164, optional
  // …

  // existing relations…
  producerRequests        ProducerRequest[]
  reviewedRequests        ProducerRequest[]       @relation("RequestReviewer")
  buildRequests           BuildRequest[]          @relation("BuildRequestOwner")
  reviewedBuildRequests   BuildRequest[]          @relation("BuildRequestReviewer")
  // …
}
```

- [ ] **Step 4: Generate the migration**

Run: `npm run db:migrate -- --name add_build_request`
Expected: prompts confirm migration name, then prints `Your database is now in sync with your schema.` and `✔ Generated Prisma Client`.

If it fails because the dev DB doesn't exist, check `DATABASE_URL` in `.env`. Migrations write to local dev DB only — server has its own.

- [ ] **Step 5: Verify with `prisma studio`**

Run: `npm run db:studio`
Expected: a `BuildRequest` table appears in the left sidebar; `User` table shows new `phone` column. Close studio.

- [ ] **Step 6: Verify Prisma Client types compile**

Create a throwaway file `/tmp/check-build-request-types.ts`:

```ts
import { prisma } from "@/lib/prisma";
import type { BuildRequest, BuildRequestStatus } from "@prisma/client";

async function _check() {
  const r: BuildRequest = await prisma.buildRequest.findFirstOrThrow();
  const s: BuildRequestStatus = "OPEN";
  return [r, s];
}
```

Run: `npx tsc --noEmit /tmp/check-build-request-types.ts`
Expected: no output (success). Delete the file.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(build-request): add BuildRequest Prisma model + User.phone column"
```

---

## Task 2: Zod validation schema (TDD)

**Files:**
- Create: `src/lib/build-request-schema.ts`
- Create: `src/lib/build-request-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/build-request-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildRequestSchema } from "./build-request-schema";

const valid = {
  source: "SOLAR",
  peakKw: 5,
  wantPowerbank: false,
  wantEvCharger: false,
  evPublicForSale: false,
  country: "SK",
  city: "Bratislava",
  addressLine: "Hlavná 1",
  siteType: "PRIVATE_HOUSE",
  roofOrientation: "S",
  budget: "AWAITING_QUOTE",
  timeline: "EXPLORING",
};

describe("buildRequestSchema", () => {
  it("accepts a minimal valid solar request", () => {
    expect(buildRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects peakKw out of range", () => {
    const r = buildRequestSchema.safeParse({ ...valid, peakKw: 0.1 });
    expect(r.success).toBe(false);
  });

  it("requires powerbankKwh when wantPowerbank is true", () => {
    const r = buildRequestSchema.safeParse({ ...valid, wantPowerbank: true });
    expect(r.success).toBe(false);
  });

  it("accepts wantPowerbank with valid powerbankKwh", () => {
    const r = buildRequestSchema.safeParse({ ...valid, wantPowerbank: true, powerbankKwh: 10 });
    expect(r.success).toBe(true);
  });

  it("requires evChargerPorts when wantEvCharger is true", () => {
    const r = buildRequestSchema.safeParse({ ...valid, wantEvCharger: true });
    expect(r.success).toBe(false);
  });

  it("rejects evPublicForSale=true without wantEvCharger", () => {
    const r = buildRequestSchema.safeParse({ ...valid, evPublicForSale: true });
    expect(r.success).toBe(false);
  });

  it("requires roofOrientation when source is SOLAR or HYBRID", () => {
    const { roofOrientation: _, ...withoutOrientation } = valid;
    const r = buildRequestSchema.safeParse(withoutOrientation);
    expect(r.success).toBe(false);
  });

  it("allows missing roofOrientation when source is WIND", () => {
    const { roofOrientation: _, ...withoutOrientation } = valid;
    const r = buildRequestSchema.safeParse({ ...withoutOrientation, source: "WIND" });
    expect(r.success).toBe(true);
  });

  it("rejects country that is not ISO-2", () => {
    const r = buildRequestSchema.safeParse({ ...valid, country: "slo" });
    expect(r.success).toBe(false);
  });

  it("rejects notes longer than 1000 chars", () => {
    const r = buildRequestSchema.safeParse({ ...valid, notes: "x".repeat(1001) });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/build-request-schema.test.ts`
Expected: FAIL — `Failed to load url ./build-request-schema`.

- [ ] **Step 3: Implement the schema**

Create `src/lib/build-request-schema.ts`:

```ts
import { z } from "zod";

const sourceEnum = z.enum(["SOLAR", "WIND", "HYBRID"]);
const siteTypeEnum = z.enum(["PRIVATE_HOUSE", "APARTMENT_ROOF", "LAND_PLOT", "COMMERCIAL"]);
const roofOrientationEnum = z.enum(["S", "SE", "SW", "E", "W", "UNKNOWN"]);
const budgetEnum = z.enum([
  "UNDER_5K", "FROM_5K_TO_15K", "FROM_15K_TO_30K", "FROM_30K_TO_60K",
  "OVER_60K", "AWAITING_QUOTE",
]);
const timelineEnum = z.enum(["URGENT_1_3M", "WITHIN_YEAR", "EXPLORING"]);

export const buildRequestSchema = z
  .object({
    source: sourceEnum,
    peakKw: z.number().min(0.5).max(500),
    wantPowerbank: z.boolean(),
    powerbankKwh: z.number().min(1).max(500).optional(),
    wantEvCharger: z.boolean(),
    evChargerPorts: z.number().int().min(1).max(10).optional(),
    evPublicForSale: z.boolean(),

    country: z.string().regex(/^[A-Z]{2}$/, "Country must be ISO-2 uppercase"),
    city: z.string().min(1).max(80),
    addressLine: z.string().min(1).max(200),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    siteType: siteTypeEnum,
    availableAreaM2: z.number().int().min(0).max(100_000).optional(),
    roofOrientation: roofOrientationEnum.optional(),

    budget: budgetEnum,
    timeline: timelineEnum,
    notes: z.string().max(1000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.wantPowerbank && data.powerbankKwh == null) {
      ctx.addIssue({
        code: "custom",
        path: ["powerbankKwh"],
        message: "powerbankKwh is required when wantPowerbank is true",
      });
    }
    if (data.wantEvCharger && data.evChargerPorts == null) {
      ctx.addIssue({
        code: "custom",
        path: ["evChargerPorts"],
        message: "evChargerPorts is required when wantEvCharger is true",
      });
    }
    if (data.evPublicForSale && !data.wantEvCharger) {
      ctx.addIssue({
        code: "custom",
        path: ["evPublicForSale"],
        message: "evPublicForSale requires wantEvCharger",
      });
    }
    if ((data.source === "SOLAR" || data.source === "HYBRID") && data.roofOrientation == null) {
      ctx.addIssue({
        code: "custom",
        path: ["roofOrientation"],
        message: "roofOrientation is required for SOLAR/HYBRID",
      });
    }
  });

export type BuildRequestInput = z.infer<typeof buildRequestSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/build-request-schema.test.ts`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/build-request-schema.ts src/lib/build-request-schema.test.ts
git commit -m "feat(build-request): add zod validation schema"
```

---

## Task 3: Server action `createBuildRequest` (TDD)

**Files:**
- Create: `src/app/[locale]/me/build-requests/actions.ts`
- Create: `src/app/[locale]/me/build-requests/actions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/[locale]/me/build-requests/actions.test.ts`. This is an **integration test** — it hits the real dev DB (`DATABASE_URL` from `.env`) and mocks only `auth()`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createBuildRequest } from "./actions";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));
vi.mock("@/lib/resend-build-request", () => ({
  sendBuildRequestNewToAdmin: vi.fn(),
}));

import { auth } from "@/lib/auth";
const mockedAuth = vi.mocked(auth);

async function ensureUser(username: string) {
  return prisma.user.upsert({
    where: { username },
    update: {},
    create: { username, passwordHash: "x" },
  });
}

const formInput = {
  source: "SOLAR" as const,
  peakKw: 5,
  wantPowerbank: false,
  wantEvCharger: false,
  evPublicForSale: false,
  country: "SK",
  city: "Bratislava",
  addressLine: "Hlavná 1",
  siteType: "PRIVATE_HOUSE" as const,
  roofOrientation: "S" as const,
  budget: "AWAITING_QUOTE" as const,
  timeline: "EXPLORING" as const,
};

describe("createBuildRequest", () => {
  beforeEach(async () => {
    await prisma.buildRequest.deleteMany({ where: { user: { username: { startsWith: "test_br_" } } } });
  });

  it("rejects when not authenticated", async () => {
    mockedAuth.mockResolvedValueOnce(null as never);
    const r = await createBuildRequest(formInput);
    expect(r.ok).toBe(false);
    expect(r.formError).toMatch(/auth/i);
  });

  it("creates a request with status OPEN for an authed user", async () => {
    const u = await ensureUser("test_br_alice");
    mockedAuth.mockResolvedValueOnce({ user: { id: u.id, username: u.username, role: "USER" } } as never);

    const r = await createBuildRequest(formInput);

    expect(r.ok).toBe(true);
    expect(r.id).toBeDefined();
    const stored = await prisma.buildRequest.findUniqueOrThrow({ where: { id: r.id! } });
    expect(stored.status).toBe("OPEN");
    expect(stored.userId).toBe(u.id);
    expect(stored.peakKw.toNumber()).toBe(5);
  });

  it("returns fieldErrors on invalid input", async () => {
    const u = await ensureUser("test_br_bob");
    mockedAuth.mockResolvedValueOnce({ user: { id: u.id, username: u.username, role: "USER" } } as never);

    const r = await createBuildRequest({ ...formInput, peakKw: 0.1 });
    expect(r.ok).toBe(false);
    expect(r.fieldErrors?.peakKw).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/[locale]/me/build-requests/actions.test.ts`
Expected: FAIL — module `./actions` not found.

- [ ] **Step 3: Implement `createBuildRequest`**

Create `src/app/[locale]/me/build-requests/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildRequestSchema, type BuildRequestInput } from "@/lib/build-request-schema";

export type ActionResult = {
  ok: boolean;
  id?: string;
  fieldErrors?: Record<string, string>;
  formError?: string;
};

export async function createBuildRequest(input: BuildRequestInput): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated" };

  const parsed = buildRequestSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0];
      if (typeof k === "string" && !fieldErrors[k]) fieldErrors[k] = issue.message;
    }
    return { ok: false, fieldErrors };
  }

  const d = parsed.data;
  const created = await prisma.buildRequest.create({
    data: {
      userId: session.user.id,
      source: d.source,
      peakKw: d.peakKw,
      wantPowerbank: d.wantPowerbank,
      powerbankKwh: d.powerbankKwh ?? null,
      wantEvCharger: d.wantEvCharger,
      evChargerPorts: d.evChargerPorts ?? null,
      evPublicForSale: d.evPublicForSale,
      country: d.country,
      city: d.city,
      addressLine: d.addressLine,
      lat: d.lat ?? null,
      lng: d.lng ?? null,
      siteType: d.siteType,
      availableAreaM2: d.availableAreaM2 ?? null,
      roofOrientation: d.roofOrientation ?? null,
      budget: d.budget,
      timeline: d.timeline,
      notes: d.notes ?? null,
    },
    select: { id: true, status: true, source: true, peakKw: true, country: true },
  });

  try {
    const { sendBuildRequestNewToAdmin } = await import("@/lib/resend-build-request");
    await sendBuildRequestNewToAdmin(created);
  } catch (err) {
    console.error("[build-request] admin notification failed:", err);
  }

  revalidatePath("/[locale]/me/build-requests", "page");
  return { ok: true, id: created.id };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/[locale]/me/build-requests/actions.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/app/[locale]/me/build-requests/actions.ts src/app/[locale]/me/build-requests/actions.test.ts
git commit -m "feat(build-request): add createBuildRequest server action"
```

---

## Task 4: Server action `updateBuildRequest` (TDD)

**Files:**
- Modify: `src/app/[locale]/me/build-requests/actions.ts`
- Modify: `src/app/[locale]/me/build-requests/actions.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/app/[locale]/me/build-requests/actions.test.ts`:

```ts
import { updateBuildRequest } from "./actions";

describe("updateBuildRequest", () => {
  it("updates an OPEN request owned by the user", async () => {
    const u = await ensureUser("test_br_carol");
    mockedAuth.mockResolvedValue({ user: { id: u.id, username: u.username, role: "USER" } } as never);

    const created = await createBuildRequest(formInput);
    const r = await updateBuildRequest(created.id!, { ...formInput, peakKw: 8 });

    expect(r.ok).toBe(true);
    const reloaded = await prisma.buildRequest.findUniqueOrThrow({ where: { id: created.id! } });
    expect(reloaded.peakKw.toNumber()).toBe(8);
  });

  it("refuses to update a non-OPEN request", async () => {
    const u = await ensureUser("test_br_dave");
    mockedAuth.mockResolvedValue({ user: { id: u.id, username: u.username, role: "USER" } } as never);

    const created = await createBuildRequest(formInput);
    await prisma.buildRequest.update({
      where: { id: created.id! },
      data: { status: "MATCHED" },
    });

    const r = await updateBuildRequest(created.id!, { ...formInput, peakKw: 8 });
    expect(r.ok).toBe(false);
    expect(r.formError).toMatch(/cannot edit/i);
  });

  it("refuses to update someone else's request", async () => {
    const owner = await ensureUser("test_br_eve");
    mockedAuth.mockResolvedValueOnce({ user: { id: owner.id, username: owner.username, role: "USER" } } as never);
    const created = await createBuildRequest(formInput);

    const intruder = await ensureUser("test_br_frank");
    mockedAuth.mockResolvedValueOnce({ user: { id: intruder.id, username: intruder.username, role: "USER" } } as never);

    const r = await updateBuildRequest(created.id!, { ...formInput, peakKw: 8 });
    expect(r.ok).toBe(false);
    expect(r.formError).toMatch(/not found|forbidden/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/[locale]/me/build-requests/actions.test.ts`
Expected: 3 FAIL — `updateBuildRequest is not a function`.

- [ ] **Step 3: Implement `updateBuildRequest`**

Append to `src/app/[locale]/me/build-requests/actions.ts`:

```ts
export async function updateBuildRequest(
  id: string,
  input: BuildRequestInput,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated" };

  const existing = await prisma.buildRequest.findUnique({
    where: { id },
    select: { id: true, userId: true, status: true },
  });
  if (!existing || existing.userId !== session.user.id) {
    return { ok: false, formError: "Request not found" };
  }
  if (existing.status !== "OPEN") {
    return { ok: false, formError: "Cannot edit a request that is no longer OPEN" };
  }

  const parsed = buildRequestSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0];
      if (typeof k === "string" && !fieldErrors[k]) fieldErrors[k] = issue.message;
    }
    return { ok: false, fieldErrors };
  }

  const d = parsed.data;
  await prisma.buildRequest.update({
    where: { id },
    data: {
      source: d.source,
      peakKw: d.peakKw,
      wantPowerbank: d.wantPowerbank,
      powerbankKwh: d.powerbankKwh ?? null,
      wantEvCharger: d.wantEvCharger,
      evChargerPorts: d.evChargerPorts ?? null,
      evPublicForSale: d.evPublicForSale,
      country: d.country,
      city: d.city,
      addressLine: d.addressLine,
      lat: d.lat ?? null,
      lng: d.lng ?? null,
      siteType: d.siteType,
      availableAreaM2: d.availableAreaM2 ?? null,
      roofOrientation: d.roofOrientation ?? null,
      budget: d.budget,
      timeline: d.timeline,
      notes: d.notes ?? null,
    },
  });

  revalidatePath("/[locale]/me/build-requests", "page");
  revalidatePath(`/[locale]/me/build-requests/${id}`, "page");
  return { ok: true, id };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/[locale]/me/build-requests/actions.test.ts`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add src/app/[locale]/me/build-requests/actions.ts src/app/[locale]/me/build-requests/actions.test.ts
git commit -m "feat(build-request): add updateBuildRequest server action"
```

---

## Task 5: Server action `cancelBuildRequest` (TDD)

**Files:**
- Modify: `src/app/[locale]/me/build-requests/actions.ts`
- Modify: `src/app/[locale]/me/build-requests/actions.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `actions.test.ts`:

```ts
import { cancelBuildRequest } from "./actions";

describe("cancelBuildRequest", () => {
  it("cancels an OPEN request", async () => {
    const u = await ensureUser("test_br_grace");
    mockedAuth.mockResolvedValue({ user: { id: u.id, username: u.username, role: "USER" } } as never);
    const created = await createBuildRequest(formInput);

    const r = await cancelBuildRequest(created.id!);
    expect(r.ok).toBe(true);
    const reloaded = await prisma.buildRequest.findUniqueOrThrow({ where: { id: created.id! } });
    expect(reloaded.status).toBe("CANCELLED");
    expect(reloaded.statusChangedById).toBe(u.id);
  });

  it("cancels a MATCHED request", async () => {
    const u = await ensureUser("test_br_henry");
    mockedAuth.mockResolvedValue({ user: { id: u.id, username: u.username, role: "USER" } } as never);
    const created = await createBuildRequest(formInput);
    await prisma.buildRequest.update({ where: { id: created.id! }, data: { status: "MATCHED" } });

    const r = await cancelBuildRequest(created.id!);
    expect(r.ok).toBe(true);
  });

  it("refuses to cancel a FULFILLED request", async () => {
    const u = await ensureUser("test_br_ivy");
    mockedAuth.mockResolvedValue({ user: { id: u.id, username: u.username, role: "USER" } } as never);
    const created = await createBuildRequest(formInput);
    await prisma.buildRequest.update({ where: { id: created.id! }, data: { status: "FULFILLED" } });

    const r = await cancelBuildRequest(created.id!);
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run src/app/[locale]/me/build-requests/actions.test.ts`
Expected: 3 FAIL — `cancelBuildRequest is not a function`.

- [ ] **Step 3: Implement `cancelBuildRequest`**

Append to `actions.ts`:

```ts
export async function cancelBuildRequest(id: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated" };

  const existing = await prisma.buildRequest.findUnique({
    where: { id },
    select: { id: true, userId: true, status: true },
  });
  if (!existing || existing.userId !== session.user.id) {
    return { ok: false, formError: "Request not found" };
  }
  if (existing.status === "FULFILLED") {
    return { ok: false, formError: "Cannot cancel a fulfilled request" };
  }
  if (existing.status === "CANCELLED") {
    return { ok: true, id };  // idempotent
  }

  await prisma.buildRequest.update({
    where: { id },
    data: {
      status: "CANCELLED",
      statusChangedAt: new Date(),
      statusChangedById: session.user.id,
    },
  });

  revalidatePath("/[locale]/me/build-requests", "page");
  revalidatePath(`/[locale]/me/build-requests/${id}`, "page");
  return { ok: true, id };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/[locale]/me/build-requests/actions.test.ts`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add src/app/[locale]/me/build-requests/actions.ts src/app/[locale]/me/build-requests/actions.test.ts
git commit -m "feat(build-request): add cancelBuildRequest server action"
```

---

## Task 6: Admin action `adminSetBuildRequestStatus` (TDD)

**Files:**
- Create: `src/app/[locale]/admin/build-requests/actions.ts`
- Create: `src/app/[locale]/admin/build-requests/actions.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/app/[locale]/admin/build-requests/actions.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { adminSetBuildRequestStatus } from "./actions";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/resend-build-request", () => ({
  sendBuildRequestStatusChangedToOwner: vi.fn(),
}));

import { auth } from "@/lib/auth";
const mockedAuth = vi.mocked(auth);

async function setupOwnerAndRequest() {
  const owner = await prisma.user.upsert({
    where: { username: "test_admin_owner" },
    update: {},
    create: { username: "test_admin_owner", passwordHash: "x" },
  });
  return prisma.buildRequest.create({
    data: {
      userId: owner.id,
      source: "SOLAR",
      peakKw: 5,
      country: "SK",
      city: "BA",
      addressLine: "Hlavná 1",
      siteType: "PRIVATE_HOUSE",
      roofOrientation: "S",
    },
  });
}

async function seedAdmin() {
  return prisma.user.upsert({
    where: { username: "test_admin_user" },
    update: { role: "ADMIN" },
    create: { username: "test_admin_user", passwordHash: "x", role: "ADMIN" },
  });
}

describe("adminSetBuildRequestStatus", () => {
  beforeEach(async () => {
    await prisma.buildRequest.deleteMany({ where: { user: { username: { startsWith: "test_admin_" } } } });
  });

  it("rejects non-admin sessions", async () => {
    const req = await setupOwnerAndRequest();
    mockedAuth.mockResolvedValueOnce({ user: { id: "x", username: "x", role: "USER" } } as never);

    const r = await adminSetBuildRequestStatus(req.id, "MATCHED", "contacted X");
    expect(r.ok).toBe(false);
    expect(r.formError).toMatch(/admin/i);
  });

  it("transitions OPEN → MATCHED with adminNote", async () => {
    const req = await setupOwnerAndRequest();
    const admin = await seedAdmin();
    mockedAuth.mockResolvedValueOnce({ user: { id: admin.id, username: admin.username, role: "ADMIN" } } as never);

    const r = await adminSetBuildRequestStatus(req.id, "MATCHED", "contacted SolarCo");
    expect(r.ok).toBe(true);
    const reloaded = await prisma.buildRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(reloaded.status).toBe("MATCHED");
    expect(reloaded.adminNote).toBe("contacted SolarCo");
    expect(reloaded.statusChangedById).toBe(admin.id);
  });

  it("requires adminNote for MATCHED transition", async () => {
    const req = await setupOwnerAndRequest();
    const admin = await seedAdmin();
    mockedAuth.mockResolvedValueOnce({ user: { id: admin.id, username: admin.username, role: "ADMIN" } } as never);

    const r = await adminSetBuildRequestStatus(req.id, "MATCHED");
    expect(r.ok).toBe(false);
    expect(r.fieldErrors?.adminNote).toBeDefined();
  });

  it("rejects FULFILLED → OPEN", async () => {
    const req = await setupOwnerAndRequest();
    await prisma.buildRequest.update({ where: { id: req.id }, data: { status: "FULFILLED" } });
    const admin = await seedAdmin();
    mockedAuth.mockResolvedValueOnce({ user: { id: admin.id, username: admin.username, role: "ADMIN" } } as never);

    const r = await adminSetBuildRequestStatus(req.id, "OPEN");
    expect(r.ok).toBe(false);
    expect(r.formError).toMatch(/transition/i);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run src/app/[locale]/admin/build-requests/actions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the action**

Create `src/app/[locale]/admin/build-requests/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import type { BuildRequestStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type AdminActionResult = {
  ok: boolean;
  fieldErrors?: Record<string, string>;
  formError?: string;
};

const VALID_TRANSITIONS: Record<BuildRequestStatus, BuildRequestStatus[]> = {
  OPEN: ["MATCHED", "CANCELLED"],
  MATCHED: ["FULFILLED", "CANCELLED"],
  FULFILLED: [],
  CANCELLED: [],
};

export async function adminSetBuildRequestStatus(
  id: string,
  status: BuildRequestStatus,
  adminNote?: string,
): Promise<AdminActionResult> {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return { ok: false, formError: "Admin only" };
  }

  const existing = await prisma.buildRequest.findUnique({
    where: { id },
    select: { id: true, status: true, userId: true },
  });
  if (!existing) return { ok: false, formError: "Request not found" };

  const allowed = VALID_TRANSITIONS[existing.status];
  if (!allowed.includes(status)) {
    return { ok: false, formError: `Invalid transition ${existing.status} → ${status}` };
  }

  const noteRequired = status === "MATCHED" || status === "CANCELLED";
  const noteValue = adminNote?.trim();
  if (noteRequired && !noteValue) {
    return { ok: false, fieldErrors: { adminNote: "Required for this transition" } };
  }

  const updated = await prisma.buildRequest.update({
    where: { id },
    data: {
      status,
      adminNote: noteValue ?? null,
      statusChangedAt: new Date(),
      statusChangedById: session.user.id,
    },
    select: { id: true, status: true, userId: true },
  });

  try {
    const { sendBuildRequestStatusChangedToOwner } = await import("@/lib/resend-build-request");
    await sendBuildRequestStatusChangedToOwner(updated.id, updated.status, updated.userId);
  } catch (err) {
    console.error("[build-request] owner notification failed:", err);
  }

  revalidatePath("/[locale]/admin/build-requests", "page");
  revalidatePath(`/[locale]/admin/build-requests/${id}`, "page");
  revalidatePath(`/[locale]/me/build-requests/${id}`, "page");
  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/[locale]/admin/build-requests/actions.test.ts`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add src/app/[locale]/admin/build-requests/actions.ts src/app/[locale]/admin/build-requests/actions.test.ts
git commit -m "feat(build-request): add adminSetBuildRequestStatus action with state machine"
```

---

## Task 7: Email helpers (Resend integration)

**Files:**
- Create: `src/lib/resend-build-request.ts`

No TDD here — these are thin side-effect functions over the existing Resend client. The actions above already test that they're called (via the mock).

- [ ] **Step 1: Implement helpers**

Create `src/lib/resend-build-request.ts`:

```ts
import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import type { BuildRequestStatus } from "@prisma/client";

const FROM = "Poolwatt <noreply@poolwatt.com>";
const BASE = process.env.NEXTAUTH_URL ?? "https://poolwatt.com";

let cachedClient: Resend | null = null;
function client(): Resend | null {
  if (cachedClient) return cachedClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  cachedClient = new Resend(key);
  return cachedClient;
}

export type AdminNotification = {
  id: string;
  source: string;
  peakKw: { toNumber(): number } | number;
  country: string;
};

export async function sendBuildRequestNewToAdmin(req: AdminNotification): Promise<void> {
  const to = process.env.ADMIN_EMAIL;
  if (!to) {
    console.warn("[resend-build-request] ADMIN_EMAIL not set, skipping new-request notification");
    return;
  }

  const c = client();
  const kw = typeof req.peakKw === "number" ? req.peakKw : req.peakKw.toNumber();
  const url = `${BASE}/admin/build-requests/${req.id}`;
  const shortId = req.id.slice(0, 8);

  if (!c) {
    console.log(`[resend stub] new build request ${shortId} → ${to}: ${url}`);
    return;
  }
  await c.emails.send({
    from: FROM,
    to,
    subject: `[Poolwatt] New build request #${shortId} — ${req.source} ${kw}kW, ${req.country}`,
    html: `
      <p>A new build request was filed.</p>
      <p>Source: <b>${req.source}</b>, peak: <b>${kw} kW</b>, country: <b>${req.country}</b></p>
      <p><a href="${url}">Open in admin</a></p>
    `,
  });
}

export async function sendBuildRequestStatusChangedToOwner(
  requestId: string,
  newStatus: BuildRequestStatus,
  ownerId: string,
): Promise<void> {
  const owner = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { email: true, emailVerified: true, username: true },
  });
  if (!owner?.email || !owner.emailVerified) {
    return;  // silent skip — owner has no verified email
  }

  const c = client();
  const url = `${BASE}/me/build-requests/${requestId}`;
  const shortId = requestId.slice(0, 8);

  if (!c) {
    console.log(`[resend stub] status change ${shortId} → ${newStatus} for ${owner.email}: ${url}`);
    return;
  }
  await c.emails.send({
    from: FROM,
    to: owner.email,
    subject: `[Poolwatt] Your build request #${shortId} is now ${newStatus}`,
    html: `
      <p>Hi ${owner.username},</p>
      <p>Your build request <b>#${shortId}</b> changed status to <b>${newStatus}</b>.</p>
      <p><a href="${url}">View your request</a></p>
    `,
  });
}
```

- [ ] **Step 2: Verify the type-check passes**

Run: `npx tsc --noEmit`
Expected: no errors. (If you see errors in other files, they're not yours — but the file you just added must be clean.)

- [ ] **Step 3: Verify the full test suite still passes**

Run: `npm run test`
Expected: all passed (the actions tests stay green because they mock this module).

- [ ] **Step 4: Commit**

```bash
git add src/lib/resend-build-request.ts
git commit -m "feat(build-request): add Resend email helpers for admin + owner notifications"
```

---

## Task 8: i18n strings (EN/RU/SK)

**Files:**
- Modify: `messages/en.json`, `messages/ru.json`, `messages/sk.json`

- [ ] **Step 1: Add `cabinet.buildRequest` and `admin.buildRequest` namespaces to EN**

Open `messages/en.json` and add **inside the existing root object** (alongside `cabinet`, `admin` keys if they exist; otherwise create them):

```json
"cabinet": {
  "sidebar": {
    "buildRequests": "Build requests"
  },
  "buildRequest": {
    "title": "Build requests",
    "empty": "You haven't filed any build requests yet.",
    "newButton": "+ New request",
    "new": {
      "title": "New build request",
      "section": {
        "what": "What to build",
        "where": "Where to build",
        "money": "Budget & timeline",
        "contact": "Contact"
      }
    },
    "field": {
      "source": { "label": "Source", "SOLAR": "Solar", "WIND": "Wind", "HYBRID": "Solar + Wind" },
      "peakKw": { "label": "Peak power (kW)" },
      "wantPowerbank": { "label": "Include a powerbank" },
      "powerbankKwh": { "label": "Powerbank capacity (kWh)" },
      "wantEvCharger": { "label": "Include an EV charger" },
      "evChargerPorts": { "label": "Number of charging ports" },
      "evPublicForSale": { "label": "Offer EV charging to passing drivers" },
      "country": { "label": "Country" },
      "city": { "label": "City" },
      "addressLine": { "label": "Address" },
      "siteType": {
        "label": "Site type",
        "PRIVATE_HOUSE": "Private house",
        "APARTMENT_ROOF": "Apartment building rooftop",
        "LAND_PLOT": "Land plot",
        "COMMERCIAL": "Commercial"
      },
      "availableAreaM2": { "label": "Available area (m²)" },
      "roofOrientation": {
        "label": "Roof orientation",
        "S": "South", "SE": "South-east", "SW": "South-west",
        "E": "East", "W": "West", "UNKNOWN": "I don't know"
      },
      "budget": {
        "label": "Budget",
        "UNDER_5K": "Up to €5k", "FROM_5K_TO_15K": "€5–15k",
        "FROM_15K_TO_30K": "€15–30k", "FROM_30K_TO_60K": "€30–60k",
        "OVER_60K": "€60k+", "AWAITING_QUOTE": "Awaiting quote"
      },
      "timeline": {
        "label": "Timeline",
        "URGENT_1_3M": "Urgent (1–3 months)",
        "WITHIN_YEAR": "Within a year",
        "EXPLORING": "Just exploring"
      },
      "notes": { "label": "Notes (optional)" }
    },
    "status": {
      "OPEN": "Open", "MATCHED": "Matched", "FULFILLED": "Fulfilled", "CANCELLED": "Cancelled"
    },
    "action": {
      "submit": "Submit", "save": "Save", "cancel": "Cancel request",
      "edit": "Edit", "back": "Back to list", "newRequest": "New request"
    },
    "error": {
      "phoneRequired": "Add your phone number in settings before filing a request.",
      "notEditable": "This request is being processed and can no longer be edited."
    }
  }
}
```

And add an `admin` block (merge with existing if present):

```json
"admin": {
  "buildRequest": {
    "title": "Build requests",
    "filter": { "status": "Status", "country": "Country", "all": "All" },
    "table": {
      "id": "ID", "createdAt": "Created", "owner": "Owner",
      "source": "Source", "country": "Country", "status": "Status"
    },
    "action": {
      "setStatus": "Change status",
      "adminNote": "Internal note",
      "submit": "Apply"
    }
  }
}
```

- [ ] **Step 2: Translate to RU**

Mirror the structure in `messages/ru.json` with Russian translations:
- `sidebar.buildRequests` → `"Заявки на строительство"`
- `buildRequest.title` → `"Заявки на строительство"`
- `new.title` → `"Новая заявка"`
- `section.what/where/money/contact` → `"Что строить" / "Где строить" / "Бюджет и сроки" / "Контакт"`
- `field.source.SOLAR/WIND/HYBRID` → `"Солнечная" / "Ветровая" / "Солнце + ветер"`
- `field.siteType.*` → `"Частный дом" / "Крыша многоквартирного дома" / "Земельный участок" / "Коммерческое"`
- `field.roofOrientation.*` → `"Юг" / "Юго-восток" / "Юго-запад" / "Восток" / "Запад" / "Не знаю"`
- `field.budget.*` → `"до €5k" / "€5–15k" / "€15–30k" / "€30–60k" / "€60k+" / "Жду оценки"`
- `field.timeline.*` → `"Срочно (1–3 мес)" / "В течение года" / "Просто изучаю"`
- `status.*` → `"Открыта" / "В работе" / "Выполнена" / "Отменена"`
- `action.submit/save/cancel/edit/back/newRequest` → `"Отправить" / "Сохранить" / "Отменить заявку" / "Редактировать" / "К списку" / "Новая заявка"`
- `error.phoneRequired` → `"Сначала добавьте телефон в настройках."`
- `error.notEditable` → `"Заявка в работе и больше не редактируется."`

(All other keys → translate keeping the same structure.)

- [ ] **Step 3: Translate to SK**

Mirror in `messages/sk.json` with Slovak:
- `sidebar.buildRequests` → `"Žiadosti o výstavbu"`
- `new.title` → `"Nová žiadosť"`
- `section.what/where/money/contact` → `"Čo postaviť" / "Kde postaviť" / "Rozpočet a termín" / "Kontakt"`
- `field.source.*` → `"Solárna" / "Veterná" / "Solárna + veterná"`
- `field.siteType.*` → `"Rodinný dom" / "Strecha bytového domu" / "Pozemok" / "Komerčné"`
- `field.roofOrientation.*` → `"Juh" / "Juhovýchod" / "Juhozápad" / "Východ" / "Západ" / "Neviem"`
- `status.*` → `"Otvorená" / "Prevzatá" / "Dokončená" / "Zrušená"`
- `action.submit/save/cancel/edit/back` → `"Odoslať" / "Uložiť" / "Zrušiť žiadosť" / "Upraviť" / "Späť na zoznam"`

(Rest translate similarly.)

- [ ] **Step 4: Verify the JSON files parse**

Run: `node -e "['en','ru','sk'].forEach(l => JSON.parse(require('fs').readFileSync('messages/'+l+'.json','utf-8')))"`
Expected: no output (success).

- [ ] **Step 5: Commit**

```bash
git add messages/en.json messages/ru.json messages/sk.json
git commit -m "feat(build-request): add EN/RU/SK i18n strings"
```

---

## Task 9: Extend `/me/settings` with a phone field

**Files:**
- Modify: `src/lib/validation.ts` (add `phoneSchema`, `updatePhoneSchema`)
- Modify: `src/app/[locale]/me/settings/actions.ts` (add `updatePhoneAction`)
- Modify: `src/app/[locale]/me/settings/page.tsx` (read + render phone, fetch label keys)
- Create: `src/components/settings/phone-section.tsx`

- [ ] **Step 1: Add zod schema**

In `src/lib/validation.ts`, append:

```ts
export const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, "Phone must be E.164 (+followed by digits, 7–15 total)");

export const updatePhoneSchema = z.object({
  phone: z.union([phoneSchema, z.literal("")]),  // empty string = clear
});
```

- [ ] **Step 2: Add the server action**

In `src/app/[locale]/me/settings/actions.ts`, append:

```ts
import { updatePhoneSchema } from "@/lib/validation";

export async function updatePhoneAction(
  _prev: FieldError,
  formData: FormData,
): Promise<FieldError> {
  const session = await auth();
  if (!session?.user) return { formError: "Not authenticated" };

  const raw = { phone: String(formData.get("phone") ?? "").trim() };
  const parsed = updatePhoneSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: { phone: parsed.error.issues[0].message } };
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { phone: parsed.data.phone === "" ? null : parsed.data.phone },
  });
  revalidatePath("/[locale]/me/settings", "page");
  return { ok: true };
}
```

- [ ] **Step 3: Add the client section component**

Create `src/components/settings/phone-section.tsx` (mirror `email-section.tsx` style — check it first if unsure):

```tsx
"use client";

import { useActionState } from "react";
import { updatePhoneAction } from "@/app/[locale]/me/settings/actions";

type Props = {
  currentPhone: string | null;
  labels: { title: string; placeholder: string; submit: string; success: string };
};

export function PhoneSection({ currentPhone, labels }: Props) {
  const [state, action, pending] = useActionState(updatePhoneAction, {});

  return (
    <section className="border border-hairline rounded-lg p-6">
      <h2 className="text-[18px] font-semibold mb-4">{labels.title}</h2>
      <form action={action} className="flex gap-2 items-start">
        <input
          name="phone"
          type="tel"
          defaultValue={currentPhone ?? ""}
          placeholder={labels.placeholder}
          className="flex-1 border border-hairline rounded px-3 py-2"
        />
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 bg-foreground text-bg rounded disabled:opacity-50"
        >
          {labels.submit}
        </button>
      </form>
      {state.fieldErrors?.phone && (
        <p className="text-red-600 text-sm mt-2">{state.fieldErrors.phone}</p>
      )}
      {state.ok && <p className="text-green-600 text-sm mt-2">{labels.success}</p>}
    </section>
  );
}
```

- [ ] **Step 4: Render it on the settings page**

In `src/app/[locale]/me/settings/page.tsx`:

1. Add `phone: true` to the `prisma.user.findUnique({ select: { ... } })` block.
2. Add import: `import { PhoneSection } from "@/components/settings/phone-section";`
3. Render `<PhoneSection currentPhone={user.phone} labels={{ ... }} />` after `<EmailSection ... />`.
4. Add the corresponding `t("phone.*")` keys to `messages/en.json` `settings.phone.title/placeholder/submit/success` (mirror style of `settings.email.*`); same for `ru.json` and `sk.json`.

EN values: `"Phone" / "+421 900 000 000" / "Save" / "Phone updated"`
RU: `"Телефон" / "+421 900 000 000" / "Сохранить" / "Телефон обновлён"`
SK: `"Telefón" / "+421 900 000 000" / "Uložiť" / "Telefón aktualizovaný"`

- [ ] **Step 5: Verify it builds and renders**

Run: `npm run lint && npm run test`
Expected: all green.

Run: `npm run dev` and visit `http://localhost:3000/en/me/settings` after logging in. Verify the new Phone section appears and saves.

- [ ] **Step 6: Commit**

```bash
git add src/lib/validation.ts \
  src/app/[locale]/me/settings/actions.ts \
  src/app/[locale]/me/settings/page.tsx \
  src/components/settings/phone-section.tsx \
  messages/en.json messages/ru.json messages/sk.json
git commit -m "feat(settings): add phone field with E.164 validation"
```

---

## Task 10: Add sidebar link to `/me/layout.tsx`

**Files:**
- Modify: `src/app/[locale]/me/layout.tsx`

- [ ] **Step 1: Add the link**

In `src/app/[locale]/me/layout.tsx`, in the `<nav>` block, insert between Favorites and Settings:

```tsx
<SidebarLink href={`/${locale}/me/build-requests`}>
  🔧 {t("buildRequests")}
</SidebarLink>
```

- [ ] **Step 2: Verify by visiting `/me/favorites`**

Run: `npm run dev` (if not already running). Log in, visit `/en/me/favorites`. Sidebar should show the new "🔧 Build requests" entry between Favorites and Settings.

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/me/layout.tsx
git commit -m "feat(build-request): add sidebar link in /me cabinet"
```

---

## Task 11: `/me/build-requests` list page

**Files:**
- Create: `src/app/[locale]/me/build-requests/page.tsx`

- [ ] **Step 1: Implement the page**

Create `src/app/[locale]/me/build-requests/page.tsx`:

```tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function BuildRequestsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/build-requests`);

  const requests = await prisma.buildRequest.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, source: true, peakKw: true, country: true, city: true,
      status: true, createdAt: true,
    },
  });

  const t = await getTranslations("cabinet.buildRequest");

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-[28px] md:text-[32px] font-bold tracking-[-0.02em]">{t("title")}</h1>
        <Link
          href={`/${locale}/me/build-requests/new`}
          className="px-4 py-2 bg-foreground text-bg rounded text-sm"
        >
          {t("action.newRequest")}
        </Link>
      </div>

      {requests.length === 0 ? (
        <p className="text-muted">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {requests.map((r) => (
            <li key={r.id} className="py-4">
              <Link
                href={`/${locale}/me/build-requests/${r.id}`}
                className="flex justify-between items-center hover:opacity-80"
              >
                <div>
                  <div className="font-medium">
                    {t(`field.source.${r.source}`)} · <span className="num">{r.peakKw.toString()}</span> kW
                  </div>
                  <div className="text-sm text-muted">
                    {r.city}, {r.country} · {r.createdAt.toISOString().slice(0, 10)}
                  </div>
                </div>
                <span className={`text-xs px-2 py-1 rounded ${statusClass(r.status)}`}>
                  {t(`status.${r.status}`)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function statusClass(s: string) {
  switch (s) {
    case "OPEN": return "bg-blue-100 text-blue-700";
    case "MATCHED": return "bg-yellow-100 text-yellow-700";
    case "FULFILLED": return "bg-green-100 text-green-700";
    case "CANCELLED": return "bg-gray-100 text-gray-700";
    default: return "bg-gray-100 text-gray-700";
  }
}
```

- [ ] **Step 2: Verify it renders**

Visit `http://localhost:3000/en/me/build-requests` while logged in. Should show "You haven't filed any build requests yet." and the "+ New request" button. Clicking the button 404s for now (we build the page in Task 12).

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/me/build-requests/page.tsx
git commit -m "feat(build-request): add /me/build-requests list page"
```

---

## Task 12: Shared form component + label helper + `/me/build-requests/new` page

**Files:**
- Create: `src/lib/build-request-form-labels.ts` (label helper, reused by new + edit pages)
- Create: `src/components/cabinet/build-request-form.tsx`
- Create: `src/app/[locale]/me/build-requests/new/page.tsx`

- [ ] **Step 0: Create the label helper**

Create `src/lib/build-request-form-labels.ts`:

```ts
import { getTranslations } from "next-intl/server";

export type BuildRequestFormLabels = {
  section: { what: string; where: string; money: string; contact: string };
  field: Record<string, Record<string, string>>;
  action: { submit: string; save: string };
  error: { phoneRequired: string };
};

export async function getBuildRequestFormLabels(): Promise<BuildRequestFormLabels> {
  const t = await getTranslations("cabinet.buildRequest");
  return {
    section: {
      what: t("new.section.what"),
      where: t("new.section.where"),
      money: t("new.section.money"),
      contact: t("new.section.contact"),
    },
    field: {
      source: { label: t("field.source.label"), SOLAR: t("field.source.SOLAR"), WIND: t("field.source.WIND"), HYBRID: t("field.source.HYBRID") },
      peakKw: { label: t("field.peakKw.label") },
      wantPowerbank: { label: t("field.wantPowerbank.label") },
      powerbankKwh: { label: t("field.powerbankKwh.label") },
      wantEvCharger: { label: t("field.wantEvCharger.label") },
      evChargerPorts: { label: t("field.evChargerPorts.label") },
      evPublicForSale: { label: t("field.evPublicForSale.label") },
      country: { label: t("field.country.label") },
      city: { label: t("field.city.label") },
      addressLine: { label: t("field.addressLine.label") },
      siteType: { label: t("field.siteType.label"), PRIVATE_HOUSE: t("field.siteType.PRIVATE_HOUSE"), APARTMENT_ROOF: t("field.siteType.APARTMENT_ROOF"), LAND_PLOT: t("field.siteType.LAND_PLOT"), COMMERCIAL: t("field.siteType.COMMERCIAL") },
      availableAreaM2: { label: t("field.availableAreaM2.label") },
      roofOrientation: { label: t("field.roofOrientation.label"), S: t("field.roofOrientation.S"), SE: t("field.roofOrientation.SE"), SW: t("field.roofOrientation.SW"), E: t("field.roofOrientation.E"), W: t("field.roofOrientation.W"), UNKNOWN: t("field.roofOrientation.UNKNOWN") },
      budget: { label: t("field.budget.label"), UNDER_5K: t("field.budget.UNDER_5K"), FROM_5K_TO_15K: t("field.budget.FROM_5K_TO_15K"), FROM_15K_TO_30K: t("field.budget.FROM_15K_TO_30K"), FROM_30K_TO_60K: t("field.budget.FROM_30K_TO_60K"), OVER_60K: t("field.budget.OVER_60K"), AWAITING_QUOTE: t("field.budget.AWAITING_QUOTE") },
      timeline: { label: t("field.timeline.label"), URGENT_1_3M: t("field.timeline.URGENT_1_3M"), WITHIN_YEAR: t("field.timeline.WITHIN_YEAR"), EXPLORING: t("field.timeline.EXPLORING") },
      notes: { label: t("field.notes.label") },
    },
    action: { submit: t("action.submit"), save: t("action.save") },
    error: { phoneRequired: t("error.phoneRequired") },
  };
}
```

- [ ] **Step 1: Implement the form component**

Create `src/components/cabinet/build-request-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BuildRequestInput } from "@/lib/build-request-schema";
import type { BuildRequestFormLabels } from "@/lib/build-request-form-labels";
import { createBuildRequest, updateBuildRequest } from "@/app/[locale]/me/build-requests/actions";

type Mode = { kind: "create" } | { kind: "edit"; id: string };

type Props = {
  mode: Mode;
  locale: string;
  initial?: Partial<BuildRequestInput>;
  hasPhone: boolean;
  hasName: boolean;
  labels: BuildRequestFormLabels;
};

export function BuildRequestForm({ mode, locale, initial, hasPhone, hasName, labels }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const [source, setSource] = useState<"SOLAR" | "WIND" | "HYBRID">(initial?.source ?? "SOLAR");
  const [wantPowerbank, setWantPowerbank] = useState(initial?.wantPowerbank ?? false);
  const [wantEvCharger, setWantEvCharger] = useState(initial?.wantEvCharger ?? false);

  const canSubmit = hasPhone && hasName;

  async function onSubmit(formData: FormData) {
    setErrors({});
    setFormError(null);

    const input: BuildRequestInput = {
      source,
      peakKw: Number(formData.get("peakKw")),
      wantPowerbank,
      powerbankKwh: wantPowerbank ? Number(formData.get("powerbankKwh")) : undefined,
      wantEvCharger,
      evChargerPorts: wantEvCharger ? Number(formData.get("evChargerPorts")) : undefined,
      evPublicForSale: wantEvCharger && formData.get("evPublicForSale") === "on",
      country: String(formData.get("country") ?? "").toUpperCase(),
      city: String(formData.get("city") ?? ""),
      addressLine: String(formData.get("addressLine") ?? ""),
      siteType: formData.get("siteType") as BuildRequestInput["siteType"],
      availableAreaM2: formData.get("availableAreaM2")
        ? Number(formData.get("availableAreaM2"))
        : undefined,
      roofOrientation: source === "WIND"
        ? undefined
        : (formData.get("roofOrientation") as BuildRequestInput["roofOrientation"]),
      budget: formData.get("budget") as BuildRequestInput["budget"],
      timeline: formData.get("timeline") as BuildRequestInput["timeline"],
      notes: String(formData.get("notes") ?? "") || undefined,
    };

    startTransition(async () => {
      const result = mode.kind === "create"
        ? await createBuildRequest(input)
        : await updateBuildRequest(mode.id, input);

      if (!result.ok) {
        if (result.fieldErrors) setErrors(result.fieldErrors);
        if (result.formError) setFormError(result.formError);
        return;
      }
      const targetId = result.id ?? (mode.kind === "edit" ? mode.id : "");
      router.push(`/${locale}/me/build-requests/${targetId}`);
    });
  }

  return (
    <form action={onSubmit} className="space-y-8 max-w-2xl">
      {!canSubmit && (
        <p className="bg-yellow-50 text-yellow-900 p-3 rounded text-sm">
          {labels.error.phoneRequired}
        </p>
      )}

      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold">{labels.section.what}</legend>

        <div>
          <label className="block text-sm mb-1">{labels.field.source.label}</label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as typeof source)}
            className="border border-hairline rounded px-3 py-2"
          >
            <option value="SOLAR">{labels.field.source.SOLAR}</option>
            <option value="WIND">{labels.field.source.WIND}</option>
            <option value="HYBRID">{labels.field.source.HYBRID}</option>
          </select>
        </div>

        <div>
          <label className="block text-sm mb-1">{labels.field.peakKw.label}</label>
          <input
            name="peakKw" type="number" step="0.1" min="0.5" max="500"
            defaultValue={initial?.peakKw ?? 5}
            className="border border-hairline rounded px-3 py-2 w-40"
          />
          {errors.peakKw && <p className="text-red-600 text-xs mt-1">{errors.peakKw}</p>}
        </div>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={wantPowerbank}
            onChange={(e) => setWantPowerbank(e.target.checked)}
          />
          {labels.field.wantPowerbank.label}
        </label>
        {wantPowerbank && (
          <input
            name="powerbankKwh" type="number" min="1" max="500" step="0.5"
            defaultValue={initial?.powerbankKwh ?? 10}
            placeholder={labels.field.powerbankKwh.label}
            className="border border-hairline rounded px-3 py-2 w-40"
          />
        )}

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={wantEvCharger}
            onChange={(e) => setWantEvCharger(e.target.checked)}
          />
          {labels.field.wantEvCharger.label}
        </label>
        {wantEvCharger && (
          <>
            <input
              name="evChargerPorts" type="number" min="1" max="10" step="1"
              defaultValue={initial?.evChargerPorts ?? 1}
              placeholder={labels.field.evChargerPorts.label}
              className="border border-hairline rounded px-3 py-2 w-40"
            />
            <label className="flex items-center gap-2">
              <input
                type="checkbox" name="evPublicForSale"
                defaultChecked={initial?.evPublicForSale ?? false}
              />
              {labels.field.evPublicForSale.label}
            </label>
          </>
        )}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold">{labels.section.where}</legend>
        <input name="country" defaultValue={initial?.country ?? ""} placeholder="SK" maxLength={2} className="border border-hairline rounded px-3 py-2 w-20 uppercase" />
        <input name="city" defaultValue={initial?.city ?? ""} placeholder={labels.field.city.label} className="border border-hairline rounded px-3 py-2 w-full" />
        <input name="addressLine" defaultValue={initial?.addressLine ?? ""} placeholder={labels.field.addressLine.label} className="border border-hairline rounded px-3 py-2 w-full" />
        <select name="siteType" defaultValue={initial?.siteType ?? "PRIVATE_HOUSE"} className="border border-hairline rounded px-3 py-2">
          {(["PRIVATE_HOUSE", "APARTMENT_ROOF", "LAND_PLOT", "COMMERCIAL"] as const).map((v) => (
            <option key={v} value={v}>{labels.field.siteType[v]}</option>
          ))}
        </select>
        <input name="availableAreaM2" type="number" min="0" defaultValue={initial?.availableAreaM2 ?? ""} placeholder={labels.field.availableAreaM2.label} className="border border-hairline rounded px-3 py-2 w-40" />
        {source !== "WIND" && (
          <select name="roofOrientation" defaultValue={initial?.roofOrientation ?? "S"} className="border border-hairline rounded px-3 py-2">
            {(["S", "SE", "SW", "E", "W", "UNKNOWN"] as const).map((v) => (
              <option key={v} value={v}>{labels.field.roofOrientation[v]}</option>
            ))}
          </select>
        )}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold">{labels.section.money}</legend>
        <select name="budget" defaultValue={initial?.budget ?? "AWAITING_QUOTE"} className="border border-hairline rounded px-3 py-2">
          {(["UNDER_5K","FROM_5K_TO_15K","FROM_15K_TO_30K","FROM_30K_TO_60K","OVER_60K","AWAITING_QUOTE"] as const).map((v) => (
            <option key={v} value={v}>{labels.field.budget[v]}</option>
          ))}
        </select>
        <select name="timeline" defaultValue={initial?.timeline ?? "EXPLORING"} className="border border-hairline rounded px-3 py-2">
          {(["URGENT_1_3M","WITHIN_YEAR","EXPLORING"] as const).map((v) => (
            <option key={v} value={v}>{labels.field.timeline[v]}</option>
          ))}
        </select>
        <textarea name="notes" defaultValue={initial?.notes ?? ""} maxLength={1000} rows={4} placeholder={labels.field.notes.label} className="border border-hairline rounded px-3 py-2 w-full" />
      </fieldset>

      {formError && <p className="text-red-600 text-sm">{formError}</p>}

      <div className="sticky bottom-0 bg-bg pt-4 border-t border-hairline">
        <button
          type="submit"
          disabled={pending || !canSubmit}
          className="px-6 py-2 bg-foreground text-bg rounded disabled:opacity-50"
        >
          {mode.kind === "create" ? labels.action.submit : labels.action.save}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Implement the page**

Create `src/app/[locale]/me/build-requests/new/page.tsx`:

```tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BuildRequestForm } from "@/components/cabinet/build-request-form";
import { getBuildRequestFormLabels } from "@/lib/build-request-form-labels";

export default async function NewBuildRequestPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/build-requests/new`);

  const [user, t, labels] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { name: true, phone: true },
    }),
    getTranslations("cabinet.buildRequest"),
    getBuildRequestFormLabels(),
  ]);

  return (
    <div>
      <Link href={`/${locale}/me/build-requests`} className="text-sm text-muted">← {t("action.back")}</Link>
      <h1 className="text-[28px] font-bold mt-2 mb-6">{t("new.title")}</h1>
      <BuildRequestForm
        mode={{ kind: "create" }}
        locale={locale}
        hasPhone={user.phone != null}
        hasName={user.name != null}
        labels={labels}
      />
    </div>
  );
}
```

- [ ] **Step 3: Test by submitting**

Visit `http://localhost:3000/en/me/build-requests/new` while logged in. Fill the form and submit. Should redirect to the new request's detail page (404 for now — Task 13 builds it).

Check the DB: `npm run db:studio` → BuildRequest table should have the new row.

- [ ] **Step 4: Commit**

```bash
git add src/components/cabinet/build-request-form.tsx \
  src/app/[locale]/me/build-requests/new/page.tsx
git commit -m "feat(build-request): add /me/build-requests/new form page"
```

---

## Task 13: `/me/build-requests/[id]` detail page

**Files:**
- Create: `src/app/[locale]/me/build-requests/[id]/page.tsx`
- Create: `src/components/cabinet/cancel-build-request-button.tsx`

- [ ] **Step 1: Implement the cancel button (client component)**

Create `src/components/cabinet/cancel-build-request-button.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelBuildRequest } from "@/app/[locale]/me/build-requests/actions";

type Props = { id: string; label: string; locale: string };

export function CancelBuildRequestButton({ id, label, locale }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const r = await cancelBuildRequest(id);
          if (r.ok) router.refresh();
          else alert(r.formError ?? "Failed");
        });
      }}
      className="px-4 py-2 border border-hairline rounded text-sm disabled:opacity-50"
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 2: Implement the detail page**

Create `src/app/[locale]/me/build-requests/[id]/page.tsx`:

```tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CancelBuildRequestButton } from "@/components/cabinet/cancel-build-request-button";

export default async function BuildRequestDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/build-requests/${id}`);

  const r = await prisma.buildRequest.findUnique({ where: { id } });
  if (!r || r.userId !== session.user.id) notFound();

  const t = await getTranslations("cabinet.buildRequest");

  return (
    <div className="max-w-2xl">
      <Link href={`/${locale}/me/build-requests`} className="text-sm text-muted">← {t("action.back")}</Link>
      <h1 className="text-[28px] font-bold mt-2 mb-6">
        {t(`field.source.${r.source}`)} · <span className="num">{r.peakKw.toString()}</span> kW
      </h1>

      <div className="flex items-center gap-4 mb-8">
        <span className={`text-xs px-2 py-1 rounded ${statusClass(r.status)}`}>
          {t(`status.${r.status}`)}
        </span>
        {r.status === "OPEN" && (
          <Link
            href={`/${locale}/me/build-requests/${id}/edit`}
            className="text-sm underline"
          >
            {t("action.edit")}
          </Link>
        )}
        {r.status !== "FULFILLED" && r.status !== "CANCELLED" && (
          <CancelBuildRequestButton id={id} label={t("action.cancel")} locale={locale} />
        )}
      </div>

      <dl className="grid grid-cols-[200px_1fr] gap-y-2 text-sm">
        <dt className="text-muted">{t("field.country.label")}</dt><dd>{r.country}, {r.city}</dd>
        <dt className="text-muted">{t("field.addressLine.label")}</dt><dd>{r.addressLine}</dd>
        <dt className="text-muted">{t("field.siteType.label")}</dt><dd>{t(`field.siteType.${r.siteType}`)}</dd>
        {r.roofOrientation && <><dt className="text-muted">{t("field.roofOrientation.label")}</dt><dd>{t(`field.roofOrientation.${r.roofOrientation}`)}</dd></>}
        {r.availableAreaM2 != null && <><dt className="text-muted">{t("field.availableAreaM2.label")}</dt><dd>{r.availableAreaM2} m²</dd></>}
        <dt className="text-muted">{t("field.budget.label")}</dt><dd>{t(`field.budget.${r.budget}`)}</dd>
        <dt className="text-muted">{t("field.timeline.label")}</dt><dd>{t(`field.timeline.${r.timeline}`)}</dd>
        {r.wantPowerbank && <><dt className="text-muted">{t("field.powerbankKwh.label")}</dt><dd>{r.powerbankKwh?.toString()} kWh</dd></>}
        {r.wantEvCharger && <><dt className="text-muted">{t("field.evChargerPorts.label")}</dt><dd>{r.evChargerPorts}</dd></>}
        {r.notes && <><dt className="text-muted">{t("field.notes.label")}</dt><dd className="whitespace-pre-wrap">{r.notes}</dd></>}
      </dl>
    </div>
  );
}

function statusClass(s: string) {
  switch (s) {
    case "OPEN": return "bg-blue-100 text-blue-700";
    case "MATCHED": return "bg-yellow-100 text-yellow-700";
    case "FULFILLED": return "bg-green-100 text-green-700";
    case "CANCELLED": return "bg-gray-100 text-gray-700";
    default: return "bg-gray-100 text-gray-700";
  }
}
```

- [ ] **Step 3: Verify**

Visit a request you created. You should see all fields, the status pill, and "Edit" + "Cancel" buttons (for an OPEN request). Click Cancel — page refreshes, status changes to CANCELLED, buttons disappear.

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/me/build-requests/[id]/page.tsx \
  src/components/cabinet/cancel-build-request-button.tsx
git commit -m "feat(build-request): add /me/build-requests/[id] detail page"
```

---

## Task 14: `/me/build-requests/[id]/edit` edit page

**Files:**
- Create: `src/app/[locale]/me/build-requests/[id]/edit/page.tsx`

- [ ] **Step 1: Implement**

Create the file, structured like `new/page.tsx` but loading the existing request:

```tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BuildRequestForm } from "@/components/cabinet/build-request-form";
import { getBuildRequestFormLabels } from "@/lib/build-request-form-labels";

export default async function EditBuildRequestPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login`);

  const r = await prisma.buildRequest.findUnique({ where: { id } });
  if (!r || r.userId !== session.user.id) notFound();

  if (r.status !== "OPEN") {
    redirect(`/${locale}/me/build-requests/${id}?notEditable=1`);
  }

  const [user, t, labels] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { name: true, phone: true },
    }),
    getTranslations("cabinet.buildRequest"),
    getBuildRequestFormLabels(),
  ]);

  return (
    <div>
      <Link href={`/${locale}/me/build-requests/${id}`} className="text-sm text-muted">← {t("action.back")}</Link>
      <h1 className="text-[28px] font-bold mt-2 mb-6">{t("action.edit")}</h1>
      <BuildRequestForm
        mode={{ kind: "edit", id }}
        locale={locale}
        hasPhone={user.phone != null}
        hasName={user.name != null}
        initial={{
          source: r.source,
          peakKw: r.peakKw.toNumber(),
          wantPowerbank: r.wantPowerbank,
          powerbankKwh: r.powerbankKwh?.toNumber(),
          wantEvCharger: r.wantEvCharger,
          evChargerPorts: r.evChargerPorts ?? undefined,
          evPublicForSale: r.evPublicForSale,
          country: r.country,
          city: r.city,
          addressLine: r.addressLine,
          siteType: r.siteType,
          availableAreaM2: r.availableAreaM2 ?? undefined,
          roofOrientation: r.roofOrientation ?? undefined,
          budget: r.budget,
          timeline: r.timeline,
          notes: r.notes ?? undefined,
        }}
        labels={labels}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Create a request, then visit `/me/build-requests/<id>/edit`. Form is pre-filled. Change peakKw, save. Should redirect to detail with new value. Then change status to MATCHED in `db:studio` and re-visit edit URL — should redirect to detail.

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/me/build-requests/[id]/edit/page.tsx
# also commit the helper if you extracted one
git commit -m "feat(build-request): add /me/build-requests/[id]/edit page"
```

---

## Task 15: Admin layout (role gate)

**Files:**
- Create: `src/app/[locale]/admin/layout.tsx`

- [ ] **Step 1: Implement**

```tsx
import { redirect, notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { auth } from "@/lib/auth";

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/admin/build-requests`);
  // 404 (not 403) — don't leak that the route exists to non-admins.
  if (session.user.role !== "ADMIN") notFound();

  const t = await getTranslations("admin.buildRequest");

  return (
    <main className="bg-bg min-h-[calc(100vh-4rem)]">
      <div className="max-w-[1600px] mx-auto px-4 md:px-12 xl:px-20 py-8 md:py-12">
        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-8">
          <aside className="md:sticky md:top-20 md:self-start">
            <div className="mb-6 hidden md:block">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted">ADMIN</div>
              <div className="text-[18px] font-semibold">{session.user.username}</div>
            </div>
            <nav className="flex md:flex-col">
              <Link
                href={`/${locale}/admin/build-requests`}
                prefetch={false}
                className="text-[14px] text-muted hover:text-foreground py-2 md:py-2.5"
              >
                🔧 {t("title")}
              </Link>
            </nav>
          </aside>
          <section className="min-w-0">{children}</section>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Grant yourself admin in dev DB**

Run: `npm run grant-admin -- yourUsername`

If the script doesn't exist in `scripts/`, create a minimal one:

```ts
// scripts/grant-admin.ts
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const username = process.argv[2];
if (!username) { console.error("usage: grant-admin <username>"); process.exit(1); }
await prisma.user.update({ where: { username }, data: { role: "ADMIN" } });
console.log(`granted ADMIN to ${username}`);
await prisma.$disconnect();
```

- [ ] **Step 3: Verify gate**

Log in as a non-admin user, visit `/en/admin/build-requests` → 404.
Log in as admin → see empty page (page itself comes in Task 16).

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/admin/layout.tsx scripts/grant-admin.ts
git commit -m "feat(admin): add admin layout with role-gated 404"
```

---

## Task 16: Admin list `/admin/build-requests`

**Files:**
- Create: `src/app/[locale]/admin/build-requests/page.tsx`

- [ ] **Step 1: Implement**

```tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { BuildRequestStatus } from "@prisma/client";

const VALID_STATUSES: BuildRequestStatus[] = ["OPEN", "MATCHED", "FULFILLED", "CANCELLED"];

export default async function AdminBuildRequestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; country?: string; page?: string }>;
}) {
  const { locale } = await params;
  const { status: rawStatus, country: rawCountry, page: rawPage } = await searchParams;
  setRequestLocale(locale);

  const status = VALID_STATUSES.includes(rawStatus as BuildRequestStatus)
    ? (rawStatus as BuildRequestStatus)
    : undefined;
  const country = rawCountry?.match(/^[A-Z]{2}$/) ? rawCountry : undefined;
  const page = Math.max(1, Number(rawPage) || 1);
  const pageSize = 50;

  const where = {
    ...(status ? { status } : {}),
    ...(country ? { country } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.buildRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, createdAt: true, source: true, peakKw: true,
        country: true, city: true, status: true,
        user: { select: { username: true } },
      },
    }),
    prisma.buildRequest.count({ where }),
  ]);

  const t = await getTranslations("admin.buildRequest");

  return (
    <div>
      <h1 className="text-[28px] font-bold mb-6">{t("title")}</h1>

      <form className="flex gap-2 mb-6 text-sm">
        <select name="status" defaultValue={status ?? ""} className="border border-hairline rounded px-2 py-1">
          <option value="">{t("filter.all")}</option>
          {VALID_STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}
        </select>
        <input name="country" defaultValue={country ?? ""} placeholder="SK" maxLength={2} className="border border-hairline rounded px-2 py-1 w-20 uppercase" />
        <button type="submit" className="px-3 py-1 border border-hairline rounded">Apply</button>
      </form>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-hairline text-left text-muted">
            <th className="py-2">{t("table.createdAt")}</th>
            <th>{t("table.owner")}</th>
            <th>{t("table.source")}</th>
            <th className="text-right">kW</th>
            <th>{t("table.country")}</th>
            <th>{t("table.status")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-hairline">
              <td className="py-2">
                <Link href={`/${locale}/admin/build-requests/${r.id}`} className="underline">
                  {r.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </Link>
              </td>
              <td>@{r.user.username}</td>
              <td>{r.source}</td>
              <td className="text-right num">{r.peakKw.toString()}</td>
              <td>{r.country} {r.city}</td>
              <td>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-xs text-muted mt-4">Page {page} of {Math.max(1, Math.ceil(total / pageSize))}, {total} total.</p>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

As admin, visit `/en/admin/build-requests`. Should show all requests. Filter by status=OPEN → only OPEN rows. Filter by country=SK → only SK rows.

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/admin/build-requests/page.tsx
git commit -m "feat(admin): add /admin/build-requests list with filters"
```

---

## Task 17: Admin detail `/admin/build-requests/[id]` + status form

**Files:**
- Create: `src/app/[locale]/admin/build-requests/[id]/page.tsx`
- Create: `src/components/admin/status-change-form.tsx`

- [ ] **Step 1: Status change form (client)**

Create `src/components/admin/status-change-form.tsx`:

```tsx
"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import type { BuildRequestStatus } from "@prisma/client";
import { adminSetBuildRequestStatus } from "@/app/[locale]/admin/build-requests/actions";

type Props = {
  id: string;
  currentStatus: BuildRequestStatus;
  allowedNext: BuildRequestStatus[];
  labels: { setStatus: string; adminNote: string; submit: string };
};

export function StatusChangeForm({ id, currentStatus, allowedNext, labels }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<BuildRequestStatus | "">(allowedNext[0] ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (allowedNext.length === 0) {
    return <p className="text-sm text-muted">No transitions available from {currentStatus}.</p>;
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    setError(null);
    startTransition(async () => {
      const r = await adminSetBuildRequestStatus(id, target as BuildRequestStatus, note);
      if (!r.ok) setError(r.formError ?? r.fieldErrors?.adminNote ?? "Failed");
      else router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 border border-hairline rounded p-4">
      <label className="block text-sm">
        {labels.setStatus}
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value as BuildRequestStatus)}
          className="block mt-1 border border-hairline rounded px-2 py-1"
        >
          {allowedNext.map((s) => (<option key={s} value={s}>{s}</option>))}
        </select>
      </label>
      <label className="block text-sm">
        {labels.adminNote}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="block mt-1 border border-hairline rounded px-2 py-1 w-full"
        />
      </label>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button type="submit" disabled={pending} className="px-4 py-2 bg-foreground text-bg rounded disabled:opacity-50">
        {labels.submit}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Detail page**

Create `src/app/[locale]/admin/build-requests/[id]/page.tsx`:

```tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { BuildRequestStatus } from "@prisma/client";
import { StatusChangeForm } from "@/components/admin/status-change-form";

const NEXT: Record<BuildRequestStatus, BuildRequestStatus[]> = {
  OPEN: ["MATCHED", "CANCELLED"],
  MATCHED: ["FULFILLED", "CANCELLED"],
  FULFILLED: [],
  CANCELLED: [],
};

export default async function AdminBuildRequestDetail({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const r = await prisma.buildRequest.findUnique({
    where: { id },
    include: { user: { select: { username: true, name: true, email: true, phone: true } } },
  });
  if (!r) notFound();

  const t = await getTranslations("admin.buildRequest");

  return (
    <div className="max-w-3xl space-y-6">
      <Link href={`/${locale}/admin/build-requests`} className="text-sm text-muted">← Back</Link>
      <h1 className="text-[28px] font-bold">Request #{r.id.slice(0, 8)}</h1>

      <section className="border border-hairline rounded p-4">
        <h2 className="text-sm uppercase tracking-wide text-muted mb-2">Owner</h2>
        <p><b>@{r.user.username}</b> ({r.user.name ?? "—"})</p>
        <p>Email: {r.user.email ?? "—"}</p>
        <p>Phone: {r.user.phone ?? "—"}</p>
      </section>

      <section className="border border-hairline rounded p-4">
        <h2 className="text-sm uppercase tracking-wide text-muted mb-2">Request</h2>
        <p>{r.source} · <span className="num">{r.peakKw.toString()}</span> kW</p>
        <p>{r.country}, {r.city} — {r.addressLine}</p>
        <p>Site: {r.siteType}{r.roofOrientation ? ` · roof ${r.roofOrientation}` : ""}</p>
        {r.availableAreaM2 != null && <p>Area: {r.availableAreaM2} m²</p>}
        {r.wantPowerbank && <p>Powerbank: {r.powerbankKwh?.toString()} kWh</p>}
        {r.wantEvCharger && (
          <p>EV charger: {r.evChargerPorts} ports{r.evPublicForSale ? ", public" : ""}</p>
        )}
        <p>Budget: {r.budget} · Timeline: {r.timeline}</p>
        {r.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{r.notes}</p>}
      </section>

      <section className="border border-hairline rounded p-4">
        <h2 className="text-sm uppercase tracking-wide text-muted mb-2">Status</h2>
        <p>Current: <b>{r.status}</b></p>
        {r.adminNote && <p className="text-sm text-muted mt-2">Note: {r.adminNote}</p>}
      </section>

      <StatusChangeForm
        id={r.id}
        currentStatus={r.status}
        allowedNext={NEXT[r.status]}
        labels={{
          setStatus: t("action.setStatus"),
          adminNote: t("action.adminNote"),
          submit: t("action.submit"),
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify**

As admin, open an OPEN request. Change status to MATCHED with note "test". Page refreshes, status shows MATCHED, note shows. Re-load `/me/build-requests/<id>` as the owner — status pill is MATCHED, no Edit button.

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/admin/build-requests/[id]/page.tsx \
  src/components/admin/status-change-form.tsx
git commit -m "feat(admin): add request detail with status-change form"
```

---

## Task 18: E2E happy path (Playwright)

**Files:**
- Create: `tests/e2e/build-request-flow.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const OWNER = { username: "e2e_br_owner", password: "Pass1234" };
const ADMIN = { username: "e2e_br_admin", password: "Pass1234" };

test.beforeAll(async () => {
  const ownerHash = await bcrypt.hash(OWNER.password, 10);
  const adminHash = await bcrypt.hash(ADMIN.password, 10);
  await prisma.user.upsert({
    where: { username: OWNER.username },
    update: { passwordHash: ownerHash, phone: "+421900000001", name: "E2E Owner" },
    create: { username: OWNER.username, passwordHash: ownerHash, phone: "+421900000001", name: "E2E Owner" },
  });
  await prisma.user.upsert({
    where: { username: ADMIN.username },
    update: { passwordHash: adminHash, role: "ADMIN" },
    create: { username: ADMIN.username, passwordHash: adminHash, role: "ADMIN" },
  });
});

test.afterAll(async () => {
  await prisma.buildRequest.deleteMany({ where: { user: { username: { in: [OWNER.username, ADMIN.username] } } } });
  await prisma.$disconnect();
});

test("homeowner files request, admin marks it MATCHED", async ({ page }) => {
  // Owner logs in
  await page.goto("/en/login");
  await page.fill('input[name="username"]', OWNER.username);
  await page.fill('input[name="password"]', OWNER.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/en\/me\//);

  // New request
  await page.goto("/en/me/build-requests/new");
  await page.fill('input[name="peakKw"]', "8");
  await page.fill('input[name="country"]', "sk");
  await page.fill('input[name="city"]', "Bratislava");
  await page.fill('input[name="addressLine"]', "Hlavná 1");
  await page.click('button[type="submit"]');

  await page.waitForURL(/\/en\/me\/build-requests\/[a-z0-9]+/);
  await expect(page.locator("text=Open")).toBeVisible();
  const detailUrl = page.url();
  const requestId = detailUrl.split("/").pop()!;

  // Log out, log in as admin
  await page.goto("/en/api/auth/signout");
  await page.click('button[type="submit"]');
  await page.goto("/en/login");
  await page.fill('input[name="username"]', ADMIN.username);
  await page.fill('input[name="password"]', ADMIN.password);
  await page.click('button[type="submit"]');

  // Admin detail + status change
  await page.goto(`/en/admin/build-requests/${requestId}`);
  await page.fill('textarea', "Contacted SolarCo");
  await page.click('button:has-text("Apply")');
  await expect(page.locator("text=Current: MATCHED")).toBeVisible();
});
```

- [ ] **Step 2: Run it**

Pre-flight: `pm2 status` (server) or `npm run dev` (local) on :3000.

Run: `npm run test:e2e -- build-request-flow`
Expected: 1 passed.

If it fails on the login step, the form selectors may be slightly different — open `src/app/[locale]/login/page.tsx` and adjust the selectors.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/build-request-flow.spec.ts
git commit -m "test(build-request): add e2e happy-path spec"
```

---

## Task 19: Documentation & deployment hygiene

**Files:**
- Modify: `.env.example`
- Modify: `README.md` (one line under "Roadmap" pointing at this feature)

- [ ] **Step 1: Document the env var**

Append to `.env.example`:

```
# Address that receives a notification email for every new build request.
# Optional — when unset, the notification is skipped (logged with warn).
ADMIN_EMAIL=
```

- [ ] **Step 2: Add a roadmap line in README**

In `README.md`, under the existing roadmap section, add:

```
- [x] **Build-request cabinet (V1)** — homeowner files solar/wind requests at `/me/build-requests`; admin triages at `/admin/build-requests`. See `docs/superpowers/specs/2026-05-30-build-request-cabinet-design.md`.
```

- [ ] **Step 3: Final check — full test suite + lint**

Run: `npm run lint && npm run test && npm run test:e2e -- build-request-flow`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add .env.example README.md
git commit -m "docs(build-request): document ADMIN_EMAIL + roadmap entry"
```

---

## Done criteria

- All 19 tasks committed.
- `npm run lint` clean.
- `npm run test` green (unit + integration).
- `npm run test:e2e -- build-request-flow` green.
- Manually verified: signed-in user can create / view / edit / cancel a request; admin can see all + change status; emails log to console (or send if `RESEND_API_KEY` set).
- Spec section coverage: §1–10 each have at least one task implementing them. §11 (V2 deferrals) intentionally untouched.

## Deferred to future plans (not in this plan)

- Photo upload (V2 — needs blob storage decision)
- Public anonymized listing on landing (V2)
- Installer cabinet + claim flow (V2 — separate spec)
- Map picker for lat/lng (V2)
- Translations for the 26 non-EN/RU/SK locales (follow-up MR)
