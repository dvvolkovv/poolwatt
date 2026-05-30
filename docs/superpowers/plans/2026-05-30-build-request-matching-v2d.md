# BuildRequest ↔ Contractor Matching V2d Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the V1+V2a marketplace loop. APPROVED contractors browse a filtered feed of OPEN BuildRequests at `/me/contractor/[id]/requests`, express interest with an optional message. Homeowners pick exactly one from the existing `/me/build-requests/[id]` page. On accept: BR → MATCHED transactionally, sibling claims auto-rejected, full contact reveal both sides via email.

**Architecture:** One new Prisma model `BuildRequestClaim(buildRequestId, contractorId, status, message)` with `@@unique([buildRequestId, contractorId])`. No new routes on the homeowner side (extend existing BR detail). One new route on the contractor side (`/me/contractor/[id]/requests`). Three new server actions (`expressInterest`, `withdrawClaim`, `acceptClaim`). One new Resend module.

**Tech Stack:** Next.js 16 App Router, React 19 server components, Prisma 5, Auth.js v5, zod 4, next-intl 4, Resend 6, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-05-30-build-request-matching-v2d-design.md`

---

## Conventions

- **TDD** for schema + 3 server actions.
- **Test layout**: co-located `*.test.ts`. E2E in `tests/e2e/`.
- **Commits**: one per task. Message format `feat(matching): <what>`.
- **i18n**: EN + RU + SK at task time.
- **Existing infra reused**: `vitest.config.ts` (`@/` alias, `clearMocks: true`, `.env.local` loading), `src/test-setup.ts`, `src/lib/resend-build-request.ts` pattern, V1+V2a server-action pattern.

---

## Task 1: Prisma migration — BuildRequestClaim + enum

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_build_request_claim/migration.sql`

- [ ] **Step 1: Add enum**

Append to `prisma/schema.prisma` after the existing `EvUsageType` enum:

```prisma
enum BuildRequestClaimStatus {
  PENDING
  ACCEPTED
  REJECTED
  WITHDRAWN
}
```

- [ ] **Step 2: Add `BuildRequestClaim` model**

Append after `Contractor` and its `ContractorMember` companion:

```prisma
model BuildRequestClaim {
  id              String                    @id @default(cuid())
  buildRequestId  String
  buildRequest    BuildRequest              @relation(fields: [buildRequestId], references: [id], onDelete: Cascade)
  contractorId    String
  contractor      Contractor                @relation(fields: [contractorId], references: [id], onDelete: Cascade)

  status          BuildRequestClaimStatus   @default(PENDING)
  message         String?                   @db.Text

  createdAt       DateTime                  @default(now())
  respondedAt     DateTime?

  @@unique([buildRequestId, contractorId])
  @@index([buildRequestId, status])
  @@index([contractorId, status])
}
```

- [ ] **Step 3: Add back-relations**

In the existing `BuildRequest { ... }` block, add at the end (before the closing `}`):

```prisma
  claims          BuildRequestClaim[]
```

In the existing `Contractor { ... }` block, add at the end:

```prisma
  claims          BuildRequestClaim[]
```

- [ ] **Step 4: Generate migration**

```bash
set -a && source .env.local && set +a && npm run db:migrate -- --name add_build_request_claim
```

Expected: `Your database is now in sync with your schema.` + `✔ Generated Prisma Client`.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(matching): add BuildRequestClaim model + status enum"
```

---

## Task 2: Zod schemas (TDD)

**Files:**
- Create: `src/lib/build-request-claim-schema.ts`
- Create: `src/lib/build-request-claim-schema.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/build-request-claim-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { expressInterestInputSchema } from "./build-request-claim-schema";

describe("expressInterestInputSchema", () => {
  it("accepts no message", () => {
    expect(expressInterestInputSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a 10-char message", () => {
    expect(expressInterestInputSchema.safeParse({ message: "1234567890" }).success).toBe(true);
  });

  it("accepts a 500-char message", () => {
    expect(expressInterestInputSchema.safeParse({ message: "x".repeat(500) }).success).toBe(true);
  });

  it("rejects a 9-char message (when provided)", () => {
    const r = expressInterestInputSchema.safeParse({ message: "123456789" });
    expect(r.success).toBe(false);
  });

  it("rejects a 501-char message", () => {
    const r = expressInterestInputSchema.safeParse({ message: "x".repeat(501) });
    expect(r.success).toBe(false);
  });

  it("accepts empty-string message as omitted", () => {
    const r = expressInterestInputSchema.safeParse({ message: "" });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/build-request-claim-schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement schema**

Create `src/lib/build-request-claim-schema.ts`:

```ts
import { z } from "zod";

export const expressInterestInputSchema = z.object({
  message: z
    .union([
      z.string().length(0),
      z.string().min(10).max(500),
    ])
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});

export type ExpressInterestInput = z.infer<typeof expressInterestInputSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/build-request-claim-schema.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/build-request-claim-schema.ts src/lib/build-request-claim-schema.test.ts
git commit -m "feat(matching): add zod schema for expressInterest input"
```

---

## Task 3: Resend stub + expressInterest action (TDD)

**Files:**
- Create: `src/lib/resend-match.ts` (stub — real impl in Task 6)
- Create: `src/app/[locale]/me/contractor/[id]/requests/actions.ts`
- Create: `src/app/[locale]/me/contractor/[id]/requests/actions.test.ts`

- [ ] **Step 1: Create resend stub**

Create `src/lib/resend-match.ts`:

```ts
// Stub created in Task 3. Real implementation lands in Task 6.
export async function sendInterestExpressedToOwner(_claim: unknown): Promise<void> {}
export async function sendClaimAcceptedToContractor(_claim: unknown): Promise<void> {}
export async function sendClaimRejectedToContractor(_claim: unknown): Promise<void> {}
```

- [ ] **Step 2: Write failing tests**

Create `src/app/[locale]/me/contractor/[id]/requests/actions.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { expressInterest } from "./actions";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/resend-match", () => ({
  sendInterestExpressedToOwner: vi.fn(),
  sendClaimAcceptedToContractor: vi.fn(),
  sendClaimRejectedToContractor: vi.fn(),
}));

import { auth } from "@/lib/auth";
const mockedAuth = vi.mocked(auth);

const PREFIX = "test_match_";

async function ensureUser(username: string) {
  return prisma.user.upsert({
    where: { username }, update: {}, create: { username, passwordHash: "x" },
  });
}

async function seedHomeowner() {
  const u = await ensureUser(`${PREFIX}home`);
  const br = await prisma.buildRequest.create({
    data: {
      userId: u.id,
      source: "SOLAR",
      peakKw: 10,
      country: "SK",
      city: "Bratislava",
      addressLine: "Hlavná 1",
      siteType: "PRIVATE_HOUSE",
      roofOrientation: "S",
    },
  });
  return { user: u, br };
}

async function seedContractor(opts: { username: string; status?: "PENDING" | "APPROVED"; countries?: string[]; renewables?: ("SOLAR"|"WIND")[] }) {
  const u = await ensureUser(opts.username);
  const c = await prisma.contractor.create({
    data: {
      slug: `${PREFIX}${opts.username}`,
      entityType: "INDIVIDUAL",
      displayName: `Test ${opts.username}`,
      country: "SK",
      city: "Bratislava",
      workCategories: ["INSTALLATION"],
      renewableTypes: opts.renewables ?? ["SOLAR"],
      countriesServed: opts.countries ?? ["SK"],
      bio: "x".repeat(150),
      contactEmail: `${opts.username}@x.test`,
      contactPhone: "+421900000000",
      status: opts.status ?? "APPROVED",
    },
  });
  await prisma.contractorMember.create({
    data: { contractorId: c.id, userId: u.id, role: "OWNER" },
  });
  return { user: u, contractor: c };
}

beforeEach(async () => {
  await prisma.buildRequestClaim.deleteMany({});
  await prisma.buildRequest.deleteMany({ where: { user: { username: { startsWith: PREFIX } } } });
  await prisma.contractor.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("expressInterest", () => {
  it("rejects when not authenticated", async () => {
    const { br } = await seedHomeowner();
    const { contractor } = await seedContractor({ username: "ctr1" });
    mockedAuth.mockResolvedValueOnce(null as never);

    const r = await expressInterest({ buildRequestId: br.id, contractorId: contractor.id });
    expect(r.ok).toBe(false);
    expect(r.formError).toMatch(/auth/i);
  });

  it("rejects when caller is not an OWNER of the contractor", async () => {
    const { br } = await seedHomeowner();
    const { contractor } = await seedContractor({ username: "ctr2" });
    const intruder = await ensureUser(`${PREFIX}intruder`);
    mockedAuth.mockResolvedValueOnce({ user: { id: intruder.id, username: intruder.username, role: "USER" } } as never);

    const r = await expressInterest({ buildRequestId: br.id, contractorId: contractor.id });
    expect(r.ok).toBe(false);
  });

  it("rejects when contractor is not APPROVED", async () => {
    const { br } = await seedHomeowner();
    const { user, contractor } = await seedContractor({ username: "ctr3", status: "PENDING" });
    mockedAuth.mockResolvedValueOnce({ user: { id: user.id, username: user.username, role: "USER" } } as never);

    const r = await expressInterest({ buildRequestId: br.id, contractorId: contractor.id });
    expect(r.ok).toBe(false);
    expect(r.formError).toMatch(/approved/i);
  });

  it("rejects when BuildRequest is not OPEN", async () => {
    const { br } = await seedHomeowner();
    await prisma.buildRequest.update({ where: { id: br.id }, data: { status: "MATCHED" } });
    const { user, contractor } = await seedContractor({ username: "ctr4" });
    mockedAuth.mockResolvedValueOnce({ user: { id: user.id, username: user.username, role: "USER" } } as never);

    const r = await expressInterest({ buildRequestId: br.id, contractorId: contractor.id });
    expect(r.ok).toBe(false);
  });

  it("creates a PENDING claim on happy path", async () => {
    const { br } = await seedHomeowner();
    const { user, contractor } = await seedContractor({ username: "ctr5" });
    mockedAuth.mockResolvedValueOnce({ user: { id: user.id, username: user.username, role: "USER" } } as never);

    const r = await expressInterest({ buildRequestId: br.id, contractorId: contractor.id, message: "We can build this in 8 weeks." });
    expect(r.ok).toBe(true);
    expect(r.claimId).toBeDefined();
    const stored = await prisma.buildRequestClaim.findUniqueOrThrow({ where: { id: r.claimId! } });
    expect(stored.status).toBe("PENDING");
    expect(stored.buildRequestId).toBe(br.id);
    expect(stored.contractorId).toBe(contractor.id);
    expect(stored.message).toBe("We can build this in 8 weeks.");
  });

  it("rejects duplicate claim by same contractor on same BR", async () => {
    const { br } = await seedHomeowner();
    const { user, contractor } = await seedContractor({ username: "ctr6" });
    mockedAuth.mockResolvedValue({ user: { id: user.id, username: user.username, role: "USER" } } as never);

    const first = await expressInterest({ buildRequestId: br.id, contractorId: contractor.id });
    expect(first.ok).toBe(true);

    const second = await expressInterest({ buildRequestId: br.id, contractorId: contractor.id });
    expect(second.ok).toBe(false);
    expect(second.formError).toMatch(/already/i);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/app/[locale]/me/contractor/[id]/requests/actions.test.ts`
Expected: FAIL — module `./actions` not found.

- [ ] **Step 4: Implement expressInterest**

Create `src/app/[locale]/me/contractor/[id]/requests/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { expressInterestInputSchema } from "@/lib/build-request-claim-schema";

export type ActionResult = {
  ok: boolean;
  claimId?: string;
  fieldErrors?: Record<string, string>;
  formError?: string;
};

export async function expressInterest(input: {
  buildRequestId: string;
  contractorId: string;
  message?: string;
}): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated" };

  // Validate message
  const parsed = expressInterestInputSchema.safeParse({ message: input.message ?? "" });
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: { message: parsed.error.issues[0]?.message ?? "invalid" },
    };
  }
  const message = parsed.data.message ?? null;

  // OWNER of contractor + APPROVED
  const contractor = await prisma.contractor.findUnique({
    where: { id: input.contractorId },
    select: {
      id: true,
      status: true,
      displayName: true,
      members: {
        where: { userId: session.user.id, role: "OWNER" },
        select: { userId: true },
      },
    },
  });
  if (!contractor || contractor.members.length === 0) {
    return { ok: false, formError: "Contractor not found" };
  }
  if (contractor.status !== "APPROVED") {
    return { ok: false, formError: "Your contractor profile must be APPROVED before you can express interest" };
  }

  // BR exists + OPEN
  const br = await prisma.buildRequest.findUnique({
    where: { id: input.buildRequestId },
    select: { id: true, status: true, userId: true },
  });
  if (!br) return { ok: false, formError: "Build request not found" };
  if (br.status !== "OPEN") return { ok: false, formError: "This build request is no longer open" };

  // Insert; unique constraint handles duplicates
  try {
    const created = await prisma.buildRequestClaim.create({
      data: {
        buildRequestId: br.id,
        contractorId: contractor.id,
        status: "PENDING",
        message,
      },
      select: { id: true },
    });

    try {
      const { sendInterestExpressedToOwner } = await import("@/lib/resend-match");
      await sendInterestExpressedToOwner({ claimId: created.id, buildRequestId: br.id, contractorName: contractor.displayName, ownerUserId: br.userId });
    } catch (err) {
      console.error("[matching] interest-expressed notification failed:", err);
    }

    revalidatePath(`/[locale]/me/contractor/${contractor.id}/requests`, "page");
    revalidatePath(`/[locale]/me/build-requests/${br.id}`, "page");
    return { ok: true, claimId: created.id };
  } catch (err) {
    // P2002 = unique constraint violation
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Unique constraint") || msg.includes("P2002")) {
      return { ok: false, formError: "You have already expressed interest in this request" };
    }
    throw err;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/app/[locale]/me/contractor/[id]/requests/actions.test.ts`
Expected: 6 passed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/resend-match.ts \
  src/app/[locale]/me/contractor/[id]/requests/actions.ts \
  src/app/[locale]/me/contractor/[id]/requests/actions.test.ts
git commit -m "feat(matching): add expressInterest action + Resend stub"
```

---

## Task 4: withdrawClaim action (TDD)

**Files:**
- Modify: `src/app/[locale]/me/contractor/[id]/requests/actions.ts`
- Modify: `src/app/[locale]/me/contractor/[id]/requests/actions.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `actions.test.ts`:

```ts
import { withdrawClaim } from "./actions";

describe("withdrawClaim", () => {
  it("withdraws a PENDING claim when caller is OWNER", async () => {
    const { br } = await seedHomeowner();
    const { user, contractor } = await seedContractor({ username: "ctr_wd1" });
    mockedAuth.mockResolvedValue({ user: { id: user.id, username: user.username, role: "USER" } } as never);

    const c = await expressInterest({ buildRequestId: br.id, contractorId: contractor.id });
    expect(c.ok).toBe(true);

    const r = await withdrawClaim({ claimId: c.claimId!, contractorId: contractor.id });
    expect(r.ok).toBe(true);
    const reloaded = await prisma.buildRequestClaim.findUniqueOrThrow({ where: { id: c.claimId! } });
    expect(reloaded.status).toBe("WITHDRAWN");
    expect(reloaded.respondedAt).not.toBeNull();
  });

  it("refuses if caller is not OWNER", async () => {
    const { br } = await seedHomeowner();
    const { user, contractor } = await seedContractor({ username: "ctr_wd2" });
    mockedAuth.mockResolvedValueOnce({ user: { id: user.id, username: user.username, role: "USER" } } as never);
    const c = await expressInterest({ buildRequestId: br.id, contractorId: contractor.id });

    const intruder = await ensureUser(`${PREFIX}wd_intruder`);
    mockedAuth.mockResolvedValueOnce({ user: { id: intruder.id, username: intruder.username, role: "USER" } } as never);

    const r = await withdrawClaim({ claimId: c.claimId!, contractorId: contractor.id });
    expect(r.ok).toBe(false);
  });

  it("refuses if claim not PENDING", async () => {
    const { br } = await seedHomeowner();
    const { user, contractor } = await seedContractor({ username: "ctr_wd3" });
    mockedAuth.mockResolvedValue({ user: { id: user.id, username: user.username, role: "USER" } } as never);
    const c = await expressInterest({ buildRequestId: br.id, contractorId: contractor.id });
    await prisma.buildRequestClaim.update({ where: { id: c.claimId! }, data: { status: "ACCEPTED" } });

    const r = await withdrawClaim({ claimId: c.claimId!, contractorId: contractor.id });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/[locale]/me/contractor/[id]/requests/actions.test.ts`
Expected: 3 new tests FAIL — `withdrawClaim is not a function`.

- [ ] **Step 3: Append implementation**

Append to `actions.ts`:

```ts
export async function withdrawClaim(input: {
  claimId: string;
  contractorId: string;
}): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated" };

  const member = await prisma.contractorMember.findUnique({
    where: { contractorId_userId: { contractorId: input.contractorId, userId: session.user.id } },
    select: { role: true },
  });
  if (!member || member.role !== "OWNER") {
    return { ok: false, formError: "Contractor not found" };
  }

  const claim = await prisma.buildRequestClaim.findUnique({
    where: { id: input.claimId },
    select: { id: true, contractorId: true, status: true, buildRequestId: true },
  });
  if (!claim || claim.contractorId !== input.contractorId) {
    return { ok: false, formError: "Claim not found" };
  }
  if (claim.status !== "PENDING") {
    return { ok: false, formError: "Claim can no longer be withdrawn" };
  }

  await prisma.buildRequestClaim.update({
    where: { id: claim.id },
    data: { status: "WITHDRAWN", respondedAt: new Date() },
  });

  revalidatePath(`/[locale]/me/contractor/${input.contractorId}/requests`, "page");
  revalidatePath(`/[locale]/me/build-requests/${claim.buildRequestId}`, "page");
  return { ok: true, claimId: claim.id };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/[locale]/me/contractor/[id]/requests/actions.test.ts`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add src/app/[locale]/me/contractor/[id]/requests/actions.ts \
  src/app/[locale]/me/contractor/[id]/requests/actions.test.ts
git commit -m "feat(matching): add withdrawClaim action"
```

---

## Task 5: acceptClaim action + cancelBuildRequest cascade (TDD)

**Files:**
- Modify: `src/app/[locale]/me/build-requests/actions.ts`
- Modify: `src/app/[locale]/me/build-requests/actions.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `src/app/[locale]/me/build-requests/actions.test.ts`:

```ts
import { acceptClaim } from "./actions";

describe("acceptClaim", () => {
  async function setupBrAndClaims(opts: { count: number }) {
    const owner = await ensureUser("test_br_accept_owner");
    mockedAuth.mockResolvedValue({ user: { id: owner.id, username: owner.username, role: "USER" } } as never);
    const created = await createBuildRequest(formInput);
    const claimIds: string[] = [];
    for (let i = 0; i < opts.count; i++) {
      const ctrUser = await prisma.user.upsert({
        where: { username: `test_br_accept_ctr_${i}` },
        update: {}, create: { username: `test_br_accept_ctr_${i}`, passwordHash: "x" },
      });
      const ctr = await prisma.contractor.create({
        data: {
          slug: `test_br_accept_slug_${Date.now()}_${i}`,
          entityType: "INDIVIDUAL",
          displayName: `AcceptCo ${i}`,
          country: "SK", city: "Bratislava",
          workCategories: ["INSTALLATION"],
          renewableTypes: ["SOLAR"],
          countriesServed: ["SK"],
          bio: "x".repeat(150),
          contactEmail: `c${i}@x.test`, contactPhone: "+421900000000",
          status: "APPROVED",
        },
      });
      await prisma.contractorMember.create({ data: { contractorId: ctr.id, userId: ctrUser.id, role: "OWNER" } });
      const claim = await prisma.buildRequestClaim.create({
        data: { buildRequestId: created.id!, contractorId: ctr.id, status: "PENDING" },
      });
      claimIds.push(claim.id);
    }
    return { owner, brId: created.id!, claimIds };
  }

  it("happy path: ACCEPTED claim + siblings REJECTED + BR MATCHED", async () => {
    const { brId, claimIds } = await setupBrAndClaims({ count: 3 });

    const r = await acceptClaim(claimIds[0]);
    expect(r.ok).toBe(true);

    const accepted = await prisma.buildRequestClaim.findUniqueOrThrow({ where: { id: claimIds[0] } });
    expect(accepted.status).toBe("ACCEPTED");
    expect(accepted.respondedAt).not.toBeNull();

    const rej1 = await prisma.buildRequestClaim.findUniqueOrThrow({ where: { id: claimIds[1] } });
    const rej2 = await prisma.buildRequestClaim.findUniqueOrThrow({ where: { id: claimIds[2] } });
    expect(rej1.status).toBe("REJECTED");
    expect(rej2.status).toBe("REJECTED");

    const br = await prisma.buildRequest.findUniqueOrThrow({ where: { id: brId } });
    expect(br.status).toBe("MATCHED");
  });

  it("rejects when caller is not the BR owner", async () => {
    const { brId, claimIds } = await setupBrAndClaims({ count: 1 });
    const intruder = await ensureUser("test_br_accept_intruder");
    mockedAuth.mockResolvedValueOnce({ user: { id: intruder.id, username: intruder.username, role: "USER" } } as never);

    const r = await acceptClaim(claimIds[0]);
    expect(r.ok).toBe(false);
  });

  it("rejects when claim is not PENDING", async () => {
    const { claimIds } = await setupBrAndClaims({ count: 1 });
    await prisma.buildRequestClaim.update({ where: { id: claimIds[0] }, data: { status: "WITHDRAWN" } });

    const r = await acceptClaim(claimIds[0]);
    expect(r.ok).toBe(false);
  });

  it("rejects when BR is not OPEN", async () => {
    const { brId, claimIds } = await setupBrAndClaims({ count: 1 });
    await prisma.buildRequest.update({ where: { id: brId }, data: { status: "CANCELLED" } });

    const r = await acceptClaim(claimIds[0]);
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/[locale]/me/build-requests/actions.test.ts`
Expected: 4 new tests FAIL.

- [ ] **Step 3: Append implementation**

Append to `src/app/[locale]/me/build-requests/actions.ts`:

```ts
export async function acceptClaim(claimId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated" };

  const claim = await prisma.buildRequestClaim.findUnique({
    where: { id: claimId },
    select: {
      id: true,
      status: true,
      contractorId: true,
      buildRequest: { select: { id: true, userId: true, status: true } },
    },
  });
  if (!claim) return { ok: false, formError: "Claim not found" };

  if (claim.buildRequest.userId !== session.user.id) {
    return { ok: false, formError: "Claim not found" };
  }
  if (claim.status !== "PENDING") {
    return { ok: false, formError: "Claim cannot be accepted (not PENDING)" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Atomically flip BR from OPEN → MATCHED. The where-clause acts as a guard.
      const updated = await tx.buildRequest.update({
        where: { id: claim.buildRequest.id, status: "OPEN" },
        data: {
          status: "MATCHED",
          statusChangedAt: new Date(),
          statusChangedById: session.user.id,
        },
        select: { id: true },
      });

      // Accept this claim
      await tx.buildRequestClaim.update({
        where: { id: claim.id },
        data: { status: "ACCEPTED", respondedAt: new Date() },
      });

      // Reject all sibling PENDING claims
      await tx.buildRequestClaim.updateMany({
        where: {
          buildRequestId: updated.id,
          status: "PENDING",
          NOT: { id: claim.id },
        },
        data: { status: "REJECTED", respondedAt: new Date() },
      });
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("P2025")) {
      return { ok: false, formError: "Request status changed concurrently — please refresh" };
    }
    throw err;
  }

  // Fire notifications (best-effort)
  try {
    const { sendClaimAcceptedToContractor, sendClaimRejectedToContractor } = await import("@/lib/resend-match");
    await sendClaimAcceptedToContractor({ claimId: claim.id, buildRequestId: claim.buildRequest.id, contractorId: claim.contractorId });
    const siblings = await prisma.buildRequestClaim.findMany({
      where: { buildRequestId: claim.buildRequest.id, status: "REJECTED" },
      select: { id: true, contractorId: true },
    });
    for (const s of siblings) {
      await sendClaimRejectedToContractor({ claimId: s.id, buildRequestId: claim.buildRequest.id, contractorId: s.contractorId });
    }
  } catch (err) {
    console.error("[matching] accept notifications failed:", err);
  }

  revalidatePath(`/[locale]/me/build-requests/${claim.buildRequest.id}`, "page");
  revalidatePath(`/[locale]/me/contractor/[id]/requests`, "page");
  return { ok: true };
}
```

- [ ] **Step 4: Extend cancelBuildRequest to cascade-withdraw PENDING claims**

In the same file, find the existing `cancelBuildRequest` action. After the line that sets `status: "CANCELLED"` (likely a `prisma.buildRequest.update(...)`), wrap the existing prisma.update in a transaction with an extra step to mark all PENDING claims as WITHDRAWN:

Locate the existing block:

```ts
await prisma.buildRequest.update({
  where: { id },
  data: {
    status: "CANCELLED",
    statusChangedAt: new Date(),
    statusChangedById: session.user.id,
  },
});
```

Replace with:

```ts
await prisma.$transaction([
  prisma.buildRequest.update({
    where: { id },
    data: {
      status: "CANCELLED",
      statusChangedAt: new Date(),
      statusChangedById: session.user.id,
    },
  }),
  prisma.buildRequestClaim.updateMany({
    where: { buildRequestId: id, status: "PENDING" },
    data: { status: "WITHDRAWN", respondedAt: new Date() },
  }),
]);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/app/[locale]/me/build-requests/actions.test.ts`
Expected: all pass (existing + 4 new acceptClaim tests).

- [ ] **Step 6: Commit**

```bash
git add src/app/[locale]/me/build-requests/actions.ts \
  src/app/[locale]/me/build-requests/actions.test.ts
git commit -m "feat(matching): add acceptClaim + cascade-withdraw on BR cancel"
```

---

## Task 6: Resend email helpers (real implementation)

**Files:**
- Modify (overwrite): `src/lib/resend-match.ts`

- [ ] **Step 1: Overwrite stub with real impl**

```ts
import { Resend } from "resend";
import { prisma } from "@/lib/prisma";

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

export type InterestExpressedPayload = {
  claimId: string;
  buildRequestId: string;
  contractorName: string;
  ownerUserId: string;
};

export async function sendInterestExpressedToOwner(p: InterestExpressedPayload): Promise<void> {
  const owner = await prisma.user.findUnique({
    where: { id: p.ownerUserId },
    select: { email: true, emailVerified: true, username: true },
  });
  if (!owner?.email || !owner.emailVerified) return;

  const url = `${BASE}/en/me/build-requests/${p.buildRequestId}`;
  const shortId = p.buildRequestId.slice(0, 8);
  const c = client();
  if (!c) {
    console.log(`[resend stub] interest expressed by ${p.contractorName} on BR ${shortId} → ${owner.email}: ${url}`);
    return;
  }
  await c.emails.send({
    from: FROM,
    to: owner.email,
    subject: `[Poolwatt] ${p.contractorName} is interested in your build request #${shortId}`,
    html: `
      <p>Hi ${owner.username},</p>
      <p><b>${p.contractorName}</b> has expressed interest in your build request <b>#${shortId}</b>.</p>
      <p><a href="${url}">Review and accept</a></p>
    `,
  });
}

export type ClaimAcceptedPayload = {
  claimId: string;
  buildRequestId: string;
  contractorId: string;
};

export async function sendClaimAcceptedToContractor(p: ClaimAcceptedPayload): Promise<void> {
  const claim = await prisma.buildRequestClaim.findUnique({
    where: { id: p.claimId },
    select: {
      contractor: {
        select: {
          displayName: true,
          members: {
            where: { role: "OWNER" },
            take: 1,
            include: { user: { select: { email: true, emailVerified: true, username: true } } },
          },
        },
      },
      buildRequest: {
        select: {
          user: { select: { name: true, phone: true, email: true } },
          city: true, country: true, addressLine: true, source: true, peakKw: true,
        },
      },
    },
  });
  if (!claim) return;
  const owner = claim.contractor.members[0]?.user;
  if (!owner?.email || !owner.emailVerified) return;

  const shortId = p.buildRequestId.slice(0, 8);
  const url = `${BASE}/en/me/contractor/${p.contractorId}/requests`;
  const hw = claim.buildRequest.user;

  const cli = client();
  if (!cli) {
    console.log(`[resend stub] claim ${p.claimId} ACCEPTED — contact ${owner.email}`);
    return;
  }
  await cli.emails.send({
    from: FROM,
    to: owner.email,
    subject: `[Poolwatt] Your interest in request #${shortId} was accepted — contact details inside`,
    html: `
      <p>Hi ${owner.username},</p>
      <p>The homeowner accepted your interest in build request <b>#${shortId}</b>.</p>
      <h3>Contact details</h3>
      <ul>
        <li>Name: <b>${hw.name ?? "—"}</b></li>
        <li>Email: ${hw.email ?? "—"}</li>
        <li>Phone: ${hw.phone ?? "—"}</li>
        <li>Address: ${claim.buildRequest.addressLine}, ${claim.buildRequest.city}, ${claim.buildRequest.country}</li>
      </ul>
      <p>Project: ${claim.buildRequest.source}, ${claim.buildRequest.peakKw.toString()} kW peak.</p>
      <p><a href="${url}">Open your dashboard</a></p>
    `,
  });
}

export type ClaimRejectedPayload = {
  claimId: string;
  buildRequestId: string;
  contractorId: string;
};

export async function sendClaimRejectedToContractor(p: ClaimRejectedPayload): Promise<void> {
  const claim = await prisma.buildRequestClaim.findUnique({
    where: { id: p.claimId },
    select: {
      contractor: {
        select: {
          members: {
            where: { role: "OWNER" }, take: 1,
            include: { user: { select: { email: true, emailVerified: true, username: true } } },
          },
        },
      },
    },
  });
  if (!claim) return;
  const owner = claim.contractor.members[0]?.user;
  if (!owner?.email || !owner.emailVerified) return;

  const shortId = p.buildRequestId.slice(0, 8);
  const cli = client();
  if (!cli) {
    console.log(`[resend stub] claim ${p.claimId} REJECTED → ${owner.email}`);
    return;
  }
  await cli.emails.send({
    from: FROM,
    to: owner.email,
    subject: `[Poolwatt] Homeowner chose another contractor for request #${shortId}`,
    html: `
      <p>Hi ${owner.username},</p>
      <p>The homeowner chose another contractor for build request <b>#${shortId}</b>.</p>
      <p>You'll see new matching requests as they come in.</p>
    `,
  });
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run test`
Expected: tsc clean; all unit/integration tests pass (actions still mock this module).

- [ ] **Step 3: Commit**

```bash
git add src/lib/resend-match.ts
git commit -m "feat(matching): add real Resend email helpers"
```

---

## Task 7: i18n EN/RU/SK

**Files:**
- Modify: `messages/en.json`, `messages/ru.json`, `messages/sk.json`

- [ ] **Step 1: Add EN keys**

Read each file first; MERGE non-destructively.

Add to existing `cabinet.contractor.sidebar`:
```json
"requests": "Available requests"
```

Add new block under `cabinet.contractor`:
```json
"requests": {
  "title": "Available build requests",
  "subtitle": "Open requests matching your country and renewable types.",
  "empty": "No matching open requests right now.",
  "expressInterest": "Express interest",
  "message": {
    "label": "Optional message to the homeowner",
    "placeholder": "Why you'd be a great fit for this project (10–500 characters, optional)"
  },
  "submit": "Send",
  "submitting": "Sending…",
  "withdraw": "Withdraw",
  "youExpressedInterest": "You expressed interest. Status: PENDING"
}
```

Add new block under `cabinet.buildRequest`:
```json
"claims": {
  "title": "Interested contractors ({count})",
  "empty": "No contractors have expressed interest yet.",
  "accept": "Accept this contractor",
  "confirmAccept": "Accept this contractor? Other interested contractors will be auto-rejected and this build request will move to MATCHED."
},
"matched": {
  "title": "Your matched contractor",
  "rejectedSiblings": "Other contractors (not selected)"
}
```

Add new block under `admin.buildRequest`:
```json
"claims": {
  "title": "Claims audit"
}
```

- [ ] **Step 2: Translate to RU (`messages/ru.json`)**

Mirror structure with these values:
- `cabinet.contractor.sidebar.requests` → `"Доступные заявки"`
- `cabinet.contractor.requests.title` → `"Доступные заявки на строительство"`
- `cabinet.contractor.requests.subtitle` → `"Открытые заявки, подходящие по стране и типу источника."`
- `cabinet.contractor.requests.empty` → `"Подходящих открытых заявок сейчас нет."`
- `cabinet.contractor.requests.expressInterest` → `"Выразить интерес"`
- `cabinet.contractor.requests.message.label` → `"Сообщение для заказчика (необязательно)"`
- `cabinet.contractor.requests.message.placeholder` → `"Почему вы подходите для этого проекта (10–500 знаков, необязательно)"`
- `cabinet.contractor.requests.submit` → `"Отправить"`
- `cabinet.contractor.requests.submitting` → `"Отправляем…"`
- `cabinet.contractor.requests.withdraw` → `"Отозвать"`
- `cabinet.contractor.requests.youExpressedInterest` → `"Вы выразили интерес. Статус: PENDING"`
- `cabinet.buildRequest.claims.title` → `"Заинтересованные подрядчики ({count})"`
- `cabinet.buildRequest.claims.empty` → `"Подрядчики пока не выражали интерес."`
- `cabinet.buildRequest.claims.accept` → `"Выбрать этого подрядчика"`
- `cabinet.buildRequest.claims.confirmAccept` → `"Выбрать этого подрядчика? Остальные заинтересованные будут автоматически отклонены, а заявка перейдёт в статус MATCHED."`
- `cabinet.buildRequest.matched.title` → `"Выбранный подрядчик"`
- `cabinet.buildRequest.matched.rejectedSiblings` → `"Остальные подрядчики (не выбраны)"`
- `admin.buildRequest.claims.title` → `"Аудит заявок"`

- [ ] **Step 3: Translate to SK (`messages/sk.json`)**

- `cabinet.contractor.sidebar.requests` → `"Dostupné žiadosti"`
- `cabinet.contractor.requests.title` → `"Dostupné žiadosti o výstavbu"`
- `cabinet.contractor.requests.subtitle` → `"Otvorené žiadosti vyhovujúce vašej krajine a typom OZE."`
- `cabinet.contractor.requests.empty` → `"Momentálne nie sú žiadne vyhovujúce otvorené žiadosti."`
- `cabinet.contractor.requests.expressInterest` → `"Prejaviť záujem"`
- `cabinet.contractor.requests.message.label` → `"Voliteľná správa pre zákazníka"`
- `cabinet.contractor.requests.message.placeholder` → `"Prečo by ste boli skvelý kandidát (10–500 znakov, voliteľné)"`
- `cabinet.contractor.requests.submit` → `"Odoslať"`
- `cabinet.contractor.requests.submitting` → `"Odosielam…"`
- `cabinet.contractor.requests.withdraw` → `"Stiahnuť"`
- `cabinet.contractor.requests.youExpressedInterest` → `"Prejavili ste záujem. Stav: PENDING"`
- `cabinet.buildRequest.claims.title` → `"Záujemcovia ({count})"`
- `cabinet.buildRequest.claims.empty` → `"Zatiaľ nikto neprejavil záujem."`
- `cabinet.buildRequest.claims.accept` → `"Vybrať tohto dodávateľa"`
- `cabinet.buildRequest.claims.confirmAccept` → `"Vybrať tohto dodávateľa? Ostatní záujemcovia budú automaticky zamietnutí a žiadosť prejde do stavu MATCHED."`
- `cabinet.buildRequest.matched.title` → `"Vybraný dodávateľ"`
- `cabinet.buildRequest.matched.rejectedSiblings` → `"Ostatní dodávatelia (nevybraní)"`
- `admin.buildRequest.claims.title` → `"Audit záujmov"`

- [ ] **Step 4: Verify JSON parses**

Run: `node -e "['en','ru','sk'].forEach(l => JSON.parse(require('fs').readFileSync('messages/'+l+'.json','utf-8')))"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add messages/en.json messages/ru.json messages/sk.json
git commit -m "feat(matching): add EN/RU/SK i18n strings"
```

---

## Task 8: Contractor sidebar — Available requests link

**Files:**
- Modify: `src/app/[locale]/me/contractor/[id]/page.tsx`

The current `/me/contractor/[id]` is a single page with no internal sub-navigation. The requests link goes in the main detail content as a prominent CTA if the contractor is APPROVED.

- [ ] **Step 1: Add link**

Open `src/app/[locale]/me/contractor/[id]/page.tsx`. Near the top of the JSX render (just under the heading and status pill), if `c.status === "APPROVED"`, render a link:

Find the `<div className="flex items-center gap-4 mb-8">` block. Right BEFORE the closing `</div>` of that block (or just AFTER it), insert:

```tsx
{c.status === "APPROVED" && (
  <Link
    href={`/${locale}/me/contractor/${id}/requests`}
    className="text-sm font-semibold text-accent hover:underline"
  >
    {t("sidebar.requests")} →
  </Link>
)}
```

The `t` instance is already `getTranslations("cabinet.contractor")` so `t("sidebar.requests")` resolves to the new key (`"Available requests"` in EN).

`Link` should already be imported; if not, add `import Link from "next/link";`.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/me/contractor/[id]/page.tsx
git commit -m "feat(matching): add Available requests link in contractor detail"
```

---

## Task 9: Contractor feed page + client express-interest form

**Files:**
- Create: `src/components/matching/express-interest-form.tsx`
- Create: `src/components/matching/withdraw-claim-button.tsx`
- Create: `src/app/[locale]/me/contractor/[id]/requests/page.tsx`

- [ ] **Step 1: Express-interest client form**

Create `src/components/matching/express-interest-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { expressInterest } from "@/app/[locale]/me/contractor/[id]/requests/actions";

type Props = {
  buildRequestId: string;
  contractorId: string;
  labels: {
    expressInterest: string;
    messageLabel: string;
    messagePlaceholder: string;
    submit: string;
    submitting: string;
  };
};

export function ExpressInterestForm({ buildRequestId, contractorId, labels }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 bg-foreground text-bg rounded text-sm"
      >
        {labels.expressInterest}
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await expressInterest({ buildRequestId, contractorId, message: message || undefined });
          if (!r.ok) {
            setError(r.formError ?? r.fieldErrors?.message ?? "Failed");
          } else {
            router.refresh();
          }
        });
      }}
      className="border border-hairline rounded p-3 space-y-2"
    >
      <label className="block text-xs text-muted">{labels.messageLabel}</label>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        maxLength={500}
        placeholder={labels.messagePlaceholder}
        className="border border-hairline rounded px-2 py-1 w-full text-sm"
      />
      {error && <p className="text-red-600 text-xs">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="px-3 py-1 bg-foreground text-bg rounded text-sm disabled:opacity-50">
          {pending ? labels.submitting : labels.submit}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-3 py-1 border border-hairline rounded text-sm">
          ×
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Withdraw-claim client button**

Create `src/components/matching/withdraw-claim-button.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { withdrawClaim } from "@/app/[locale]/me/contractor/[id]/requests/actions";

type Props = {
  claimId: string;
  contractorId: string;
  label: string;
};

export function WithdrawClaimButton({ claimId, contractorId, label }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const r = await withdrawClaim({ claimId, contractorId });
          if (r.ok) router.refresh();
          else alert(r.formError ?? "Failed");
        });
      }}
      className="px-3 py-1 border border-hairline rounded text-sm disabled:opacity-50"
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 3: Feed page**

Create `src/app/[locale]/me/contractor/[id]/requests/page.tsx`:

```tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ExpressInterestForm } from "@/components/matching/express-interest-form";
import { WithdrawClaimButton } from "@/components/matching/withdraw-claim-button";

export default async function ContractorRequestsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/contractor/${id}/requests`);

  // Must be OWNER of an APPROVED contractor
  const contractor = await prisma.contractor.findUnique({
    where: { id },
    select: {
      id: true, status: true, displayName: true,
      countriesServed: true, renewableTypes: true,
      members: {
        where: { userId: session.user.id, role: "OWNER" },
        select: { userId: true },
      },
      claims: {
        where: { status: "PENDING" },
        select: { id: true, buildRequestId: true },
      },
    },
  });
  if (!contractor || contractor.members.length === 0) notFound();
  if (contractor.status !== "APPROVED") {
    return (
      <main className="bg-bg min-h-[calc(100vh-4rem)]">
        <div className="max-w-3xl mx-auto px-4 md:px-12 py-12">
          <Link href={`/${locale}/me/contractor/${id}`} className="text-sm text-muted">← Back</Link>
          <h1 className="text-[28px] font-bold mt-4 mb-4">Available requests</h1>
          <p className="text-muted">Your contractor profile must be APPROVED before you can express interest in build requests.</p>
        </div>
      </main>
    );
  }

  const t = await getTranslations("cabinet.contractor.requests");
  const tField = await getTranslations("cabinet.buildRequest.field");

  // Fetch matching OPEN requests not yet claimed by this contractor
  const claimedBrIds = new Set(contractor.claims.map((c) => c.buildRequestId));
  const requests = await prisma.buildRequest.findMany({
    where: {
      status: "OPEN",
      country: { in: contractor.countriesServed },
      source: { in: contractor.renewableTypes as ("SOLAR" | "WIND" | "HYBRID")[] },
      id: { notIn: Array.from(claimedBrIds) },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true, source: true, peakKw: true, city: true, country: true, siteType: true,
      roofOrientation: true, budget: true, timeline: true, notes: true, createdAt: true,
      wantPowerbank: true, wantEvCharger: true,
    },
  });

  // Also fetch the contractor's existing PENDING claims to surface them
  const myPendingClaims = await prisma.buildRequestClaim.findMany({
    where: { contractorId: id, status: "PENDING" },
    select: {
      id: true,
      message: true,
      createdAt: true,
      buildRequest: {
        select: {
          id: true, source: true, peakKw: true, city: true, country: true, siteType: true, createdAt: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="bg-bg min-h-[calc(100vh-4rem)]">
      <div className="max-w-3xl mx-auto px-4 md:px-12 py-12">
        <Link href={`/${locale}/me/contractor/${id}`} className="text-sm text-muted">← {contractor.displayName}</Link>
        <h1 className="text-[28px] md:text-[32px] font-bold tracking-[-0.02em] mt-4">{t("title")}</h1>
        <p className="text-muted mt-2">{t("subtitle")}</p>

        {myPendingClaims.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm uppercase tracking-wider text-muted mb-3">
              {t("youExpressedInterest")} ({myPendingClaims.length})
            </h2>
            <ul className="space-y-3">
              {myPendingClaims.map((c) => (
                <li key={c.id} className="border border-hairline rounded p-4 text-sm bg-card/50">
                  <div className="flex justify-between items-start">
                    <div>
                      <b>{tField(`source.${c.buildRequest.source}`)} · {c.buildRequest.peakKw.toString()} kW</b><br />
                      {c.buildRequest.city}, {c.buildRequest.country} · {tField(`siteType.${c.buildRequest.siteType}`)}
                    </div>
                    <WithdrawClaimButton claimId={c.id} contractorId={id} label={t("withdraw")} />
                  </div>
                  {c.message && <p className="text-muted text-xs mt-2 whitespace-pre-wrap">"{c.message}"</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-10">
          {requests.length === 0 ? (
            <p className="text-muted">{t("empty")}</p>
          ) : (
            <ul className="space-y-4">
              {requests.map((r) => (
                <li key={r.id} className="border border-hairline rounded-lg p-5">
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1">
                      <div className="font-medium">
                        {tField(`source.${r.source}`)} · <span className="num">{r.peakKw.toString()}</span> kW
                      </div>
                      <div className="text-sm text-muted mt-1">
                        {r.city}, {r.country} · {tField(`siteType.${r.siteType}`)}
                        {r.roofOrientation && ` · roof ${r.roofOrientation}`}
                      </div>
                      <div className="text-sm text-muted mt-1">
                        {tField(`budget.${r.budget}`)} · {tField(`timeline.${r.timeline}`)}
                      </div>
                      {(r.wantPowerbank || r.wantEvCharger) && (
                        <div className="flex gap-2 mt-2">
                          {r.wantPowerbank && <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-foreground/5 text-muted">+ powerbank</span>}
                          {r.wantEvCharger && <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-foreground/5 text-muted">+ EV charger</span>}
                        </div>
                      )}
                      {r.notes && <p className="text-xs text-muted mt-3 whitespace-pre-wrap">{r.notes}</p>}
                    </div>
                    <ExpressInterestForm
                      buildRequestId={r.id}
                      contractorId={id}
                      labels={{
                        expressInterest: t("expressInterest"),
                        messageLabel: t("message.label"),
                        messagePlaceholder: t("message.placeholder"),
                        submit: t("submit"),
                        submitting: t("submitting"),
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/matching/express-interest-form.tsx \
  src/components/matching/withdraw-claim-button.tsx \
  src/app/[locale]/me/contractor/[id]/requests/page.tsx
git commit -m "feat(matching): add contractor feed page with express-interest + withdraw"
```

---

## Task 10: Homeowner BR detail extension — claims section + AcceptClaimButton

**Files:**
- Create: `src/components/matching/accept-claim-button.tsx`
- Modify: `src/app/[locale]/me/build-requests/[id]/page.tsx`

- [ ] **Step 1: Accept-claim client button**

Create `src/components/matching/accept-claim-button.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptClaim } from "@/app/[locale]/me/build-requests/actions";

type Props = {
  claimId: string;
  label: string;
  confirmText: string;
};

export function AcceptClaimButton({ claimId, label, confirmText }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm(confirmText)) return;
        startTransition(async () => {
          const r = await acceptClaim(claimId);
          if (r.ok) router.refresh();
          else alert(r.formError ?? "Failed");
        });
      }}
      className="px-4 py-2 bg-foreground text-bg rounded text-sm disabled:opacity-50"
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 2: Extend BR detail page with claims sections**

In `src/app/[locale]/me/build-requests/[id]/page.tsx`:

1. Add imports near the top:

```tsx
import { AcceptClaimButton } from "@/components/matching/accept-claim-button";
```

2. Replace the existing `prisma.buildRequest.findUnique` call to include claims with their contractor profile. Find the existing `const r = await prisma.buildRequest.findUnique({ where: { id } });` and replace with:

```tsx
const r = await prisma.buildRequest.findUnique({
  where: { id },
  include: {
    claims: {
      orderBy: { createdAt: "desc" },
      include: {
        contractor: {
          select: {
            id: true, slug: true, displayName: true, city: true, country: true,
            entityType: true, foundedYear: true, bio: true,
            // Full contact fields, but we'll render them conditionally based on status
            contactEmail: true, contactPhone: true, websiteUrl: true, logoUrl: true,
          },
        },
      },
    },
  },
});
```

3. Right BEFORE the existing `<dl>` block, add the claims sections. Use these:

```tsx
{(() => {
  const pending = r.claims.filter((c) => c.status === "PENDING");
  const accepted = r.claims.find((c) => c.status === "ACCEPTED");
  const rejected = r.claims.filter((c) => c.status === "REJECTED");

  return (
    <>
      {accepted && (
        <section className="mb-8 border border-hairline rounded-lg p-5 bg-green-50 dark:bg-green-950/20">
          <h2 className="text-sm uppercase tracking-wider text-muted mb-3">
            ✓ {t("matched.title")}
          </h2>
          <div className="flex items-start gap-3">
            {accepted.contractor.logoUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={accepted.contractor.logoUrl} alt={`${accepted.contractor.displayName} logo`} className="w-14 h-14 rounded object-cover border border-hairline" />
            ) : (
              <div className="w-14 h-14 rounded bg-foreground/10 flex items-center justify-center font-bold text-xl text-muted">
                {accepted.contractor.displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1">
              <p className="font-semibold text-[15px]">{accepted.contractor.displayName}</p>
              <p className="text-xs text-muted">{accepted.contractor.city}, {accepted.contractor.country}</p>
              <dl className="grid grid-cols-[100px_1fr] gap-y-1 text-sm mt-3">
                <dt className="text-muted">Email</dt><dd><a href={`mailto:${accepted.contractor.contactEmail}`} className="text-accent underline">{accepted.contractor.contactEmail}</a></dd>
                <dt className="text-muted">Phone</dt><dd><a href={`tel:${accepted.contractor.contactPhone}`} className="text-accent underline">{accepted.contractor.contactPhone}</a></dd>
                {accepted.contractor.websiteUrl && (<><dt className="text-muted">Web</dt><dd><a href={accepted.contractor.websiteUrl} target="_blank" rel="noreferrer" className="text-accent underline">{accepted.contractor.websiteUrl}</a></dd></>)}
              </dl>
            </div>
          </div>
        </section>
      )}

      {pending.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm uppercase tracking-wider text-muted mb-3">
            {t("claims.title", { count: pending.length })}
          </h2>
          <ul className="space-y-3">
            {pending.map((c) => (
              <li key={c.id} className="border border-hairline rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <p className="font-semibold">{c.contractor.displayName}</p>
                    <p className="text-xs text-muted">{c.contractor.city}, {c.contractor.country}{c.contractor.foundedYear ? ` · since ${c.contractor.foundedYear}` : ""}</p>
                    {c.message && <p className="text-sm mt-2 whitespace-pre-wrap">"{c.message}"</p>}
                    <p className="text-xs text-muted mt-2 line-clamp-3">{c.contractor.bio.slice(0, 300)}</p>
                  </div>
                  <AcceptClaimButton
                    claimId={c.id}
                    label={t("claims.accept")}
                    confirmText={t("claims.confirmAccept")}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {accepted && rejected.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm uppercase tracking-wider text-muted mb-3">
            {t("matched.rejectedSiblings")} ({rejected.length})
          </h2>
          <ul className="space-y-2">
            {rejected.map((c) => (
              <li key={c.id} className="text-sm text-muted">
                · {c.contractor.displayName} — {c.contractor.city}, {c.contractor.country}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
})()}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/matching/accept-claim-button.tsx \
  src/app/[locale]/me/build-requests/[id]/page.tsx
git commit -m "feat(matching): render claims sections on homeowner BR detail"
```

---

## Task 11: Admin BR detail — claims audit section

**Files:**
- Modify: `src/app/[locale]/admin/build-requests/[id]/page.tsx`

- [ ] **Step 1: Extend the page query**

In `src/app/[locale]/admin/build-requests/[id]/page.tsx`, find the existing prisma call (likely `prisma.buildRequest.findUnique({ where: { id } })`). Add a `claims` include:

```tsx
const r = await prisma.buildRequest.findUnique({
  where: { id },
  include: {
    claims: {
      orderBy: { createdAt: "asc" },
      include: {
        contractor: { select: { id: true, slug: true, displayName: true, country: true } },
      },
    },
  },
});
```

- [ ] **Step 2: Render claims audit section**

Add the following section near the end of the page (before the existing status-change form or wherever you decide it fits):

```tsx
{r.claims.length > 0 && (
  <section className="border border-hairline rounded p-4">
    <h2 className="text-sm uppercase tracking-wide text-muted mb-2">Claims audit</h2>
    <table className="w-full text-xs">
      <thead>
        <tr className="text-muted border-b border-hairline">
          <th className="py-1 text-left">Created</th>
          <th className="text-left">Contractor</th>
          <th className="text-left">Status</th>
          <th className="text-left">Responded</th>
          <th className="text-left">Message</th>
        </tr>
      </thead>
      <tbody>
        {r.claims.map((c) => (
          <tr key={c.id} className="border-b border-hairline">
            <td className="py-1">{c.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
            <td>{c.contractor.displayName} ({c.contractor.country})</td>
            <td>{c.status}</td>
            <td>{c.respondedAt ? c.respondedAt.toISOString().slice(0, 16).replace("T", " ") : "—"}</td>
            <td className="whitespace-pre-wrap max-w-md">{c.message ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </section>
)}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/admin/build-requests/[id]/page.tsx
git commit -m "feat(matching): add claims audit section on admin BR detail"
```

---

## Task 12: Playwright e2e — matching flow

**Files:**
- Create: `tests/e2e/matching-flow.spec.ts`

Pre-flight: orchestrator rebuilds + restarts `poolwatt-web` BEFORE running e2e.

- [ ] **Step 1: Write spec**

```ts
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const PREFIX = "e2e_match_";

const HOMEOWNER = { username: `${PREFIX}homeowner`, password: "Pass1234" };
const CONTRACTOR_USER = { username: `${PREFIX}ctr_owner`, password: "Pass1234" };

let buildRequestId: string;
let contractorId: string;

test.beforeAll(async () => {
  // Seed homeowner with name/phone (so they can submit a BR)
  const ho = await prisma.user.upsert({
    where: { username: HOMEOWNER.username },
    update: { passwordHash: await bcrypt.hash(HOMEOWNER.password, 10), name: "E2E Homeowner", phone: "+421900111111" },
    create: { username: HOMEOWNER.username, passwordHash: await bcrypt.hash(HOMEOWNER.password, 10), name: "E2E Homeowner", phone: "+421900111111" },
  });

  // Seed contractor user
  const ctrUser = await prisma.user.upsert({
    where: { username: CONTRACTOR_USER.username },
    update: { passwordHash: await bcrypt.hash(CONTRACTOR_USER.password, 10) },
    create: { username: CONTRACTOR_USER.username, passwordHash: await bcrypt.hash(CONTRACTOR_USER.password, 10) },
  });

  // Clean prior runs
  await prisma.buildRequestClaim.deleteMany({});
  await prisma.buildRequest.deleteMany({ where: { user: { username: HOMEOWNER.username } } });
  await prisma.contractor.deleteMany({ where: { slug: { startsWith: PREFIX } } });

  // Seed APPROVED contractor with SK + SOLAR coverage
  const ctr = await prisma.contractor.create({
    data: {
      slug: `${PREFIX}solarco`,
      entityType: "LEGAL_ENTITY",
      displayName: "MatchCo Solar s.r.o.",
      legalName: "MatchCo Solar Renewable s.r.o.",
      registrationNumber: "55667788",
      country: "SK", city: "Bratislava",
      workCategories: ["DESIGN", "INSTALLATION"],
      renewableTypes: ["SOLAR"],
      countriesServed: ["SK"],
      bio: "We design and install rooftop solar systems for residential and commercial clients across Slovakia.",
      contactEmail: "info@matchco-solar.test",
      contactPhone: "+421900222222",
      status: "APPROVED",
      members: { create: { userId: ctrUser.id, role: "OWNER" } },
    },
  });
  contractorId = ctr.id;

  // Seed an OPEN BuildRequest from homeowner
  const br = await prisma.buildRequest.create({
    data: {
      userId: ho.id,
      source: "SOLAR", peakKw: 10,
      country: "SK", city: "Bratislava", addressLine: "Hlavná 99",
      siteType: "PRIVATE_HOUSE", roofOrientation: "S",
      budget: "FROM_15K_TO_30K", timeline: "URGENT_1_3M",
      status: "OPEN",
    },
  });
  buildRequestId = br.id;
});

test.afterAll(async () => {
  await prisma.buildRequestClaim.deleteMany({});
  await prisma.buildRequest.deleteMany({ where: { user: { username: HOMEOWNER.username } } });
  await prisma.contractor.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

test("contractor expresses interest → homeowner accepts → both see contacts", async ({ page }) => {
  // Login as contractor
  await page.goto("/en/login");
  await page.fill('input[name="username"]', CONTRACTOR_USER.username);
  await page.fill('input[name="password"]', CONTRACTOR_USER.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/en\/me(\/|$)/);

  // Visit contractor's requests feed
  await page.goto(`/en/me/contractor/${contractorId}/requests`);
  await expect(page.locator("text=Available build requests")).toBeVisible();
  await expect(page.locator("text=Solar").first()).toBeVisible();
  await expect(page.locator("text=10").first()).toBeVisible();  // peakKw

  // Click Express interest, fill message, submit
  await page.locator('button:has-text("Express interest")').first().click();
  await page.fill('textarea', "We can deliver in 6 weeks with full turnkey.");
  await page.click('button:has-text("Send")');
  await expect(page.locator("text=You expressed interest")).toBeVisible();

  // Switch to homeowner via clearCookies
  await page.context().clearCookies();
  await page.goto("/en/login");
  await page.fill('input[name="username"]', HOMEOWNER.username);
  await page.fill('input[name="password"]', HOMEOWNER.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/en\/me(\/|$)/);

  // Visit BR detail
  await page.goto(`/en/me/build-requests/${buildRequestId}`);
  await expect(page.locator("text=Interested contractors")).toBeVisible();
  await expect(page.locator("text=MatchCo Solar s.r.o.")).toBeVisible();
  await expect(page.locator("text=We can deliver in 6 weeks")).toBeVisible();

  // Accept (handle confirm dialog)
  page.once("dialog", (d) => d.accept());
  await page.click('button:has-text("Accept this contractor")');

  // After accept: matched section visible with full contractor contact
  await expect(page.locator("text=Your matched contractor")).toBeVisible();
  await expect(page.locator("text=info@matchco-solar.test")).toBeVisible();
  await expect(page.locator("text=+421900222222")).toBeVisible();
});
```

- [ ] **Step 2: Run**

```bash
set -a && source .env.local && set +a && npx playwright test matching-flow 2>&1 | tail -25
```
Expected: 1 passed.

If a selector is ambiguous, use `.first()` or more specific locators. If genuinely broken, inspect rendered HTML.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/matching-flow.spec.ts
git commit -m "test(matching): add e2e — express-interest → accept → contact reveal"
```

---

## Task 13: README roadmap entry

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the line**

Right after the V2b / EV extension entries in the roadmap:

```markdown
  - [x] **BuildRequest ↔ Contractor matching (V2d)** — contractors express interest in open requests at `/me/contractor/[id]/requests`; homeowners pick one from their BR detail page, triggering full mutual contact reveal. See `docs/superpowers/specs/2026-05-30-build-request-matching-v2d-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(matching): add V2d roadmap entry"
```

---

## Done criteria

- All 13 tasks committed.
- `npm run lint` clean (no NEW errors).
- `npm run test` green (V2d unit + integration).
- `npx playwright test matching-flow` green.
- Manual smoke: as APPROVED-contractor OWNER, visit `/me/contractor/[id]/requests`, see at least one matching BR, click Express interest, fill message, send. As that BR's homeowner, visit `/me/build-requests/[id]`, see the interested contractor card, click Accept, see "Your matched contractor" with full contact info.

## Deferred to future plans

- Bidding (price + timeline in the claim) — V2d-2
- In-app messaging between matched parties
- Auto-suggested contractors on homeowner page before any claim
- Multi-contractor per request
- Re-opening WITHDRAWN claims
- Workload caps for contractors (max active PENDING)
- Push notifications to contractors when new matching BR appears
- Reviews after FULFILLED
