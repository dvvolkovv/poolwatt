# R4 — Producer BR Feed in Cabinet (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A producer (a claimed company card — JinkoSolar, Tesla Energy, CATL, etc.) sees open BuildRequests from homeowners in their country and source area, can express interest, and the homeowner can accept — at which point both sides see each other's contact details. End-to-end mirror of the existing contractor matching flow, but using a parallel `ProducerBuildRequestClaim` table so the existing contractor flow is untouched.

**Architecture:** New parallel `ProducerBuildRequestClaim` model alongside the existing `BuildRequestClaim`, with the same shape but `producerId` FK instead of `contractorId`. Three new server actions (`expressProducerInterest`, `withdrawProducerClaim`, `acceptProducerClaim`) mirror the contractor ones. New `/me/producer/[id]/requests` page mirrors the contractor feed. Homeowner's BR detail page is extended to show producer claims alongside contractor claims (additive — no refactor of contractor display). New `resend-producer-match.ts` email helper mirrors `resend-match.ts`.

**Tech Stack:** Prisma 5 (PostgreSQL), Next.js 16 App Router, Resend, Vitest (real-DB integration tests for actions, mocked auth + email).

**Spec reference:** `docs/superpowers/specs/2026-05-31-claim-your-card-design.md` § "BuildRequestClaim — polymorphic" + § "Cabinets > /me/producer/[id]" Tab 3.

---

## Deviation from spec

The spec specifies a polymorphic `BuildRequestClaim` (drop `contractorId`, add `providerType + providerId`) with a 4-step migration. This plan **does not do that**. Instead it introduces a parallel `ProducerBuildRequestClaim` table.

**Why:**
- The contractor flow already works in production (V2d) and has e2e tests. A polymorphic refactor touches ~7 files of well-tested code with zero user-visible benefit.
- The parallel-table approach is purely additive: contractor code stays untouched; producer code is greenfield.
- The polymorphic clean-up can happen as a separate dedicated migration release later, when the cost is more justified (e.g. when ChargerOperator R5 also wants to participate, making three parallel tables ugly).

**Trade-off accepted:** querying "all responses for this BR" requires a UNION of two tables (or two separate queries). For V1 scale (handful of BRs, handful of responses each), this is fine.

---

## Builds on / out of scope

**Builds on:**
- R1 (Producer schema)
- R3a (`Producer.claimedById`)
- R3b (claim flow — producer cards have owners)
- R3c (producer cabinet exists)
- V2d (contractor matching — pattern source)

**Out of R4 (later):**
- Polymorphic refactor of `BuildRequestClaim` — separate release
- ChargerOperator participation in BR matching — R5+
- Admin BR detail showing producer claims — optional later (admin can read DB directly for V1)
- "Reject" action by homeowner (just like contractor flow, REJECTED status is only set via cascade when a different provider is accepted)
- Producer feed filters / sorting UI — V1 just sorts by createdAt desc

---

## What success looks like (manual smoke after R4)

1. Real company (claimed JinkoSolar) logs in, opens `/me/producer`.
2. Clicks on JinkoSolar → cabinet detail page.
3. Sees a new link "**Available requests**" → `/me/producer/[id]/requests`.
4. Feed shows OPEN BuildRequests whose `country == producer.country` AND `source ∈ matching(producer.primarySource)`.
5. Click "Express interest" on a BR → form opens → optional message → submit.
6. Homeowner gets email notification.
7. Homeowner opens their BR detail page → sees both contractor and producer claims in distinct sections.
8. Homeowner clicks "Accept" on JinkoSolar's claim → JinkoSolar gets a notification with the homeowner's contact details; the BR closes.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `prisma/schema.prisma` | modify | Add `ProducerBuildRequestClaim` model with status enum reuse. |
| `prisma/migrations/<timestamp>_add_producer_br_claim/migration.sql` | create | Generated migration. |
| `src/app/[locale]/me/producer/[id]/requests/actions.ts` | create | `expressProducerInterest`, `withdrawProducerClaim`. |
| `src/app/[locale]/me/producer/[id]/requests/actions.test.ts` | create | DB-integration tests. |
| `src/lib/resend-producer-match.ts` | create | 3 email helpers mirroring resend-match.ts. |
| `src/app/[locale]/me/producer/[id]/requests/page.tsx` | create | Feed page. |
| `src/app/[locale]/me/producer/[id]/requests/express-form.tsx` | create | Client form for express-interest. |
| `src/app/[locale]/me/producer/[id]/requests/withdraw-button.tsx` | create | Client button for withdraw. |
| `src/app/[locale]/me/producer/[id]/page.tsx` | modify | Add "Available requests" link in header (when claimed by user). |
| `src/app/[locale]/me/build-requests/actions.ts` | modify | Add `acceptProducerClaim` action with cross-cancel logic. |
| `src/app/[locale]/me/build-requests/[id]/page.tsx` | modify | Show producer claims alongside contractor claims. |
| `src/app/[locale]/me/build-requests/[id]/accept-producer-claim-button.tsx` | create | Client button. |
| `messages/en.json` / `ru.json` / `sk.json` | modify | Add `cabinet.producer.requests.*` namespace. |

---

## Task 1: Schema migration — `ProducerBuildRequestClaim`

**Files:**
- Modify: `prisma/schema.prisma`
- Create (via Prisma CLI): `prisma/migrations/<timestamp>_add_producer_br_claim/migration.sql`

- [ ] **Step 1: Add the model**

In `prisma/schema.prisma`, find the existing `model BuildRequestClaim { ... }` block. Add this new model immediately AFTER it (groups related claim models together):

```prisma
// Producer-side mirror of BuildRequestClaim.
// Lives in a parallel table (rather than polymorphic on BuildRequestClaim) so the
// existing contractor flow is untouched. Status enum is shared (BuildRequestClaimStatus).
// Eventually both tables could be unified — deferred until ChargerOperator joins (R5+).
model ProducerBuildRequestClaim {
  id             String       @id @default(cuid())
  buildRequestId String
  buildRequest   BuildRequest @relation("ProducerClaimsOnBR", fields: [buildRequestId], references: [id], onDelete: Cascade)
  producerId     String
  producer       Producer     @relation("ProducerClaimsByProducer", fields: [producerId], references: [id], onDelete: Cascade)

  status  BuildRequestClaimStatus @default(PENDING)
  message String?                 @db.Text

  createdAt   DateTime  @default(now())
  respondedAt DateTime?

  @@unique([buildRequestId, producerId])
  @@index([buildRequestId, status])
  @@index([producerId, status])
}
```

- [ ] **Step 2: Add back-relations**

In `prisma/schema.prisma`, find `model BuildRequest { ... }`. Find the existing `claims BuildRequestClaim[]` line. Add a new back-relation line IMMEDIATELY AFTER it:

```prisma
  producerClaims     ProducerBuildRequestClaim[] @relation("ProducerClaimsOnBR")
```

Then find `model Producer { ... }`. Find any relations block (e.g., near `snapshots Snapshot[]` if present, or near the existing relations like `offers`, `contracts`). Add a new line:

```prisma
  producerClaims    ProducerBuildRequestClaim[] @relation("ProducerClaimsByProducer")
```

- [ ] **Step 3: Generate and apply the migration**

```bash
cd /home/dv/poolwatt && npx prisma migrate dev --name add_producer_br_claim
```

Expected:
- New migration directory `prisma/migrations/<timestamp>_add_producer_br_claim/`
- "Your database is now in sync with your schema."
- "Generated Prisma Client" message.

- [ ] **Step 4: Verify the client reflects the change**

```bash
node -e "const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient(); console.log({ has: !!p.producerBuildRequestClaim });"
```

Expected: `{ has: true }`.

- [ ] **Step 5: Confirm existing data intact**

```bash
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const total = await p.producer.count();
  const contractorClaims = await p.buildRequestClaim.count();
  const producerClaims = await p.producerBuildRequestClaim.count();
  console.log({ total, contractorClaims, producerClaims });
  await p.\$disconnect();
})();
"
```

Expected: `{ total: 100, contractorClaims: <unchanged>, producerClaims: 0 }`.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(claim-r4): add ProducerBuildRequestClaim model

Parallel to BuildRequestClaim: same shape, producerId FK instead of
contractorId. Shares the BuildRequestClaimStatus enum. Added back-
relations on BuildRequest (producerClaims) and Producer (producerClaims).

Deliberate deviation from spec's polymorphic approach — contractor
code stays untouched. Polymorphic refactor deferred to a separate
release."
```

---

## Task 2: Server actions — `expressProducerInterest` + `withdrawProducerClaim`

**Files:**
- Create: `src/app/[locale]/me/producer/[id]/requests/actions.ts`
- Test: `src/app/[locale]/me/producer/[id]/requests/actions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/[locale]/me/producer/[id]/requests/actions.test.ts`:

```ts
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/resend-producer-match", () => ({
  sendProducerInterestExpressedToOwner: vi.fn(async () => {}),
}));

let mockUserId: string | null = null;
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (mockUserId ? { user: { id: mockUserId } } : null)),
}));

import { expressProducerInterest, withdrawProducerClaim } from "./actions";
import { sendProducerInterestExpressedToOwner } from "@/lib/resend-producer-match";

const TEST_HANDLE = "test-r4-prod";
const OWNER_USERNAME = "test_r4_owner";
const OTHER_USERNAME = "test_r4_other";
const HOMEOWNER_USERNAME = "test_r4_homeowner";

let testProducerId: string;
let ownerUserId: string;
let otherUserId: string;
let homeownerUserId: string;
let testBuildRequestId: string;

async function cleanup() {
  await prisma.producerBuildRequestClaim.deleteMany({
    where: { producer: { handle: TEST_HANDLE } },
  });
  await prisma.buildRequest.deleteMany({
    where: { user: { username: HOMEOWNER_USERNAME } },
  });
  await prisma.producer.deleteMany({ where: { handle: TEST_HANDLE } });
  await prisma.user.deleteMany({
    where: { username: { in: [OWNER_USERNAME, OTHER_USERNAME, HOMEOWNER_USERNAME] } },
  });
}

beforeAll(async () => {
  await cleanup();
  ownerUserId = (await prisma.user.create({
    data: { username: OWNER_USERNAME, passwordHash: "x" },
  })).id;
  otherUserId = (await prisma.user.create({
    data: { username: OTHER_USERNAME, passwordHash: "x" },
  })).id;
  homeownerUserId = (await prisma.user.create({
    data: { username: HOMEOWNER_USERNAME, passwordHash: "x", name: "Homer", email: "h@example.com", phone: "+1" },
  })).id;
  testProducerId = (await prisma.producer.create({
    data: {
      slug: TEST_HANDLE, handle: TEST_HANDLE, displayName: "R4 Test Producer",
      country: "DE", primarySource: "SOLAR",
      capacityKwh: 100, inverterKw: 50, rank: 9994,
      claimedById: ownerUserId, claimedAt: new Date(),
    },
  })).id;
  testBuildRequestId = (await prisma.buildRequest.create({
    data: {
      userId: homeownerUserId,
      source: "SOLAR",
      peakKw: 10,
      city: "Berlin", country: "DE",
      addressLine: "Test 1",
      siteType: "ROOF_PITCHED",
      roofOrientation: "SOUTH",
      budget: "EUR_10_30K",
      timeline: "WITHIN_6_MONTHS",
      status: "OPEN",
    },
  })).id;
});

afterAll(cleanup);

beforeEach(async () => {
  mockUserId = ownerUserId;
  vi.mocked(sendProducerInterestExpressedToOwner).mockClear();
  await prisma.producerBuildRequestClaim.deleteMany({
    where: { producerId: testProducerId },
  });
});

describe("expressProducerInterest", () => {
  it("creates a PENDING claim when the owner submits", async () => {
    const r = await expressProducerInterest({
      buildRequestId: testBuildRequestId,
      producerId: testProducerId,
      message: "We can supply panels and inverters.",
    });
    expect(r.ok).toBe(true);
    expect(r.claimId).toBeDefined();

    const claims = await prisma.producerBuildRequestClaim.findMany({
      where: { producerId: testProducerId },
    });
    expect(claims).toHaveLength(1);
    expect(claims[0].status).toBe("PENDING");
    expect(claims[0].message).toBe("We can supply panels and inverters.");

    expect(sendProducerInterestExpressedToOwner).toHaveBeenCalledOnce();
  });

  it("rejects when caller is not the producer's claimedById owner", async () => {
    mockUserId = otherUserId;
    const r = await expressProducerInterest({
      buildRequestId: testBuildRequestId,
      producerId: testProducerId,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects when not logged in", async () => {
    mockUserId = null;
    const r = await expressProducerInterest({
      buildRequestId: testBuildRequestId,
      producerId: testProducerId,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects when build request is not OPEN", async () => {
    await prisma.buildRequest.update({
      where: { id: testBuildRequestId },
      data: { status: "WITHDRAWN" },
    });
    const r = await expressProducerInterest({
      buildRequestId: testBuildRequestId,
      producerId: testProducerId,
    });
    expect(r.ok).toBe(false);
    await prisma.buildRequest.update({
      where: { id: testBuildRequestId },
      data: { status: "OPEN" },
    });
  });

  it("rejects duplicate (same producer × same BR)", async () => {
    await expressProducerInterest({
      buildRequestId: testBuildRequestId,
      producerId: testProducerId,
    });
    const r = await expressProducerInterest({
      buildRequestId: testBuildRequestId,
      producerId: testProducerId,
    });
    expect(r.ok).toBe(false);
  });
});

describe("withdrawProducerClaim", () => {
  async function makeClaim(): Promise<string> {
    const r = await expressProducerInterest({
      buildRequestId: testBuildRequestId,
      producerId: testProducerId,
    });
    return r.claimId!;
  }

  it("marks claim WITHDRAWN when owner withdraws", async () => {
    const claimId = await makeClaim();
    const r = await withdrawProducerClaim({ claimId, producerId: testProducerId });
    expect(r.ok).toBe(true);
    const after = await prisma.producerBuildRequestClaim.findUnique({ where: { id: claimId } });
    expect(after?.status).toBe("WITHDRAWN");
    expect(after?.respondedAt).not.toBeNull();
  });

  it("rejects when caller is not the producer owner", async () => {
    const claimId = await makeClaim();
    mockUserId = otherUserId;
    const r = await withdrawProducerClaim({ claimId, producerId: testProducerId });
    expect(r.ok).toBe(false);
  });

  it("rejects when claim is not PENDING (already accepted)", async () => {
    const claimId = await makeClaim();
    await prisma.producerBuildRequestClaim.update({
      where: { id: claimId },
      data: { status: "ACCEPTED", respondedAt: new Date() },
    });
    const r = await withdrawProducerClaim({ claimId, producerId: testProducerId });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run and verify fail**

```bash
cd /home/dv/poolwatt && npm test -- src/app/\[locale\]/me/producer/\[id\]/requests/actions.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the actions**

Create `src/app/[locale]/me/producer/[id]/requests/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type ActionResult = {
  ok: boolean;
  claimId?: string;
  fieldErrors?: Record<string, string>;
  formError?: string;
};

async function assertProducerOwner(producerId: string): Promise<
  | { ok: true; userId: string; producer: { displayName: string } }
  | { ok: false; result: ActionResult }
> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, result: { ok: false, formError: "Not authenticated" } };
  }
  const producer = await prisma.producer.findUnique({
    where: { id: producerId },
    select: { claimedById: true, displayName: true },
  });
  if (!producer || producer.claimedById !== session.user.id) {
    return { ok: false, result: { ok: false, formError: "Producer not found" } };
  }
  return { ok: true, userId: session.user.id, producer: { displayName: producer.displayName } };
}

export async function expressProducerInterest(input: {
  buildRequestId: string;
  producerId: string;
  message?: string;
}): Promise<ActionResult> {
  const owner = await assertProducerOwner(input.producerId);
  if (!owner.ok) return owner.result;

  const message = input.message?.trim() || null;
  if (message && message.length > 2000) {
    return { ok: false, fieldErrors: { message: "Too long (max 2000)" } };
  }

  const br = await prisma.buildRequest.findUnique({
    where: { id: input.buildRequestId },
    select: { id: true, status: true, userId: true },
  });
  if (!br) return { ok: false, formError: "Build request not found" };
  if (br.status !== "OPEN") return { ok: false, formError: "This build request is no longer open" };

  try {
    const created = await prisma.producerBuildRequestClaim.create({
      data: {
        buildRequestId: br.id,
        producerId: input.producerId,
        status: "PENDING",
        message,
      },
      select: { id: true },
    });

    try {
      const { sendProducerInterestExpressedToOwner } = await import("@/lib/resend-producer-match");
      await sendProducerInterestExpressedToOwner({
        claimId: created.id,
        buildRequestId: br.id,
        producerName: owner.producer.displayName,
        ownerUserId: br.userId,
      });
    } catch (err) {
      console.error("[r4] producer-interest notification failed:", err);
    }

    revalidatePath(`/[locale]/me/producer/${input.producerId}/requests`, "page");
    revalidatePath(`/[locale]/me/build-requests/${br.id}`, "page");
    return { ok: true, claimId: created.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Unique constraint") || msg.includes("P2002")) {
      return { ok: false, formError: "You have already expressed interest in this request" };
    }
    throw err;
  }
}

export async function withdrawProducerClaim(input: {
  claimId: string;
  producerId: string;
}): Promise<ActionResult> {
  const owner = await assertProducerOwner(input.producerId);
  if (!owner.ok) return owner.result;

  const claim = await prisma.producerBuildRequestClaim.findUnique({
    where: { id: input.claimId },
    select: { id: true, producerId: true, status: true, buildRequestId: true },
  });
  if (!claim || claim.producerId !== input.producerId) {
    return { ok: false, formError: "Claim not found" };
  }
  if (claim.status !== "PENDING") {
    return { ok: false, formError: "Claim can no longer be withdrawn" };
  }

  await prisma.producerBuildRequestClaim.update({
    where: { id: claim.id },
    data: { status: "WITHDRAWN", respondedAt: new Date() },
  });

  revalidatePath(`/[locale]/me/producer/${input.producerId}/requests`, "page");
  revalidatePath(`/[locale]/me/build-requests/${claim.buildRequestId}`, "page");
  return { ok: true, claimId: claim.id };
}
```

- [ ] **Step 4: Run tests and verify pass**

```bash
npm test -- src/app/\[locale\]/me/producer/\[id\]/requests/actions.test.ts
```

Expected: 8 tests pass (5 express + 3 withdraw).

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/\[locale\]/me/producer/\[id\]/requests/
git commit -m "feat(claim-r4): add expressProducerInterest + withdrawProducerClaim

Two server actions, both gated on producer.claimedById === session.user.id.
expressProducerInterest creates a PENDING ProducerBuildRequestClaim,
sends email notification to homeowner via resend-producer-match (mock
in tests). withdrawProducerClaim marks PENDING claim WITHDRAWN.

Mirrors the contractor-side expressInterest/withdrawClaim shape but
operates on the new ProducerBuildRequestClaim table."
```

---

## Task 3: Email helpers — `resend-producer-match.ts`

**Files:**
- Create: `src/lib/resend-producer-match.ts`

- [ ] **Step 1: Create the helper**

Create `src/lib/resend-producer-match.ts`:

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

export type ProducerInterestExpressedPayload = {
  claimId: string;
  buildRequestId: string;
  producerName: string;
  ownerUserId: string;
};

export async function sendProducerInterestExpressedToOwner(p: ProducerInterestExpressedPayload): Promise<void> {
  const owner = await prisma.user.findUnique({
    where: { id: p.ownerUserId },
    select: { email: true, emailVerified: true, username: true },
  });
  if (!owner?.email || !owner.emailVerified) return;

  const url = `${BASE}/en/me/build-requests/${p.buildRequestId}`;
  const shortId = p.buildRequestId.slice(0, 8);
  const c = client();
  if (!c) {
    console.log(`[resend stub] producer ${p.producerName} interested in BR ${shortId} → ${owner.email}: ${url}`);
    return;
  }
  await c.emails.send({
    from: FROM,
    to: owner.email,
    subject: `[Poolwatt] ${p.producerName} is interested in your build request #${shortId}`,
    html: `
      <p>Hi ${owner.username},</p>
      <p><b>${p.producerName}</b> (a verified producer) has expressed interest in your build request <b>#${shortId}</b>.</p>
      <p><a href="${url}">Review and accept</a></p>
    `,
  });
}

export type ProducerClaimAcceptedPayload = {
  claimId: string;
  buildRequestId: string;
  producerId: string;
};

export async function sendProducerClaimAcceptedToProducer(p: ProducerClaimAcceptedPayload): Promise<void> {
  const claim = await prisma.producerBuildRequestClaim.findUnique({
    where: { id: p.claimId },
    select: {
      producer: {
        select: {
          displayName: true,
          claimedBy: { select: { email: true, emailVerified: true, username: true } },
        },
      },
      buildRequest: {
        select: {
          user: { select: { name: true, phone: true, email: true } },
          city: true,
          country: true,
          addressLine: true,
          source: true,
          peakKw: true,
        },
      },
    },
  });
  if (!claim) return;
  const owner = claim.producer.claimedBy;
  if (!owner?.email || !owner.emailVerified) return;

  const shortId = p.buildRequestId.slice(0, 8);
  const url = `${BASE}/en/me/producer/${p.producerId}/requests`;
  const hw = claim.buildRequest.user;

  const cli = client();
  if (!cli) {
    console.log(`[resend stub] producer claim ${p.claimId} ACCEPTED — contact ${owner.email}`);
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
```

(Skipping the "rejected" variant for V1 — producers don't get notified when homeowner picks someone else. Can add later if needed.)

- [ ] **Step 2: Typecheck**

```bash
cd /home/dv/poolwatt && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/resend-producer-match.ts
git commit -m "feat(claim-r4): add resend-producer-match email helpers

Two helpers mirroring resend-match.ts:
- sendProducerInterestExpressedToOwner: notify homeowner that a
  producer expressed interest.
- sendProducerClaimAcceptedToProducer: notify producer that the
  homeowner accepted, including homeowner's contact details.

Resolves owner via Producer.claimedBy (the user who proved ownership
of the card during R3b)."
```

---

## Task 4: Producer feed page + express form + withdraw button

**Files:**
- Create: `src/app/[locale]/me/producer/[id]/requests/page.tsx`
- Create: `src/app/[locale]/me/producer/[id]/requests/express-form.tsx`
- Create: `src/app/[locale]/me/producer/[id]/requests/withdraw-button.tsx`

- [ ] **Step 1: Create the express form (client component)**

Create `src/app/[locale]/me/producer/[id]/requests/express-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { expressProducerInterest } from "./actions";

type Props = {
  producerId: string;
  buildRequestId: string;
  labels: { message: string; submit: string; submitting: string };
};

export function ExpressForm({ producerId, buildRequestId, labels }: Props) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await expressProducerInterest({ buildRequestId, producerId, message });
      if (r.ok) {
        router.refresh();
      } else {
        setError(r.formError ?? r.fieldErrors?.message ?? "Failed");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2 mt-3">
      <textarea
        rows={2}
        maxLength={2000}
        placeholder={labels.message}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        className="w-full px-3 py-2 rounded border border-hairline bg-card text-sm"
      />
      {error && <p className="text-xs text-down">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="px-3 py-1.5 rounded-full text-xs font-semibold bg-accent text-accent-foreground disabled:opacity-50"
      >
        {pending ? labels.submitting : labels.submit}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Create the withdraw button (client component)**

Create `src/app/[locale]/me/producer/[id]/requests/withdraw-button.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { withdrawProducerClaim } from "./actions";

type Props = {
  producerId: string;
  claimId: string;
  labels: { button: string; confirm: string };
};

export function WithdrawButton({ producerId, claimId, labels }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    if (!confirm(labels.confirm)) return;
    startTransition(async () => {
      const r = await withdrawProducerClaim({ claimId, producerId });
      if (r.ok) {
        router.refresh();
      } else {
        alert(r.formError ?? "Withdraw failed.");
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="text-xs text-down border border-down/40 rounded px-2 py-1 hover:bg-down/10 disabled:opacity-50"
    >
      {labels.button}
    </button>
  );
}
```

- [ ] **Step 3: Create the server page**

Create `src/app/[locale]/me/producer/[id]/requests/page.tsx`:

```tsx
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ExpressForm } from "./express-form";
import { WithdrawButton } from "./withdraw-button";

type Props = { params: Promise<{ locale: string; id: string }> };

// Map producer primarySource to matching BR sources. HYBRID matches all three.
function matchingBRSources(primarySource: string): ("SOLAR" | "WIND" | "HYBRID")[] {
  if (primarySource === "HYBRID") return ["SOLAR", "WIND", "HYBRID"];
  if (primarySource === "SOLAR") return ["SOLAR", "HYBRID"];
  if (primarySource === "WIND") return ["WIND", "HYBRID"];
  return [];
}

export default async function ProducerRequestsPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/producer/${id}/requests`);

  const producer = await prisma.producer.findUnique({
    where: { id },
    select: {
      id: true, claimedById: true, displayName: true, country: true, primarySource: true,
    },
  });
  if (!producer || producer.claimedById !== session.user.id) notFound();

  const t = await getTranslations("cabinet.producer.requests");

  const sources = matchingBRSources(producer.primarySource);

  const myClaims = await prisma.producerBuildRequestClaim.findMany({
    where: { producerId: producer.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, status: true, message: true, createdAt: true,
      buildRequest: {
        select: { id: true, source: true, peakKw: true, city: true, country: true, status: true },
      },
    },
  });

  const claimedBrIds = new Set(myClaims.map((c) => c.buildRequest.id));

  const openRequests = await prisma.buildRequest.findMany({
    where: {
      status: "OPEN",
      country: producer.country,
      source: { in: sources },
      id: { notIn: Array.from(claimedBrIds) },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true, source: true, peakKw: true, city: true, country: true,
      siteType: true, roofOrientation: true, budget: true, timeline: true,
      notes: true, createdAt: true,
    },
  });

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <Link href={`/${locale}/me/producer/${id}`} className="text-sm text-muted hover:text-foreground">← {t("back")}</Link>
        <h1 className="text-[28px] font-bold mt-2 mb-2">{t("title")}</h1>
        <p className="text-sm text-muted">{t("subtitle", { name: producer.displayName })}</p>
      </div>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">{t("openSection")}</h2>
        {openRequests.length === 0 ? (
          <p className="text-sm text-muted">{t("noOpen")}</p>
        ) : (
          <ul className="space-y-3">
            {openRequests.map((br) => (
              <li key={br.id} className="bg-card border border-hairline rounded-xl p-4">
                <div className="text-sm font-semibold">{br.source} · {br.peakKw.toString()} kW</div>
                <div className="text-xs text-muted mt-1">{br.city}, {br.country} · {br.siteType} · {br.budget} · {br.timeline}</div>
                {br.notes && <p className="text-xs text-muted-strong mt-2 line-clamp-2">{br.notes}</p>}
                <ExpressForm
                  producerId={producer.id}
                  buildRequestId={br.id}
                  labels={{ message: t("messagePlaceholder"), submit: t("expressSubmit"), submitting: t("expressSubmitting") }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">{t("myClaimsSection")}</h2>
        {myClaims.length === 0 ? (
          <p className="text-sm text-muted">{t("noClaims")}</p>
        ) : (
          <ul className="space-y-3">
            {myClaims.map((claim) => (
              <li key={claim.id} className="bg-card border border-hairline rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{claim.buildRequest.source} · {claim.buildRequest.peakKw.toString()} kW · {claim.buildRequest.city}, {claim.buildRequest.country}</div>
                    <div className="text-xs text-muted mt-1">
                      {t("status")}: <span className="font-semibold">{claim.status}</span>
                    </div>
                    {claim.message && <p className="text-xs text-muted-strong mt-2 italic">"{claim.message}"</p>}
                  </div>
                  {claim.status === "PENDING" && (
                    <WithdrawButton
                      producerId={producer.id}
                      claimId={claim.id}
                      labels={{ button: t("withdraw"), confirm: t("withdrawConfirm") }}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

```bash
cd /home/dv/poolwatt && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/\[locale\]/me/producer/\[id\]/requests/page.tsx src/app/\[locale\]/me/producer/\[id\]/requests/express-form.tsx src/app/\[locale\]/me/producer/\[id\]/requests/withdraw-button.tsx
git commit -m "feat(claim-r4): add producer feed page + express form + withdraw button

Page lists open BuildRequests matching the producer's country and
primarySource (HYBRID matches all). 'My claims' section shows the
producer's existing claims with a Withdraw button when PENDING.

Mirrors /me/contractor/[id]/requests structure."
```

---

## Task 5: Link from producer cabinet detail to `/requests`

**Files:**
- Modify: `src/app/[locale]/me/producer/[id]/page.tsx`

- [ ] **Step 1: Add the link in the cabinet detail header**

Open `src/app/[locale]/me/producer/[id]/page.tsx`. Find the existing header block:

```tsx
        <p className="text-sm text-muted">
          <Link href={`/${locale}/p/${producer.handle}`} className="hover:underline">{t("viewPublic")} →</Link>
        </p>
```

Replace with:

```tsx
        <p className="text-sm text-muted flex flex-wrap gap-x-4 gap-y-1">
          <Link href={`/${locale}/p/${producer.handle}`} className="hover:underline">{t("viewPublic")} →</Link>
          <Link href={`/${locale}/me/producer/${producer.id}/requests`} className="hover:underline text-accent">{t("availableRequests")} →</Link>
        </p>
```

- [ ] **Step 2: Typecheck**

```bash
cd /home/dv/poolwatt && npx tsc --noEmit
```

Expected: zero errors. (The `availableRequests` key will be added in Task 7's i18n batch.)

- [ ] **Step 3: Commit**

```bash
git add src/app/\[locale\]/me/producer/\[id\]/page.tsx
git commit -m "feat(claim-r4): add Available requests link in contractor detail

Producer cabinet detail page header now links to the new /requests
feed (R4). 'View public page' link remains as the first option;
'Available requests' is the accent CTA."
```

---

## Task 6: `acceptProducerClaim` action + show producer claims on homeowner BR detail

**Files:**
- Modify: `src/app/[locale]/me/build-requests/actions.ts` (add `acceptProducerClaim`)
- Modify: `src/app/[locale]/me/build-requests/[id]/page.tsx` (show producer claims section)
- Create: `src/app/[locale]/me/build-requests/[id]/accept-producer-claim-button.tsx` (client button)

- [ ] **Step 1: Add `acceptProducerClaim` to existing actions file**

Open `src/app/[locale]/me/build-requests/actions.ts`. At the bottom of the file (after the existing exports), append:

```ts
export async function acceptProducerClaim(input: {
  buildRequestId: string;
  claimId: string;
}): Promise<{ ok: boolean; formError?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated" };

  const br = await prisma.buildRequest.findUnique({
    where: { id: input.buildRequestId },
    select: { id: true, userId: true, status: true },
  });
  if (!br) return { ok: false, formError: "Build request not found" };
  if (br.userId !== session.user.id) return { ok: false, formError: "Not authorized" };
  if (br.status !== "OPEN") return { ok: false, formError: "Build request is no longer open" };

  const claim = await prisma.producerBuildRequestClaim.findUnique({
    where: { id: input.claimId },
    select: { id: true, buildRequestId: true, status: true, producerId: true },
  });
  if (!claim || claim.buildRequestId !== br.id) {
    return { ok: false, formError: "Claim not found" };
  }
  if (claim.status !== "PENDING") {
    return { ok: false, formError: "Claim is no longer pending" };
  }

  // Atomic: accept this producer claim, mark BR matched, cascade-reject other PENDING
  // claims on the same BR (both contractor and producer tables).
  await prisma.$transaction([
    prisma.producerBuildRequestClaim.update({
      where: { id: claim.id },
      data: { status: "ACCEPTED", respondedAt: new Date() },
    }),
    prisma.buildRequest.update({
      where: { id: br.id },
      data: { status: "MATCHED" },
    }),
    prisma.producerBuildRequestClaim.updateMany({
      where: { buildRequestId: br.id, status: "PENDING", id: { not: claim.id } },
      data: { status: "REJECTED", respondedAt: new Date() },
    }),
    prisma.buildRequestClaim.updateMany({
      where: { buildRequestId: br.id, status: "PENDING" },
      data: { status: "REJECTED", respondedAt: new Date() },
    }),
  ]);

  try {
    const { sendProducerClaimAcceptedToProducer } = await import("@/lib/resend-producer-match");
    await sendProducerClaimAcceptedToProducer({
      claimId: claim.id,
      buildRequestId: br.id,
      producerId: claim.producerId,
    });
  } catch (err) {
    console.error("[r4] producer-accepted notification failed:", err);
  }

  revalidatePath(`/[locale]/me/build-requests/${br.id}`, "page");
  revalidatePath(`/[locale]/me/producer/${claim.producerId}/requests`, "page");
  return { ok: true };
}
```

(The imports at the top of the file — `auth`, `prisma`, `revalidatePath` — are already present from the existing actions in this file.)

- [ ] **Step 2: Create the accept button (client component)**

Create `src/app/[locale]/me/build-requests/[id]/accept-producer-claim-button.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptProducerClaim } from "../actions";

type Props = {
  buildRequestId: string;
  claimId: string;
  labels: { button: string; confirm: string };
};

export function AcceptProducerClaimButton({ buildRequestId, claimId, labels }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    if (!confirm(labels.confirm)) return;
    startTransition(async () => {
      const r = await acceptProducerClaim({ buildRequestId, claimId });
      if (r.ok) {
        router.refresh();
      } else {
        alert(r.formError ?? "Accept failed.");
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="text-xs font-semibold border border-accent/40 text-accent rounded px-3 py-1.5 hover:bg-accent/10 disabled:opacity-50"
    >
      {labels.button}
    </button>
  );
}
```

- [ ] **Step 3: Extend homeowner BR detail page to show producer claims**

Open `src/app/[locale]/me/build-requests/[id]/page.tsx`. Find where the existing contractor claims are queried (look for `buildRequestClaim.findMany` or similar). After that query, ADD a query for producer claims:

```tsx
  const producerClaims = await prisma.producerBuildRequestClaim.findMany({
    where: { buildRequestId: br.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, status: true, message: true, createdAt: true,
      producer: { select: { id: true, handle: true, displayName: true, primarySource: true } },
    },
  });
```

Then find where contractor claims are rendered. AFTER that section, add a new section for producer claims. Insert this JSX block (adapt locale calls and `t` function name to match the existing file's conventions — likely `t` from `getTranslations("buildRequest")` or similar):

```tsx
  {/* Producer claims (R4) */}
  {producerClaims.length > 0 && (
    <section className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
        Producers interested ({producerClaims.length})
      </h2>
      <ul className="space-y-3">
        {producerClaims.map((c) => (
          <li key={c.id} className="bg-card border border-hairline rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">
                  <Link href={`/${locale}/p/${c.producer.handle}`} className="hover:underline">
                    {c.producer.displayName}
                  </Link>
                  <span className="ml-2 text-[10px] uppercase text-muted">{c.producer.primarySource}</span>
                </div>
                <div className="text-xs text-muted mt-1">Status: <b>{c.status}</b></div>
                {c.message && <p className="text-xs text-muted-strong mt-2 italic">"{c.message}"</p>}
              </div>
              {c.status === "PENDING" && br.status === "OPEN" && (
                <AcceptProducerClaimButton
                  buildRequestId={br.id}
                  claimId={c.id}
                  labels={{
                    button: "Accept",
                    confirm: "Accept this producer? Other pending claims will be auto-rejected.",
                  }}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )}
```

Make sure to:
- Import `AcceptProducerClaimButton` at the top: `import { AcceptProducerClaimButton } from "./accept-producer-claim-button";`
- Import `Link` if not already imported.
- Use the file's existing local `locale` variable.
- The hardcoded English strings in this step will be swapped to i18n in Task 7.

- [ ] **Step 4: Typecheck**

```bash
cd /home/dv/poolwatt && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/\[locale\]/me/build-requests/
git commit -m "feat(claim-r4): add acceptClaim + cascade-cancel for producer claims

acceptProducerClaim server action: accepts a producer's PENDING claim
in one transaction — sets ACCEPTED, marks BR MATCHED, REJECTs all
other PENDING claims (both producer and contractor tables), then
notifies the producer with the homeowner's contact details.

Homeowner BR detail page now renders a 'Producers interested'
section alongside the existing contractors-interested section."
```

---

## Task 7: i18n strings — `cabinet.producer.requests.*` (EN / RU / SK)

**Files:**
- Modify: `messages/en.json` / `ru.json` / `sk.json`
- Modify: `src/app/[locale]/me/producer/[id]/page.tsx` (swap hardcoded `availableRequests`)
- Modify: `src/app/[locale]/me/build-requests/[id]/page.tsx` (swap hardcoded section title + accept button + confirm)

- [ ] **Step 1: Add `cabinet.producer.requests.*` to `messages/en.json`**

In `messages/en.json`, find the existing `cabinet.producer` namespace (added in R3c). Add `availableRequests` as a sibling key, and add a `requests` sub-namespace:

```json
      "availableRequests": "Available requests",
      "requests": {
        "back": "Back to cabinet",
        "title": "Available requests",
        "subtitle": "Open build requests matching {name}.",
        "openSection": "Open requests",
        "noOpen": "No open requests match your country and source right now.",
        "myClaimsSection": "My claims",
        "noClaims": "You haven't expressed interest in any request yet.",
        "messagePlaceholder": "Optional message to the homeowner (max 2000 chars)",
        "expressSubmit": "Express interest",
        "expressSubmitting": "Sending…",
        "status": "Status",
        "withdraw": "Withdraw",
        "withdrawConfirm": "Withdraw your interest in this request?"
      }
```

Then, find a sensible top-level place for build-request producer-claim section strings. Add a `buildRequest.producerClaims` sub-namespace (or add to whatever existing `buildRequest` namespace is there):

```json
    "producerClaims": {
      "sectionTitle": "Producers interested ({count})",
      "accept": "Accept",
      "acceptConfirm": "Accept this producer? Other pending claims will be auto-rejected."
    }
```

- [ ] **Step 2: Add the same keys to `messages/ru.json`**

```json
      "availableRequests": "Доступные заявки",
      "requests": {
        "back": "К кабинету",
        "title": "Доступные заявки",
        "subtitle": "Открытые заявки, подходящие для {name}.",
        "openSection": "Открытые заявки",
        "noOpen": "Подходящих заявок по вашей стране и источнику пока нет.",
        "myClaimsSection": "Мои отклики",
        "noClaims": "Вы пока не откликались ни на одну заявку.",
        "messagePlaceholder": "Сообщение домовладельцу (опционально, до 2000 символов)",
        "expressSubmit": "Откликнуться",
        "expressSubmitting": "Отправка…",
        "status": "Статус",
        "withdraw": "Отозвать",
        "withdrawConfirm": "Отозвать ваш отклик на эту заявку?"
      }
```

And in the `buildRequest` namespace:

```json
    "producerClaims": {
      "sectionTitle": "Заинтересованные производители ({count})",
      "accept": "Принять",
      "acceptConfirm": "Принять этого производителя? Остальные ожидающие отклики будут автоматически отклонены."
    }
```

- [ ] **Step 3: Add the same keys to `messages/sk.json`**

```json
      "availableRequests": "Dostupné požiadavky",
      "requests": {
        "back": "Späť do kabinetu",
        "title": "Dostupné požiadavky",
        "subtitle": "Otvorené požiadavky vhodné pre {name}.",
        "openSection": "Otvorené požiadavky",
        "noOpen": "Momentálne nie sú dostupné žiadne požiadavky pre vašu krajinu a zdroj.",
        "myClaimsSection": "Moje odpovede",
        "noClaims": "Zatiaľ ste neodpovedali na žiadnu požiadavku.",
        "messagePlaceholder": "Voliteľná správa domácnosti (max 2000 znakov)",
        "expressSubmit": "Prejaviť záujem",
        "expressSubmitting": "Odosielam…",
        "status": "Stav",
        "withdraw": "Stiahnuť",
        "withdrawConfirm": "Stiahnuť váš záujem o túto požiadavku?"
      }
```

And in the `buildRequest` namespace:

```json
    "producerClaims": {
      "sectionTitle": "Zainteresovaní výrobcovia ({count})",
      "accept": "Prijať",
      "acceptConfirm": "Prijať tohto výrobcu? Ostatné čakajúce odpovede budú automaticky zamietnuté."
    }
```

- [ ] **Step 4: Swap hardcoded strings on cabinet detail page**

In `src/app/[locale]/me/producer/[id]/page.tsx`, the link added in Task 5 currently says `t("availableRequests")` — that key is added in Step 1 above. No code change needed in this step beyond verifying it.

- [ ] **Step 5: Swap hardcoded strings on homeowner BR detail page**

In `src/app/[locale]/me/build-requests/[id]/page.tsx`, the producer-claims section added in Task 6 has hardcoded English strings. Find:

```tsx
        Producers interested ({producerClaims.length})
```

Replace with the appropriate t-call. The exact call depends on what `t` is named in this file. If it's `t = await getTranslations("buildRequest")`, then:

```tsx
        {t("producerClaims.sectionTitle", { count: producerClaims.length })}
```

Find:

```tsx
                  labels={{
                    button: "Accept",
                    confirm: "Accept this producer? Other pending claims will be auto-rejected.",
                  }}
```

Replace with:

```tsx
                  labels={{
                    button: t("producerClaims.accept"),
                    confirm: t("producerClaims.acceptConfirm"),
                  }}
```

If `t` is not already defined in this file or is scoped to a different namespace, add at the top of the page function:

```tsx
  const t = await getTranslations("buildRequest");
```

(If a translation function with a different name exists already, use that.)

- [ ] **Step 6: Verify JSON parses**

```bash
cd /home/dv/poolwatt && \
node -e "JSON.parse(require('fs').readFileSync('messages/en.json'))" && \
node -e "JSON.parse(require('fs').readFileSync('messages/ru.json'))" && \
node -e "JSON.parse(require('fs').readFileSync('messages/sk.json'))" && \
echo "all locales valid JSON"
```

Expected: `all locales valid JSON`.

- [ ] **Step 7: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add messages/ src/app/\[locale\]/me/build-requests/\[id\]/page.tsx
git commit -m "feat(claim-r4): add EN/RU/SK i18n strings

- cabinet.producer.availableRequests link label.
- cabinet.producer.requests.* namespace (~13 keys per locale) for the
  producer feed page.
- buildRequest.producerClaims.* (3 keys) for the homeowner BR detail
  producer-claims section.

Swaps hardcoded English from Task 6 with t() calls."
```

---

## Task 8: Build + restart + smoke

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

```bash
cd /home/dv/poolwatt && npm test
```

Expected: all tests pass. Baseline 172 + R4 additions (8 new) = 180.

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

- [ ] **Step 4: Smoke landing + detail**

```bash
curl -sS -o /dev/null -w "landing  %{http_code}\n" https://poolwatt.com/en
curl -sS -o /dev/null -w "jinko    %{http_code}\n" https://poolwatt.com/en/p/jinko-solar-haining
```

Expected: both 200.

- [ ] **Step 5: Anonymous /me/producer/.../requests redirects to /login**

```bash
JINKO_ID=$(node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const j = await p.producer.findUnique({ where: { handle: 'jinko-solar-haining' }, select: { id: true } });
  console.log(j.id);
  await p.\$disconnect();
})();
")
curl -sS -o /dev/null -w "requests %{http_code}  redirect=%{redirect_url}\n" "https://poolwatt.com/en/me/producer/$JINKO_ID/requests"
```

Expected: 307 with redirect_url containing `/login`. If 200, the page rendered for an anonymous request — bug.

- [ ] **Step 6: i18n strings present in built bundle**

```bash
curl -sS https://poolwatt.com/en/p/jinko-solar-haining | grep -c "claim this card"
```

Expected: ≥ 1 (R3b strings still render — verifies build didn't regress).

- [ ] **Step 7: No commit — verification only.**

---

## Definition of done for R4

- [ ] `ProducerBuildRequestClaim` model exists; migration applied; client regenerated.
- [ ] `expressProducerInterest` + `withdrawProducerClaim` actions exist; 8 tests pass.
- [ ] `resend-producer-match.ts` has 2 helpers (express + accepted notifications).
- [ ] `/me/producer/[id]/requests` page renders filtered open BRs + my-claims section.
- [ ] Cabinet detail page links to `/requests`.
- [ ] `acceptProducerClaim` exists in `build-requests/actions.ts`; cascade-rejects other claims; sends notification.
- [ ] Homeowner BR detail page shows producer claims with accept button.
- [ ] EN/RU/SK i18n strings added (~17 keys per locale).
- [ ] `npm test` (180) + `npx tsc --noEmit` green.
- [ ] `npm run build && pm2 restart poolwatt-web` succeeds; cabinet pages redirect anonymous users.
- [ ] 7 commits on `main` labeled `feat(claim-r4): …`.

**Next:** R5 — ChargerOperator (separate plan). After R4, producer-side of V1 is fully shipped with bidirectional matching.

---

## Self-review

- **Spec coverage:** Spec § "Cabinets > /me/producer/[id]" Tab 3 (BuildRequests) — Task 4 implements the feed; Tasks 2+6 implement the actions; Task 6 also extends homeowner BR detail per spec § "Public-UI visibility". The polymorphic `BuildRequestClaim` refactor in the spec is **explicitly deviated** — documented at the top of this plan.
- **Placeholders:** None. Step 5 of Task 6 has a conditional "depends on what `t` is named in this file" — that's not a TBD, it's a contextual instruction for the implementer to inspect one line.
- **Type consistency:** `ActionResult` redefined in Task 2 (parallel to the existing contractor one — fine, both files are colocated with their actions). `assertProducerOwner` helper is private. Tests use the same vi.mock pattern as R3b/R3c.
