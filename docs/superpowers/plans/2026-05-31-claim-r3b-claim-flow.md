# R3b — Claim Flow End-to-End (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real companies can prove ownership of their producer card by entering a corporate email (must match the card's `website` domain), receiving a 6-digit code via email, and submitting it. On success: `Producer.claimedById = userId`, `claimedAt = now()`, a "✓ Verified" badge appears on the public card, and the "This is our company" button disappears.

**Architecture:** Two new pages (`/me/claim/[entityType]/[entityId]` for email submission, `…/verify` for code entry). Three new pure helpers (domain-match validator, 6-digit token generator, and a Resend wrapper for the verification email). Two server actions (`submitClaim`, `verifyClaim`). One change to the public `/p/[handle]` page (claim button + verified badge + post-claim success banner). i18n strings in EN/RU/SK.

**Tech Stack:** Next.js 16 App Router (server actions + server components), Prisma 5, Resend email, Auth.js (existing), Vitest (real-DB integration tests for server actions, pure unit tests for helpers).

**Spec reference:** `docs/superpowers/specs/2026-05-31-claim-your-card-design.md` § "Claim flow".

**Builds on:**
- R3a (schema): `Producer.claimedById/claimedAt`, `ClaimToken` model, `ClaimEntityType` enum.
- R1/R2: Producer table seeded with 100 rows; landing + detail page read from Prisma.

**Out of R3b (later releases):**
- Producer cabinet (`/me/producer`, edit forms) → R3c
- Admin revoke page (`/admin/claims`) → R3c
- BR feed in producer cabinet → R4
- ChargerOperator claim → R5
- Manual admin-claim fallback for cards with no website → not planned; out of V1 scope

---

## What success looks like (manual smoke after R3b ships)

1. Log in as a regular user.
2. Open `https://poolwatt.com/en/p/jinko-solar-haining`.
3. See a "**This is our company — claim this card**" button.
4. Click it → land on `/me/claim/PRODUCER/<jinko's id>` with an email field.
5. Enter `someone@jinkosolar.com` → submit.
6. Page redirects to `…/verify`. Email arrives with a 6-digit code.
7. Enter the code → redirect back to `/p/jinko-solar-haining?claimed=1`.
8. Public page shows "**✓ Verified**" badge and a small post-claim banner ("You've claimed this card. Editing UI coming soon in R3c."). The claim button is gone.

After R3b, JinkoSolar (or whoever) "owns" the row in DB but cannot edit anything yet — that's R3c.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/claim/domain-match.ts` | create | Pure `matchesDomain(email, websiteUrl): boolean`. |
| `src/lib/claim/domain-match.test.ts` | create | Unit tests. |
| `src/lib/claim/token.ts` | create | Pure `generateClaimToken(): string` (6-digit zero-padded). |
| `src/lib/claim/token.test.ts` | create | Unit tests (uniqueness over many calls, format). |
| `src/lib/resend-claim.ts` | create | `sendClaimVerificationEmail(email, code)` via Resend, stub-when-no-key pattern. |
| `src/app/[locale]/me/claim/[entityType]/[entityId]/actions.ts` | create | `submitClaim({entityType, entityId, email})` server action. |
| `src/app/[locale]/me/claim/[entityType]/[entityId]/actions.test.ts` | create | DB-integration test. |
| `src/app/[locale]/me/claim/[entityType]/[entityId]/verify/actions.ts` | create | `verifyClaim({entityType, entityId, code})` server action. |
| `src/app/[locale]/me/claim/[entityType]/[entityId]/verify/actions.test.ts` | create | DB-integration test. |
| `src/app/[locale]/me/claim/[entityType]/[entityId]/page.tsx` | create | Email submission form (server component + client form). |
| `src/app/[locale]/me/claim/[entityType]/[entityId]/verify/page.tsx` | create | Code submission form. |
| `src/app/[locale]/p/[handle]/page.tsx` | modify | Add claim button (when unclaimed) + "✓ Verified" badge (when claimed) + post-claim banner when `?claimed=1`. |
| `messages/en.json` / `ru.json` / `sk.json` | modify | Add `claim.*` namespace strings. |

---

## Task 1: Pure helpers — `domain-match` and `claim-token`

**Files:**
- Create: `src/lib/claim/domain-match.ts`
- Test: `src/lib/claim/domain-match.test.ts`
- Create: `src/lib/claim/token.ts`
- Test: `src/lib/claim/token.test.ts`

### Subtask 1a: `domain-match`

- [ ] **Step 1: Write the failing test**

Create `src/lib/claim/domain-match.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { matchesDomain } from "./domain-match";

describe("matchesDomain", () => {
  it("accepts exact-domain email", () => {
    expect(matchesDomain("ceo@tesla.com", "https://tesla.com")).toBe(true);
  });

  it("accepts subdomain email", () => {
    expect(matchesDomain("sales@subsidiary.tesla.com", "https://tesla.com")).toBe(true);
  });

  it("rejects unrelated domain", () => {
    expect(matchesDomain("ceo@example.com", "https://tesla.com")).toBe(false);
  });

  it("rejects suffix-attack domain (tesla.com.evil.com)", () => {
    expect(matchesDomain("attacker@tesla.com.evil.com", "https://tesla.com")).toBe(false);
  });

  it("strips www. from website host", () => {
    expect(matchesDomain("ceo@tesla.com", "https://www.tesla.com")).toBe(true);
  });

  it("handles website without protocol", () => {
    expect(matchesDomain("ceo@tesla.com", "tesla.com")).toBe(true);
  });

  it("handles website with path / query", () => {
    expect(matchesDomain("ceo@tesla.com", "https://tesla.com/about")).toBe(true);
  });

  it("returns false when website is empty / null", () => {
    expect(matchesDomain("ceo@tesla.com", "")).toBe(false);
    expect(matchesDomain("ceo@tesla.com", null)).toBe(false);
  });

  it("returns false when email is malformed (no @)", () => {
    expect(matchesDomain("not-an-email", "https://tesla.com")).toBe(false);
  });

  it("is case-insensitive on domain", () => {
    expect(matchesDomain("CEO@Tesla.COM", "https://tesla.com")).toBe(true);
  });
});
```

- [ ] **Step 2: Run and verify it fails**

```bash
cd /home/dv/poolwatt && npm test -- src/lib/claim/domain-match.test.ts
```

Expected: FAIL — `Cannot find module './domain-match'`.

- [ ] **Step 3: Implement `matchesDomain`**

Create `src/lib/claim/domain-match.ts`:

```ts
export function matchesDomain(email: string, websiteUrl: string | null | undefined): boolean {
  if (!websiteUrl) return false;
  const at = email.indexOf("@");
  if (at < 1 || at === email.length - 1) return false;
  const emailDomain = email.slice(at + 1).toLowerCase().trim();
  if (!emailDomain) return false;

  let host: string;
  try {
    const u = new URL(websiteUrl.includes("://") ? websiteUrl : `https://${websiteUrl}`);
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host.startsWith("www.")) host = host.slice(4);
  if (!host) return false;

  return emailDomain === host || emailDomain.endsWith(`.${host}`);
}
```

- [ ] **Step 4: Run and verify pass**

```bash
npm test -- src/lib/claim/domain-match.test.ts
```

Expected: 10 tests pass.

### Subtask 1b: `claim-token`

- [ ] **Step 5: Write the failing test**

Create `src/lib/claim/token.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateClaimToken } from "./token";

describe("generateClaimToken", () => {
  it("returns a 6-digit string", () => {
    const t = generateClaimToken();
    expect(t).toMatch(/^\d{6}$/);
  });

  it("zero-pads small values", () => {
    // Run a lot; statistically some calls produce small numbers.
    const tokens = new Set<string>();
    for (let i = 0; i < 1000; i++) tokens.add(generateClaimToken());
    for (const t of tokens) expect(t).toHaveLength(6);
  });

  it("produces high variety (rough uniqueness check)", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 1000; i++) tokens.add(generateClaimToken());
    // 1000 calls into a 10^6 space — expect very few collisions
    expect(tokens.size).toBeGreaterThan(995);
  });
});
```

- [ ] **Step 6: Run and verify it fails**

```bash
npm test -- src/lib/claim/token.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 7: Implement `generateClaimToken`**

Create `src/lib/claim/token.ts`:

```ts
import { randomInt } from "crypto";

export function generateClaimToken(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}
```

- [ ] **Step 8: Run and verify pass**

```bash
npm test -- src/lib/claim/token.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/lib/claim/
git commit -m "feat(claim-r3b): add domain-match + token helpers

Two pure helpers for the claim flow:
- matchesDomain(email, websiteUrl) validates corporate-email claim
  against the card's website host. Accepts exact and subdomain matches;
  strips www; rejects suffix-attack like tesla.com.evil.com.
- generateClaimToken() returns a 6-digit zero-padded code from
  Node's crypto.randomInt — uniform distribution, no Math.random."
```

---

## Task 2: Email sender — `resend-claim.ts`

**Files:**
- Create: `src/lib/resend-claim.ts`

- [ ] **Step 1: Create the email sender**

Create `src/lib/resend-claim.ts` (mirrors the existing `src/lib/resend-match.ts` pattern):

```ts
import { Resend } from "resend";

const FROM = "Poolwatt <noreply@poolwatt.com>";

let cachedClient: Resend | null = null;
function client(): Resend | null {
  if (cachedClient) return cachedClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  cachedClient = new Resend(key);
  return cachedClient;
}

export async function sendClaimVerificationEmail(
  email: string,
  code: string,
  displayName: string,
): Promise<void> {
  const c = client();
  if (!c) {
    console.log(`[resend stub] would send claim code to ${email}: ${code} (for ${displayName})`);
    return;
  }
  await c.emails.send({
    from: FROM,
    to: email,
    subject: `Poolwatt — verification code for ${displayName}`,
    html: `
      <p>Hello,</p>
      <p>Someone requested to claim the <strong>${displayName}</strong> profile on Poolwatt with this email.</p>
      <p>Your verification code is:</p>
      <p style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${code}</p>
      <p>The code is valid for 30 minutes. If you didn't request this, just ignore this email.</p>
    `,
  });
}
```

- [ ] **Step 2: Verify the module loads (no test — sending email isn't testable without a fake Resend; the stub branch is reached at runtime when RESEND_API_KEY is absent)**

```bash
cd /home/dv/poolwatt && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/resend-claim.ts
git commit -m "feat(claim-r3b): add resend-claim email sender

Sends a 6-digit verification code to a corporate email for the
producer claim flow. Mirrors the existing resend-* helper pattern:
falls back to console-log stub when RESEND_API_KEY is empty."
```

---

## Task 3: Server action — `submitClaim`

**Files:**
- Create: `src/app/[locale]/me/claim/[entityType]/[entityId]/actions.ts`
- Test: `src/app/[locale]/me/claim/[entityType]/[entityId]/actions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/[locale]/me/claim/[entityType]/[entityId]/actions.test.ts`:

```ts
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Mock the email sender so tests don't hit Resend
vi.mock("@/lib/resend-claim", () => ({
  sendClaimVerificationEmail: vi.fn(async () => {}),
}));

// Mock auth so test can run without a real session
let mockUserId: string | null = null;
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (mockUserId ? { user: { id: mockUserId } } : null)),
}));

import { submitClaim } from "./actions";
import { sendClaimVerificationEmail } from "@/lib/resend-claim";

const TEST_HANDLE = "test-claim-submit";
const TEST_USERNAME = "test_claim_submit_user";
let testProducerId: string;
let testUserId: string;

beforeAll(async () => {
  // cleanup
  await prisma.claimToken.deleteMany({ where: { user: { username: TEST_USERNAME } } });
  await prisma.producer.deleteMany({ where: { handle: TEST_HANDLE } });
  await prisma.user.deleteMany({ where: { username: TEST_USERNAME } });

  const user = await prisma.user.create({
    data: { username: TEST_USERNAME, passwordHash: "x" },
  });
  testUserId = user.id;

  const producer = await prisma.producer.create({
    data: {
      slug: TEST_HANDLE, handle: TEST_HANDLE, displayName: "Test Co",
      country: "DE", primarySource: "SOLAR",
      capacityKwh: 100, inverterKw: 50, rank: 9991,
    },
  });
  testProducerId = producer.id;
  await prisma.producerProfile.create({
    data: { producerId: producer.id, website: "https://testco.example" },
  });
});

afterAll(async () => {
  await prisma.claimToken.deleteMany({ where: { user: { username: TEST_USERNAME } } });
  await prisma.producerProfile.deleteMany({ where: { producer: { handle: TEST_HANDLE } } });
  await prisma.producer.deleteMany({ where: { handle: TEST_HANDLE } });
  await prisma.user.deleteMany({ where: { username: TEST_USERNAME } });
});

beforeEach(() => {
  mockUserId = testUserId;
  vi.mocked(sendClaimVerificationEmail).mockClear();
});

describe("submitClaim", () => {
  it("creates a ClaimToken and sends email when email domain matches website", async () => {
    const result = await submitClaim({
      entityType: "PRODUCER", entityId: testProducerId, email: "ceo@testco.example",
    });
    expect(result.ok).toBe(true);

    const tokens = await prisma.claimToken.findMany({
      where: { entityId: testProducerId, userId: testUserId },
    });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].email).toBe("ceo@testco.example");
    expect(tokens[0].token).toMatch(/^\d{6}$/);
    expect(tokens[0].consumedAt).toBeNull();
    expect(tokens[0].expiresAt.getTime()).toBeGreaterThan(Date.now());

    expect(sendClaimVerificationEmail).toHaveBeenCalledOnce();
    expect(sendClaimVerificationEmail).toHaveBeenCalledWith(
      "ceo@testco.example",
      tokens[0].token,
      "Test Co",
    );

    // cleanup for next test
    await prisma.claimToken.deleteMany({ where: { id: tokens[0].id } });
  });

  it("rejects email that doesn't match website domain", async () => {
    const result = await submitClaim({
      entityType: "PRODUCER", entityId: testProducerId, email: "attacker@evil.com",
    });
    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.email).toBeDefined();
    expect(sendClaimVerificationEmail).not.toHaveBeenCalled();

    const tokens = await prisma.claimToken.count({ where: { entityId: testProducerId } });
    expect(tokens).toBe(0);
  });

  it("rejects when not logged in", async () => {
    mockUserId = null;
    const result = await submitClaim({
      entityType: "PRODUCER", entityId: testProducerId, email: "ceo@testco.example",
    });
    expect(result.ok).toBe(false);
    expect(result.formError).toBeDefined();
    expect(sendClaimVerificationEmail).not.toHaveBeenCalled();
  });

  it("rejects when entity is already claimed", async () => {
    await prisma.producer.update({
      where: { id: testProducerId },
      data: { claimedById: testUserId, claimedAt: new Date() },
    });

    const result = await submitClaim({
      entityType: "PRODUCER", entityId: testProducerId, email: "ceo@testco.example",
    });
    expect(result.ok).toBe(false);
    expect(result.formError).toBeDefined();

    // reset
    await prisma.producer.update({
      where: { id: testProducerId },
      data: { claimedById: null, claimedAt: null },
    });
  });
});
```

- [ ] **Step 2: Run and verify fail**

```bash
npm test -- src/app/\[locale\]/me/claim/\[entityType\]/\[entityId\]/actions.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `submitClaim`**

Create `src/app/[locale]/me/claim/[entityType]/[entityId]/actions.ts`:

```ts
"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { matchesDomain } from "@/lib/claim/domain-match";
import { generateClaimToken } from "@/lib/claim/token";
import { sendClaimVerificationEmail } from "@/lib/resend-claim";
import type { ClaimEntityType } from "@prisma/client";

export type SubmitClaimInput = {
  entityType: ClaimEntityType;
  entityId: string;
  email: string;
};

export type SubmitClaimResult =
  | { ok: true }
  | { ok: false; fieldErrors?: Record<string, string>; formError?: string };

const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 min

export async function submitClaim(input: SubmitClaimInput): Promise<SubmitClaimResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, formError: "Not authenticated." };
  }

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
  if (!matchesDomain(input.email, website)) {
    return { ok: false, fieldErrors: { email: "Email must match the company's website domain." } };
  }

  const token = generateClaimToken();
  await prisma.claimToken.create({
    data: {
      token,
      entityType: input.entityType,
      entityId: input.entityId,
      email: input.email,
      userId: session.user.id,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });

  await sendClaimVerificationEmail(input.email, token, producer.displayName);
  return { ok: true };
}
```

- [ ] **Step 4: Run tests and verify pass**

```bash
npm test -- src/app/\[locale\]/me/claim/\[entityType\]/\[entityId\]/actions.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/\[locale\]/me/claim/
git commit -m "feat(claim-r3b): add submitClaim server action

Creates a ClaimToken with 30-min TTL and dispatches a verification
email via Resend. Validates: user is logged in, entityType is PRODUCER,
producer exists and is unclaimed, email domain matches the card's
website (subdomain-aware, suffix-attack-resistant)."
```

---

## Task 4: Server action — `verifyClaim`

**Files:**
- Create: `src/app/[locale]/me/claim/[entityType]/[entityId]/verify/actions.ts`
- Test: `src/app/[locale]/me/claim/[entityType]/[entityId]/verify/actions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/[locale]/me/claim/[entityType]/[entityId]/verify/actions.test.ts`:

```ts
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/prisma";

let mockUserId: string | null = null;
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (mockUserId ? { user: { id: mockUserId } } : null)),
}));

import { verifyClaim } from "./actions";

const TEST_HANDLE = "test-claim-verify";
const TEST_USERNAME = "test_claim_verify_user";
let testProducerId: string;
let testUserId: string;

async function cleanup() {
  await prisma.claimToken.deleteMany({ where: { user: { username: TEST_USERNAME } } });
  await prisma.producer.deleteMany({ where: { handle: TEST_HANDLE } });
  await prisma.user.deleteMany({ where: { username: TEST_USERNAME } });
}

beforeAll(async () => {
  await cleanup();
  const user = await prisma.user.create({
    data: { username: TEST_USERNAME, passwordHash: "x" },
  });
  testUserId = user.id;
  const producer = await prisma.producer.create({
    data: {
      slug: TEST_HANDLE, handle: TEST_HANDLE, displayName: "VTest Co",
      country: "DE", primarySource: "SOLAR",
      capacityKwh: 100, inverterKw: 50, rank: 9992,
    },
  });
  testProducerId = producer.id;
});

afterAll(cleanup);

beforeEach(async () => {
  mockUserId = testUserId;
  // Reset producer claim state and clear tokens between tests
  await prisma.producer.update({
    where: { id: testProducerId },
    data: { claimedById: null, claimedAt: null },
  });
  await prisma.claimToken.deleteMany({ where: { userId: testUserId } });
});

async function createToken(opts: { token: string; expiresAt?: Date; consumedAt?: Date | null }) {
  await prisma.claimToken.create({
    data: {
      token: opts.token,
      entityType: "PRODUCER",
      entityId: testProducerId,
      email: "ceo@vtest.example",
      userId: testUserId,
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 30 * 60 * 1000),
      consumedAt: opts.consumedAt ?? null,
    },
  });
}

describe("verifyClaim", () => {
  it("on valid code: marks producer claimed and consumes token", async () => {
    await createToken({ token: "123456" });
    const result = await verifyClaim({
      entityType: "PRODUCER", entityId: testProducerId, code: "123456",
    });
    expect(result.ok).toBe(true);

    const producer = await prisma.producer.findUnique({ where: { id: testProducerId } });
    expect(producer?.claimedById).toBe(testUserId);
    expect(producer?.claimedAt).not.toBeNull();

    const token = await prisma.claimToken.findFirst({ where: { token: "123456" } });
    expect(token?.consumedAt).not.toBeNull();
  });

  it("rejects wrong code", async () => {
    await createToken({ token: "654321" });
    const result = await verifyClaim({
      entityType: "PRODUCER", entityId: testProducerId, code: "111111",
    });
    expect(result.ok).toBe(false);

    const producer = await prisma.producer.findUnique({ where: { id: testProducerId } });
    expect(producer?.claimedById).toBeNull();
  });

  it("rejects expired code", async () => {
    await createToken({ token: "222222", expiresAt: new Date(Date.now() - 1) });
    const result = await verifyClaim({
      entityType: "PRODUCER", entityId: testProducerId, code: "222222",
    });
    expect(result.ok).toBe(false);

    const producer = await prisma.producer.findUnique({ where: { id: testProducerId } });
    expect(producer?.claimedById).toBeNull();
  });

  it("rejects already-consumed code", async () => {
    await createToken({ token: "333333", consumedAt: new Date() });
    const result = await verifyClaim({
      entityType: "PRODUCER", entityId: testProducerId, code: "333333",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects when not logged in", async () => {
    await createToken({ token: "444444" });
    mockUserId = null;
    const result = await verifyClaim({
      entityType: "PRODUCER", entityId: testProducerId, code: "444444",
    });
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run and verify fail**

```bash
npm test -- src/app/\[locale\]/me/claim/\[entityType\]/\[entityId\]/verify/actions.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `verifyClaim`**

Create `src/app/[locale]/me/claim/[entityType]/[entityId]/verify/actions.ts`:

```ts
"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { ClaimEntityType } from "@prisma/client";

export type VerifyClaimInput = {
  entityType: ClaimEntityType;
  entityId: string;
  code: string;
};

export type VerifyClaimResult =
  | { ok: true }
  | { ok: false; formError: string };

export async function verifyClaim(input: VerifyClaimInput): Promise<VerifyClaimResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };
  if (input.entityType !== "PRODUCER") return { ok: false, formError: "Unsupported entity type." };

  const token = await prisma.claimToken.findFirst({
    where: {
      token: input.code,
      entityType: input.entityType,
      entityId: input.entityId,
      userId: session.user.id,
    },
  });

  if (!token) return { ok: false, formError: "Invalid code." };
  if (token.consumedAt) return { ok: false, formError: "Code already used." };
  if (token.expiresAt < new Date()) return { ok: false, formError: "Code expired." };

  // Re-check the producer is still unclaimed (race condition guard).
  const producer = await prisma.producer.findUnique({ where: { id: input.entityId } });
  if (!producer) return { ok: false, formError: "Producer not found." };
  if (producer.claimedById) return { ok: false, formError: "Already claimed by someone else." };

  // Atomic claim + token consume.
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

  return { ok: true };
}
```

- [ ] **Step 4: Run tests and verify pass**

```bash
npm test -- src/app/\[locale\]/me/claim/\[entityType\]/\[entityId\]/verify/actions.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/\[locale\]/me/claim/\[entityType\]/\[entityId\]/verify/
git commit -m "feat(claim-r3b): add verifyClaim server action

Consumes a ClaimToken (matched by code + entity + user), sets
producer.claimedById/claimedAt, all in one transaction. Rejects
expired, consumed, or unknown codes; re-checks producer is still
unclaimed before write (race-condition guard)."
```

---

## Task 5: Claim form page — `/me/claim/[entityType]/[entityId]`

**Files:**
- Create: `src/app/[locale]/me/claim/[entityType]/[entityId]/page.tsx`
- Create: `src/app/[locale]/me/claim/[entityType]/[entityId]/claim-form.tsx` (client component)

- [ ] **Step 1: Create the server page**

Create `src/app/[locale]/me/claim/[entityType]/[entityId]/page.tsx`:

```tsx
import { redirect, notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ClaimForm } from "./claim-form";

type Props = {
  params: Promise<{ locale: string; entityType: string; entityId: string }>;
};

export default async function ClaimPage({ params }: Props) {
  const { locale, entityType, entityId } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/claim/${entityType}/${entityId}`);
  }

  if (entityType !== "PRODUCER") notFound();

  const producer = await prisma.producer.findUnique({
    where: { id: entityId },
    include: { profile: true },
  });
  if (!producer) notFound();
  if (producer.claimedById) {
    redirect(`/${locale}/p/${producer.handle}`);
  }

  const t = await getTranslations("claim");

  return (
    <div className="max-w-[560px] mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold mb-2">{t("title", { name: producer.displayName })}</h1>
      <p className="text-sm text-muted mb-6">{t("instructions")}</p>
      {producer.profile?.website ? (
        <ClaimForm
          entityType="PRODUCER"
          entityId={producer.id}
          locale={locale}
          website={producer.profile.website}
          labels={{
            email: t("emailLabel"),
            submit: t("submitLabel"),
            domainHint: t("domainHint", { website: producer.profile.website }),
          }}
        />
      ) : (
        <p className="text-sm text-down">{t("noWebsiteFallback")}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the client form**

Create `src/app/[locale]/me/claim/[entityType]/[entityId]/claim-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitClaim } from "./actions";

type Props = {
  entityType: "PRODUCER";
  entityId: string;
  locale: string;
  website: string;
  labels: { email: string; submit: string; domainHint: string };
};

export function ClaimForm({ entityType, entityId, locale, website, labels }: Props) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await submitClaim({ entityType, entityId, email });
      if (result.ok) {
        router.push(`/${locale}/me/claim/${entityType}/${entityId}/verify`);
      } else {
        setError(result.fieldErrors?.email ?? result.formError ?? "Submission failed.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium mb-1">{labels.email}</label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 rounded border border-hairline bg-card"
        />
        <p className="text-xs text-muted mt-1">{labels.domainHint}</p>
      </div>
      {error && <p className="text-sm text-down">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="px-5 py-2.5 rounded-full font-semibold text-sm bg-accent text-accent-foreground disabled:opacity-50"
      >
        {labels.submit}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
cd /home/dv/poolwatt && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/\[locale\]/me/claim/\[entityType\]/\[entityId\]/page.tsx src/app/\[locale\]/me/claim/\[entityType\]/\[entityId\]/claim-form.tsx
git commit -m "feat(claim-r3b): add claim email submission page + form

Server page enforces login + producer-exists + unclaimed. Hides form
when website is missing (V1 limitation). Client form calls submitClaim
and redirects to /verify on success."
```

---

## Task 6: Verify code page — `/me/claim/[entityType]/[entityId]/verify`

**Files:**
- Create: `src/app/[locale]/me/claim/[entityType]/[entityId]/verify/page.tsx`
- Create: `src/app/[locale]/me/claim/[entityType]/[entityId]/verify/verify-form.tsx`

- [ ] **Step 1: Create the server page**

Create `src/app/[locale]/me/claim/[entityType]/[entityId]/verify/page.tsx`:

```tsx
import { redirect, notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { VerifyForm } from "./verify-form";

type Props = {
  params: Promise<{ locale: string; entityType: string; entityId: string }>;
};

export default async function VerifyClaimPage({ params }: Props) {
  const { locale, entityType, entityId } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/claim/${entityType}/${entityId}/verify`);
  }

  if (entityType !== "PRODUCER") notFound();

  const producer = await prisma.producer.findUnique({
    where: { id: entityId },
    select: { id: true, handle: true, displayName: true, claimedById: true },
  });
  if (!producer) notFound();
  if (producer.claimedById) redirect(`/${locale}/p/${producer.handle}`);

  const t = await getTranslations("claim");

  return (
    <div className="max-w-[480px] mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold mb-2">{t("verifyTitle", { name: producer.displayName })}</h1>
      <p className="text-sm text-muted mb-6">{t("verifyInstructions")}</p>
      <VerifyForm
        entityType="PRODUCER"
        entityId={producer.id}
        handle={producer.handle}
        locale={locale}
        labels={{
          code: t("codeLabel"),
          submit: t("verifySubmitLabel"),
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create the client form**

Create `src/app/[locale]/me/claim/[entityType]/[entityId]/verify/verify-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { verifyClaim } from "./actions";

type Props = {
  entityType: "PRODUCER";
  entityId: string;
  handle: string;
  locale: string;
  labels: { code: string; submit: string };
};

export function VerifyForm({ entityType, entityId, handle, locale, labels }: Props) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await verifyClaim({ entityType, entityId, code });
      if (result.ok) {
        router.push(`/${locale}/p/${handle}?claimed=1`);
      } else {
        setError(result.formError ?? "Verification failed.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="code" className="block text-sm font-medium mb-1">{labels.code}</label>
        <input
          id="code"
          type="text"
          required
          pattern="\d{6}"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-full px-3 py-2 rounded border border-hairline bg-card text-2xl tracking-[0.5em] text-center font-mono"
        />
      </div>
      {error && <p className="text-sm text-down">{error}</p>}
      <button
        type="submit"
        disabled={pending || code.length !== 6}
        className="px-5 py-2.5 rounded-full font-semibold text-sm bg-accent text-accent-foreground disabled:opacity-50"
      >
        {labels.submit}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/\[locale\]/me/claim/\[entityType\]/\[entityId\]/verify/page.tsx src/app/\[locale\]/me/claim/\[entityType\]/\[entityId\]/verify/verify-form.tsx
git commit -m "feat(claim-r3b): add verify-code page + form

Server page enforces login + producer-exists + unclaimed. Client form
posts the 6-digit code to verifyClaim and on success redirects to the
public card with ?claimed=1 (which triggers the success banner)."
```

---

## Task 7: Public card — claim button + verified badge + success banner

**Files:**
- Modify: `src/app/[locale]/p/[handle]/page.tsx`

- [ ] **Step 1: Read the current page header section**

```bash
sed -n '38,90p' src/app/[locale]/p/[handle]/page.tsx
```

This is the section with the producer header (displayName, OEM badge, etc.) where the new claim button and verified badge will go.

- [ ] **Step 2: Update `ProducerPage` signature to accept `searchParams`**

Find this line near the top of the file:

```tsx
type Props = { params: Promise<{ locale: string; handle: string }> };
```

Replace with:

```tsx
type Props = {
  params: Promise<{ locale: string; handle: string }>;
  searchParams: Promise<{ claimed?: string }>;
};
```

And update the function signature in `ProducerPage`:

```tsx
export default async function ProducerPage({ params, searchParams }: Props) {
  const { locale, handle } = await params;
  const { claimed } = await searchParams;
  setRequestLocale(locale);
```

- [ ] **Step 3: Compute claim state and verified state**

After this block:

```tsx
  const producer = mergeProducer(dbProducer, snapshot);
  const profile = producer.profile ?? null;
  const isOEM = producer.category === "EQUIPMENT_MANUFACTURER";
```

Add:

```tsx
  const isClaimed = dbProducer.claimedById !== null;
  const justClaimed = claimed === "1" && isClaimed;
```

- [ ] **Step 4: Insert the success banner just inside the wrapper div, before the back link**

Find:

```tsx
    <div className="max-w-[1200px] mx-auto px-6 md:px-12 xl:px-20 py-8">
      <Link
        href={`/${locale}`}
```

Insert this between the opening `<div ...>` and `<Link ...>`:

```tsx
      {justClaimed && (
        <div className="mb-6 p-4 rounded-xl bg-up/10 border border-up/30 text-sm">
          ✓ You've claimed this card. The editing UI is coming in R3c.
        </div>
      )}
```

- [ ] **Step 5: Insert the verified badge or claim button into the header**

Find the header block:

```tsx
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold text-foreground">{producer.displayName}</h1>
            {isOEM && (
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-accent/10 text-accent border border-accent/30">
                Equipment Manufacturer
              </span>
            )}
          </div>
```

Replace the inner `<div className="flex items-center gap-3 mb-2">…</div>` with:

```tsx
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <h1 className="text-2xl font-bold text-foreground">{producer.displayName}</h1>
            {isOEM && (
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-accent/10 text-accent border border-accent/30">
                Equipment Manufacturer
              </span>
            )}
            {isClaimed && (
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-up/10 text-up border border-up/30">
                ✓ Verified
              </span>
            )}
          </div>
```

- [ ] **Step 6: Add the claim CTA below the header description, only when not claimed**

Find the closing of the header block (after the description paragraph, before `<div className="shrink-0"><SourceBadge ... /></div>`). Insert:

```tsx
          {!isClaimed && (
            <Link
              href={`/${locale}/me/claim/PRODUCER/${dbProducer.id}`}
              className="inline-block mt-4 text-xs uppercase tracking-wider px-3 py-1.5 rounded border border-accent/40 text-accent hover:bg-accent/5 transition-colors"
            >
              This is our company — claim this card
            </Link>
          )}
```

(The button text will be replaced by an i18n string in Task 8, but for now it's a hardcoded English string so the page renders correctly.)

- [ ] **Step 7: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/\[locale\]/p/\[handle\]/page.tsx
git commit -m "feat(claim-r3b): add claim button + verified badge to public card

Public producer page:
- Shows '✓ Verified' badge next to OEM badge when producer is claimed.
- Shows 'This is our company — claim this card' CTA when unclaimed.
- Shows post-claim success banner when ?claimed=1 query param is set.
- Plain English strings for now; i18n keys added in Task 8."
```

---

## Task 8: i18n strings (EN / RU / SK) + replace hardcoded strings

**Files:**
- Modify: `messages/en.json`, `messages/ru.json`, `messages/sk.json`
- Modify: `src/app/[locale]/p/[handle]/page.tsx`

- [ ] **Step 1: Add the `claim` namespace to `messages/en.json`**

Open `messages/en.json`. Add this top-level object (placement: alphabetical order, between existing namespaces — typically after `charger` and before `common` or similar):

```json
  "claim": {
    "title": "Claim {name}",
    "instructions": "Enter a corporate email on the company's domain. We'll send a 6-digit verification code to confirm ownership.",
    "emailLabel": "Corporate email",
    "submitLabel": "Send code",
    "domainHint": "Must match the company website: {website}",
    "noWebsiteFallback": "This card has no website on file. To claim it, please email admin@poolwatt.com.",
    "verifyTitle": "Verify code for {name}",
    "verifyInstructions": "Enter the 6-digit code from the email. The code is valid for 30 minutes.",
    "codeLabel": "6-digit code",
    "verifySubmitLabel": "Verify",
    "publicCta": "This is our company — claim this card",
    "publicBadge": "Verified",
    "publicBanner": "You've claimed this card. The editing UI is coming in R3c."
  },
```

- [ ] **Step 2: Add the same keys to `messages/ru.json`**

Russian translations:

```json
  "claim": {
    "title": "Заявить права на {name}",
    "instructions": "Введите корпоративный email на домене компании. Мы отправим 6-значный код для подтверждения владения.",
    "emailLabel": "Корпоративный email",
    "submitLabel": "Отправить код",
    "domainHint": "Должен соответствовать сайту компании: {website}",
    "noWebsiteFallback": "У этой карточки не указан сайт. Чтобы заявить права, напишите на admin@poolwatt.com.",
    "verifyTitle": "Подтверждение кода для {name}",
    "verifyInstructions": "Введите 6-значный код из письма. Код действителен 30 минут.",
    "codeLabel": "6-значный код",
    "verifySubmitLabel": "Подтвердить",
    "publicCta": "Это наша компания — забрать карточку",
    "publicBadge": "Подтверждено",
    "publicBanner": "Вы заявили права на эту карточку. Редактирование появится в R3c."
  },
```

- [ ] **Step 3: Add the same keys to `messages/sk.json`**

Slovak translations:

```json
  "claim": {
    "title": "Prevziať {name}",
    "instructions": "Zadajte firemný e-mail na doméne spoločnosti. Pošleme 6-miestny overovací kód.",
    "emailLabel": "Firemný e-mail",
    "submitLabel": "Odoslať kód",
    "domainHint": "Musí zodpovedať webu spoločnosti: {website}",
    "noWebsiteFallback": "Táto karta nemá uvedený web. Pre prevzatie napíšte na admin@poolwatt.com.",
    "verifyTitle": "Overenie kódu pre {name}",
    "verifyInstructions": "Zadajte 6-miestny kód z e-mailu. Kód je platný 30 minút.",
    "codeLabel": "6-miestny kód",
    "verifySubmitLabel": "Overiť",
    "publicCta": "Toto je naša spoločnosť — prevziať kartu",
    "publicBadge": "Overené",
    "publicBanner": "Prevzali ste túto kartu. Editácia príde v R3c."
  },
```

- [ ] **Step 4: Verify JSON files parse**

```bash
node -e "JSON.parse(require('fs').readFileSync('messages/en.json'))" && \
node -e "JSON.parse(require('fs').readFileSync('messages/ru.json'))" && \
node -e "JSON.parse(require('fs').readFileSync('messages/sk.json'))" && \
echo "all locales valid JSON"
```

Expected: `all locales valid JSON`.

- [ ] **Step 5: Replace hardcoded English strings on the public card with i18n calls**

In `src/app/[locale]/p/[handle]/page.tsx`, find the top of `ProducerPage` (after `setRequestLocale(locale);` line) and add:

```tsx
  const tClaim = await getTranslations("claim");
```

You'll also need to add `getTranslations` to the import from `next-intl/server` — find this import:

```tsx
import { setRequestLocale } from "next-intl/server";
```

Replace with:

```tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
```

Then in the success banner JSX (added in Task 7 Step 4), replace:

```tsx
          ✓ You've claimed this card. The editing UI is coming in R3c.
```

with:

```tsx
          ✓ {tClaim("publicBanner")}
```

In the verified badge (added in Task 7 Step 5), replace:

```tsx
                ✓ Verified
```

with:

```tsx
                ✓ {tClaim("publicBadge")}
```

In the claim CTA (added in Task 7 Step 6), replace:

```tsx
              This is our company — claim this card
```

with:

```tsx
              {tClaim("publicCta")}
```

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add messages/ src/app/\[locale\]/p/\[handle\]/page.tsx
git commit -m "feat(claim-r3b): add claim.* i18n strings (en/ru/sk)

13 new keys covering the claim form, verify form, and the three new
public-card strings. Replaces the hardcoded English strings from
Task 7 with t() calls."
```

---

## Task 9: Verification + smoke + pm2 restart

**Files:** none (verification only)

- [ ] **Step 1: Run full test suite**

```bash
cd /home/dv/poolwatt && npm test
```

Expected: all tests pass (139 prior + ~22 new = ~161). If something pre-existing fails, do NOT silence — diagnose.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Restart web process**

```bash
pm2 restart poolwatt-web
sleep 4
pm2 logs poolwatt-web --lines 40 --nostream
```

Expected: clean restart, "Ready in …ms". Pre-existing zh-locale errors are not new — ignore them.

- [ ] **Step 4: Smoke-check landing + detail (unclaimed state)**

```bash
curl -sS -o /dev/null -w "landing  %{http_code}\n" https://poolwatt.com/en
curl -sS -o /dev/null -w "jinko    %{http_code}\n" https://poolwatt.com/en/p/jinko-solar-haining
curl -sS https://poolwatt.com/en/p/jinko-solar-haining | grep -c "claim this card"
```

Expected: landing 200, jinko 200, claim text count ≥ 1 (the CTA appears since no one's claimed yet).

- [ ] **Step 5: Smoke-check the claim page (anonymous → should redirect to login)**

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
curl -sS -o /dev/null -w "claim    %{http_code}  redirect_url=%{redirect_url}\n" "https://poolwatt.com/en/me/claim/PRODUCER/$JINKO_ID"
```

Expected: HTTP 307 or 200; if you follow the redirect (`-L`), final destination should include `/login`.

- [ ] **Step 6: No commit — verification only.**

---

## Definition of done for R3b

- [ ] `domain-match` and `claim-token` helpers exist + tested.
- [ ] `resend-claim` email sender exists.
- [ ] `submitClaim` and `verifyClaim` server actions exist + tested against real DB (mocked auth + email).
- [ ] Claim form page + verify form page render under `/me/claim/[entityType]/[entityId]` and `…/verify`.
- [ ] Public producer page shows "✓ Verified" when claimed, claim CTA when not, success banner when `?claimed=1`.
- [ ] i18n keys for `claim.*` exist in EN / RU / SK.
- [ ] Full suite + tsc green.
- [ ] pm2 restart clean, landing 200, jinko 200 with claim CTA visible.
- [ ] 8 commits on `main` labeled `feat(claim-r3b): …`.

**Next:** R3c — Producer cabinet (`/me/producer`, `/me/producer/[id]` with Card + Profile edit, admin revoke page). Separate plan.

---

## Self-review

- **Spec coverage:** Spec § "Claim flow" Steps 1–5 are all implemented (login, submit form, send code, verify code, one-claim-per-entity check). Multi-card claimer is supported (no unique constraint, both `submitClaim` and `verifyClaim` check `claimedById` on the producer not on the user). Edge case "card with no website" hides the form (Task 5 Step 1). Revocation explicitly deferred to R3c — noted in "Out of R3b".
- **Placeholders:** None. Every step has concrete code or commands. The "fill in N" pattern only appears in the smoke-step expected count which I've made deterministic (≥ 1).
- **Type consistency:** `entityType: "PRODUCER"` is consistent (literal narrowed from `ClaimEntityType`). `SubmitClaimInput` / `VerifyClaimInput` / `SubmitClaimResult` / `VerifyClaimResult` types are defined once, imported nowhere else (used inline by the form components which import the action functions directly). Test fixtures use the same `TEST_USERNAME` namespace pattern as existing tests (e.g., `test_claim_submit_user`).
