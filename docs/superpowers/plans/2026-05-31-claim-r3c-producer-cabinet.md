# R3c — Producer Cabinet (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A real company that has claimed a producer card (R3b) can now log in and edit it. They get a list page (`/me/producer`) of their claimed cards and a detail page (`/me/producer/[id]`) with two edit forms — Card (display name, bio, logos, social links) and Profile (description, founded year, employees, contacts, CEO, stock ticker). Edits persist to DB and surface on the public card on next ISR cycle (60s).

**Architecture:** Three server actions (`updateProducerCard`, `updateProducerProfile`, `unlinkClaim`) live in one `actions.ts` next to the cabinet pages, all gated on `claimedById === session.user.id`. List page does a simple `prisma.producer.findMany({ where: { claimedById: userId } })`. Detail page is a server component that fetches the producer + profile and renders two client forms below a small header. R3b's post-claim redirect is updated to send users into the cabinet instead of back to the public card.

**Tech Stack:** Next.js 16 App Router (server actions + server components), Prisma 5, Zod for input validation, Vitest (DB-integration tests for actions; no e2e in R3c — manual smoke after build).

**Spec reference:** `docs/superpowers/specs/2026-05-31-claim-your-card-design.md` § "Cabinets > `/me/producer`" + § "Cabinets > `/me/producer/[id]`" (tabs 1, 2, 4 — tab 3 "BuildRequests" is R4).

**Builds on:** R1 (Producer schema), R2 (Prisma readers), R3a (claimedById columns), R3b (claim flow + Verified badge).

**Scope (editable in V1):**
- Card: `displayName`, `bio`, `logoUrl`, `websiteUrl`, `twitterUrl`
- Profile: `description`, `founded`, `employees`, `website`, `email`, `phone`, `address`, `ceo`, `stockTicker`

**Out of R3c (later):**
- `equipment[]`, `manufactures[]`, `certifications[]`, `keyProducts[]` — list-editing UI is a separate concern
- `lat/lng` — needs map widget
- `capacityKwh`, `inverterKw`, `category`, `primarySource` — technical/structural, admin-managed
- `bannerUrl`, `city`, `region`, `country` — admin-managed for now
- Admin revoke page (`/admin/claims`) — deferred until the first dispute (none expected in V1)
- BuildRequest feed tab — R4
- Multi-user organizations — Phase 3+
- File upload for logos — Phase 3+

The fields above are shown read-only on the cabinet with a "Contact admin to change" note where relevant.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/app/[locale]/me/producer/actions.ts` | create | Three server actions: `updateProducerCard`, `updateProducerProfile`, `unlinkClaim`. All enforce `claimedById === session.user.id`. |
| `src/app/[locale]/me/producer/actions.test.ts` | create | DB-integration vitest. Mocks `@/lib/auth`; uses real Prisma. |
| `src/app/[locale]/me/producer/page.tsx` | create | List of claimed producers (server component). Empty state with link to directory. |
| `src/app/[locale]/me/producer/[id]/page.tsx` | create | Detail page (server). Header + two forms wired in + unlink button. |
| `src/app/[locale]/me/producer/[id]/card-form.tsx` | create | Client form for the 5 Card fields. |
| `src/app/[locale]/me/producer/[id]/profile-form.tsx` | create | Client form for the 9 Profile fields. |
| `src/app/[locale]/me/producer/[id]/unlink-button.tsx` | create | Client button for unlink. |
| `src/app/[locale]/me/claim/[entityType]/[entityId]/verify/verify-form.tsx` | modify | Change post-success redirect from `/p/[handle]?claimed=1` to `/me/producer/[id]?claimed=1`. |
| `messages/en.json` / `ru.json` / `sk.json` | modify | Add `cabinet.producer.*` namespace (~25 strings). |

---

## Task 1: Server actions — `updateProducerCard`, `updateProducerProfile`, `unlinkClaim`

**Files:**
- Create: `src/app/[locale]/me/producer/actions.ts`
- Test: `src/app/[locale]/me/producer/actions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/[locale]/me/producer/actions.test.ts`:

```ts
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/prisma";

let mockUserId: string | null = null;
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (mockUserId ? { user: { id: mockUserId } } : null)),
}));

import {
  updateProducerCard,
  updateProducerProfile,
  unlinkClaim,
} from "./actions";

const TEST_HANDLE = "test-cabinet-prod";
const TEST_USERNAME = "test_cabinet_user";
const OTHER_USERNAME = "test_cabinet_other";
let testProducerId: string;
let ownerUserId: string;
let otherUserId: string;

async function cleanup() {
  await prisma.producerProfile.deleteMany({ where: { producer: { handle: TEST_HANDLE } } });
  await prisma.producer.deleteMany({ where: { handle: TEST_HANDLE } });
  await prisma.user.deleteMany({ where: { username: { in: [TEST_USERNAME, OTHER_USERNAME] } } });
}

beforeAll(async () => {
  await cleanup();
  ownerUserId = (await prisma.user.create({
    data: { username: TEST_USERNAME, passwordHash: "x" },
  })).id;
  otherUserId = (await prisma.user.create({
    data: { username: OTHER_USERNAME, passwordHash: "x" },
  })).id;
  testProducerId = (await prisma.producer.create({
    data: {
      slug: TEST_HANDLE, handle: TEST_HANDLE, displayName: "Cabinet Test Co",
      country: "DE", primarySource: "SOLAR",
      capacityKwh: 100, inverterKw: 50, rank: 9993,
      claimedById: ownerUserId, claimedAt: new Date(),
    },
  })).id;
});

afterAll(cleanup);

beforeEach(async () => {
  mockUserId = ownerUserId;
  // Reset producer to a known state between tests.
  await prisma.producer.update({
    where: { id: testProducerId },
    data: {
      displayName: "Cabinet Test Co",
      bio: null, logoUrl: null, websiteUrl: null, twitterUrl: null,
      claimedById: ownerUserId, claimedAt: new Date(),
    },
  });
  await prisma.producerProfile.deleteMany({ where: { producerId: testProducerId } });
});

describe("updateProducerCard", () => {
  it("updates the editable card fields when caller is the owner", async () => {
    const r = await updateProducerCard({
      producerId: testProducerId,
      displayName: "Renamed Inc",
      bio: "New bio text",
      logoUrl: "https://example.com/logo.png",
      websiteUrl: "https://example.com",
      twitterUrl: "https://twitter.com/example",
    });
    expect(r.ok).toBe(true);

    const after = await prisma.producer.findUnique({ where: { id: testProducerId } });
    expect(after?.displayName).toBe("Renamed Inc");
    expect(after?.bio).toBe("New bio text");
    expect(after?.logoUrl).toBe("https://example.com/logo.png");
    expect(after?.websiteUrl).toBe("https://example.com");
    expect(after?.twitterUrl).toBe("https://twitter.com/example");
  });

  it("rejects when caller is not the owner", async () => {
    mockUserId = otherUserId;
    const r = await updateProducerCard({
      producerId: testProducerId,
      displayName: "Hostile rename",
    });
    expect(r.ok).toBe(false);

    const after = await prisma.producer.findUnique({ where: { id: testProducerId } });
    expect(after?.displayName).toBe("Cabinet Test Co");
  });

  it("rejects when not logged in", async () => {
    mockUserId = null;
    const r = await updateProducerCard({
      producerId: testProducerId,
      displayName: "Anonymous rename",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects when displayName is empty", async () => {
    const r = await updateProducerCard({
      producerId: testProducerId,
      displayName: "",
    });
    expect(r.ok).toBe(false);
    expect(r.fieldErrors?.displayName).toBeDefined();
  });

  it("accepts empty optional fields (sets DB nulls)", async () => {
    // First set values, then clear them
    await updateProducerCard({
      producerId: testProducerId,
      displayName: "X",
      bio: "y",
      logoUrl: "https://example.com/l.png",
    });
    const r = await updateProducerCard({
      producerId: testProducerId,
      displayName: "X",
      bio: "",
      logoUrl: "",
    });
    expect(r.ok).toBe(true);
    const after = await prisma.producer.findUnique({ where: { id: testProducerId } });
    expect(after?.bio).toBeNull();
    expect(after?.logoUrl).toBeNull();
  });
});

describe("updateProducerProfile", () => {
  it("creates ProducerProfile on first call when none exists", async () => {
    const r = await updateProducerProfile({
      producerId: testProducerId,
      description: "We make panels.",
      founded: 1999,
      employees: "~100",
      website: "https://example.com",
      email: "ceo@example.com",
      phone: "+1 555 0000",
      address: "Berlin",
      ceo: "Jane Doe",
      stockTicker: "TST",
    });
    expect(r.ok).toBe(true);
    const profile = await prisma.producerProfile.findUnique({ where: { producerId: testProducerId } });
    expect(profile?.description).toBe("We make panels.");
    expect(profile?.founded).toBe(1999);
    expect(profile?.ceo).toBe("Jane Doe");
    expect(profile?.stockTicker).toBe("TST");
  });

  it("updates ProducerProfile on subsequent call", async () => {
    await updateProducerProfile({
      producerId: testProducerId,
      description: "First version",
    });
    const r = await updateProducerProfile({
      producerId: testProducerId,
      description: "Updated version",
    });
    expect(r.ok).toBe(true);
    const profile = await prisma.producerProfile.findUnique({ where: { producerId: testProducerId } });
    expect(profile?.description).toBe("Updated version");
  });

  it("rejects when caller is not the owner", async () => {
    mockUserId = otherUserId;
    const r = await updateProducerProfile({
      producerId: testProducerId,
      description: "Hostile bio",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects when founded is implausible (e.g. 1500 or future)", async () => {
    const r1 = await updateProducerProfile({
      producerId: testProducerId,
      founded: 1500,
    });
    expect(r1.ok).toBe(false);

    const r2 = await updateProducerProfile({
      producerId: testProducerId,
      founded: new Date().getFullYear() + 5,
    });
    expect(r2.ok).toBe(false);
  });
});

describe("unlinkClaim", () => {
  it("clears claimedById and claimedAt when caller is the owner", async () => {
    const r = await unlinkClaim({ producerId: testProducerId });
    expect(r.ok).toBe(true);
    const after = await prisma.producer.findUnique({ where: { id: testProducerId } });
    expect(after?.claimedById).toBeNull();
    expect(after?.claimedAt).toBeNull();
  });

  it("rejects when caller is not the owner", async () => {
    mockUserId = otherUserId;
    const r = await unlinkClaim({ producerId: testProducerId });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run and verify fail**

```bash
cd /home/dv/poolwatt && npm test -- src/app/\[locale\]/me/producer/actions.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the actions**

Create `src/app/[locale]/me/producer/actions.ts`:

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

// Empty string ↔ null normalization. Keeps the client form's `value=""` round-trip
// clean without leaking empty strings into the DB.
function nullify(s: string | undefined): string | null {
  return s && s.trim() !== "" ? s : null;
}

async function assertOwner(producerId: string): Promise<
  | { ok: true; userId: string; handle: string }
  | { ok: false; result: ActionResult }
> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, result: { ok: false, formError: "Not authenticated." } };
  }
  const producer = await prisma.producer.findUnique({
    where: { id: producerId },
    select: { claimedById: true, handle: true },
  });
  if (!producer) {
    return { ok: false, result: { ok: false, formError: "Producer not found." } };
  }
  if (producer.claimedById !== session.user.id) {
    return { ok: false, result: { ok: false, formError: "Not authorized." } };
  }
  return { ok: true, userId: session.user.id, handle: producer.handle };
}

const cardSchema = z.object({
  producerId: z.string().min(1),
  displayName: z.string().min(1, "Display name is required.").max(120),
  bio: z.string().max(1000).optional(),
  logoUrl: z.string().url().or(z.literal("")).optional(),
  websiteUrl: z.string().url().or(z.literal("")).optional(),
  twitterUrl: z.string().url().or(z.literal("")).optional(),
});

export type UpdateProducerCardInput = z.input<typeof cardSchema>;

export async function updateProducerCard(input: UpdateProducerCardInput): Promise<ActionResult> {
  const parsed = cardSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]?.toString();
      if (key) fieldErrors[key] = issue.message;
    }
    return { ok: false, fieldErrors };
  }
  const owner = await assertOwner(parsed.data.producerId);
  if (!owner.ok) return owner.result;

  await prisma.producer.update({
    where: { id: parsed.data.producerId },
    data: {
      displayName: parsed.data.displayName,
      bio: nullify(parsed.data.bio),
      logoUrl: nullify(parsed.data.logoUrl),
      websiteUrl: nullify(parsed.data.websiteUrl),
      twitterUrl: nullify(parsed.data.twitterUrl),
    },
  });

  revalidatePath(`/[locale]/p/${owner.handle}`, "page");
  return { ok: true };
}

const profileSchema = z.object({
  producerId: z.string().min(1),
  description: z.string().max(2000).optional(),
  founded: z.number().int().min(1800).max(new Date().getFullYear() + 1).optional().nullable(),
  employees: z.string().max(50).optional(),
  website: z.string().url().or(z.literal("")).optional(),
  email: z.string().email().or(z.literal("")).optional(),
  phone: z.string().max(50).optional(),
  address: z.string().max(500).optional(),
  ceo: z.string().max(100).optional(),
  stockTicker: z.string().max(20).optional(),
});

export type UpdateProducerProfileInput = z.input<typeof profileSchema>;

export async function updateProducerProfile(input: UpdateProducerProfileInput): Promise<ActionResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]?.toString();
      if (key) fieldErrors[key] = issue.message;
    }
    return { ok: false, fieldErrors };
  }
  const owner = await assertOwner(parsed.data.producerId);
  if (!owner.ok) return owner.result;

  const data = {
    description: nullify(parsed.data.description),
    founded: parsed.data.founded ?? null,
    employees: nullify(parsed.data.employees),
    website: nullify(parsed.data.website),
    email: nullify(parsed.data.email),
    phone: nullify(parsed.data.phone),
    address: nullify(parsed.data.address),
    ceo: nullify(parsed.data.ceo),
    stockTicker: nullify(parsed.data.stockTicker),
  };

  await prisma.producerProfile.upsert({
    where: { producerId: parsed.data.producerId },
    create: { producerId: parsed.data.producerId, ...data },
    update: data,
  });

  revalidatePath(`/[locale]/p/${owner.handle}`, "page");
  return { ok: true };
}

export type UnlinkClaimInput = { producerId: string };

export async function unlinkClaim(input: UnlinkClaimInput): Promise<ActionResult> {
  const owner = await assertOwner(input.producerId);
  if (!owner.ok) return owner.result;

  await prisma.producer.update({
    where: { id: input.producerId },
    data: { claimedById: null, claimedAt: null },
  });

  revalidatePath(`/[locale]/p/${owner.handle}`, "page");
  return { ok: true };
}
```

- [ ] **Step 4: Run and verify pass**

```bash
npm test -- src/app/\[locale\]/me/producer/actions.test.ts
```

Expected: 11 tests pass (5 updateProducerCard + 4 updateProducerProfile + 2 unlinkClaim).

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/\[locale\]/me/producer/actions.ts src/app/\[locale\]/me/producer/actions.test.ts
git commit -m "feat(claim-r3c): add producer cabinet server actions

Three actions, all gated on claimedById === session.user.id:
- updateProducerCard: 5 editable fields (displayName, bio, logoUrl,
  websiteUrl, twitterUrl). Zod-validated, URL fields accept empty.
- updateProducerProfile: 9 fields (description, founded, employees,
  contacts, ceo, stockTicker). Upserts ProducerProfile.
- unlinkClaim: clears claimedById + claimedAt so the user can re-claim
  a different card or hand it back.

All three revalidatePath the public producer page after write."
```

---

## Task 2: List page — `/me/producer`

**Files:**
- Create: `src/app/[locale]/me/producer/page.tsx`

- [ ] **Step 1: Create the list page**

Create `src/app/[locale]/me/producer/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function ProducerListPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/producer`);

  const producers = await prisma.producer.findMany({
    where: { claimedById: session.user.id },
    orderBy: { displayName: "asc" },
    select: { id: true, handle: true, displayName: true, country: true, primarySource: true },
  });

  const t = await getTranslations("cabinet.producer");

  return (
    <div className="max-w-2xl">
      <h1 className="text-[28px] font-bold mb-6">{t("listTitle")}</h1>

      {producers.length === 0 ? (
        <div className="bg-card border border-hairline rounded-xl p-8">
          <p className="text-sm text-muted mb-4">{t("emptyState")}</p>
          <Link
            href={`/${locale}`}
            className="text-sm text-accent hover:underline"
          >
            {t("emptyStateCta")} →
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {producers.map((p) => (
            <li key={p.id}>
              <Link
                href={`/${locale}/me/producer/${p.id}`}
                className="block p-4 bg-card border border-hairline rounded-xl hover:border-accent/40 transition-colors"
              >
                <div className="font-semibold">{p.displayName}</div>
                <div className="text-xs text-muted mt-1">
                  @{p.handle} · {p.primarySource} · {p.country}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors. (i18n keys are added in Task 6 — if you render this page before Task 6, runtime will throw MISSING_MESSAGE. Typecheck doesn't care.)

- [ ] **Step 3: Commit**

```bash
git add src/app/\[locale\]/me/producer/page.tsx
git commit -m "feat(claim-r3c): add /me/producer list page

Server component. Lists producers where claimedById = session user.
Empty state links back to the directory. Each row links to detail."
```

---

## Task 3: Card edit form (client component)

**Files:**
- Create: `src/app/[locale]/me/producer/[id]/card-form.tsx`

- [ ] **Step 1: Create the form**

Create `src/app/[locale]/me/producer/[id]/card-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProducerCard } from "../actions";

type Props = {
  producerId: string;
  initial: {
    displayName: string;
    bio: string | null;
    logoUrl: string | null;
    websiteUrl: string | null;
    twitterUrl: string | null;
  };
  labels: {
    sectionTitle: string;
    displayName: string;
    bio: string;
    logoUrl: string;
    websiteUrl: string;
    twitterUrl: string;
    submit: string;
    saved: string;
  };
};

export function CardForm({ producerId, initial, labels }: Props) {
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [bio, setBio] = useState(initial.bio ?? "");
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(initial.websiteUrl ?? "");
  const [twitterUrl, setTwitterUrl] = useState(initial.twitterUrl ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    startTransition(async () => {
      const result = await updateProducerCard({
        producerId, displayName, bio, logoUrl, websiteUrl, twitterUrl,
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
        <input
          id="displayName" type="text" required maxLength={120}
          value={displayName} onChange={(e) => setDisplayName(e.target.value)}
          className="w-full px-3 py-2 rounded border border-hairline bg-card"
        />
      </Field>

      <Field id="bio" label={labels.bio} error={errors.bio}>
        <textarea
          id="bio" rows={3} maxLength={1000}
          value={bio} onChange={(e) => setBio(e.target.value)}
          className="w-full px-3 py-2 rounded border border-hairline bg-card"
        />
      </Field>

      <Field id="logoUrl" label={labels.logoUrl} error={errors.logoUrl}>
        <input id="logoUrl" type="url" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)}
          className="w-full px-3 py-2 rounded border border-hairline bg-card" />
      </Field>

      <Field id="websiteUrl" label={labels.websiteUrl} error={errors.websiteUrl}>
        <input id="websiteUrl" type="url" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)}
          className="w-full px-3 py-2 rounded border border-hairline bg-card" />
      </Field>

      <Field id="twitterUrl" label={labels.twitterUrl} error={errors.twitterUrl}>
        <input id="twitterUrl" type="url" value={twitterUrl} onChange={(e) => setTwitterUrl(e.target.value)}
          className="w-full px-3 py-2 rounded border border-hairline bg-card" />
      </Field>

      {errors._form && <p className="text-sm text-down">{errors._form}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit" disabled={pending}
          className="px-4 py-2 rounded-full font-semibold text-sm bg-accent text-accent-foreground disabled:opacity-50"
        >
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

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/\[locale\]/me/producer/\[id\]/card-form.tsx
git commit -m "feat(claim-r3c): add Card edit form (client component)

Five fields: displayName (required), bio, logoUrl, websiteUrl,
twitterUrl. Posts to updateProducerCard. Shows per-field error
messages from zod; shows '✓ saved' inline after success."
```

---

## Task 4: Profile edit form (client component)

**Files:**
- Create: `src/app/[locale]/me/producer/[id]/profile-form.tsx`

- [ ] **Step 1: Create the form**

Create `src/app/[locale]/me/producer/[id]/profile-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProducerProfile } from "../actions";

type Props = {
  producerId: string;
  initial: {
    description: string | null;
    founded: number | null;
    employees: string | null;
    website: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    ceo: string | null;
    stockTicker: string | null;
  };
  labels: {
    sectionTitle: string;
    description: string;
    founded: string;
    employees: string;
    website: string;
    email: string;
    phone: string;
    address: string;
    ceo: string;
    stockTicker: string;
    submit: string;
    saved: string;
  };
};

export function ProfileForm({ producerId, initial, labels }: Props) {
  const [description, setDescription] = useState(initial.description ?? "");
  const [founded, setFounded] = useState<string>(initial.founded?.toString() ?? "");
  const [employees, setEmployees] = useState(initial.employees ?? "");
  const [website, setWebsite] = useState(initial.website ?? "");
  const [email, setEmail] = useState(initial.email ?? "");
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [address, setAddress] = useState(initial.address ?? "");
  const [ceo, setCeo] = useState(initial.ceo ?? "");
  const [stockTicker, setStockTicker] = useState(initial.stockTicker ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    startTransition(async () => {
      const result = await updateProducerProfile({
        producerId,
        description,
        founded: founded ? Number(founded) : null,
        employees,
        website,
        email,
        phone,
        address,
        ceo,
        stockTicker,
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

      <Field id="description" label={labels.description} error={errors.description}>
        <textarea id="description" rows={4} maxLength={2000}
          value={description} onChange={(e) => setDescription(e.target.value)}
          className="w-full px-3 py-2 rounded border border-hairline bg-card" />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field id="founded" label={labels.founded} error={errors.founded}>
          <input id="founded" type="number" min={1800} max={new Date().getFullYear() + 1}
            value={founded} onChange={(e) => setFounded(e.target.value)}
            className="w-full px-3 py-2 rounded border border-hairline bg-card" />
        </Field>
        <Field id="employees" label={labels.employees} error={errors.employees}>
          <input id="employees" type="text" maxLength={50}
            value={employees} onChange={(e) => setEmployees(e.target.value)}
            className="w-full px-3 py-2 rounded border border-hairline bg-card" />
        </Field>
      </div>

      <Field id="website" label={labels.website} error={errors.website}>
        <input id="website" type="url" value={website} onChange={(e) => setWebsite(e.target.value)}
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

      <Field id="address" label={labels.address} error={errors.address}>
        <input id="address" type="text" maxLength={500}
          value={address} onChange={(e) => setAddress(e.target.value)}
          className="w-full px-3 py-2 rounded border border-hairline bg-card" />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field id="ceo" label={labels.ceo} error={errors.ceo}>
          <input id="ceo" type="text" maxLength={100}
            value={ceo} onChange={(e) => setCeo(e.target.value)}
            className="w-full px-3 py-2 rounded border border-hairline bg-card" />
        </Field>
        <Field id="stockTicker" label={labels.stockTicker} error={errors.stockTicker}>
          <input id="stockTicker" type="text" maxLength={20}
            value={stockTicker} onChange={(e) => setStockTicker(e.target.value)}
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

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/\[locale\]/me/producer/\[id\]/profile-form.tsx
git commit -m "feat(claim-r3c): add Profile edit form (client component)

Nine fields: description, founded (year validated 1800..now+1),
employees, website, email, phone, address, ceo, stockTicker. Posts
to updateProducerProfile (upsert)."
```

---

## Task 5: Detail page + unlink button — `/me/producer/[id]`

**Files:**
- Create: `src/app/[locale]/me/producer/[id]/page.tsx`
- Create: `src/app/[locale]/me/producer/[id]/unlink-button.tsx`

- [ ] **Step 1: Create the unlink button (client component)**

Create `src/app/[locale]/me/producer/[id]/unlink-button.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { unlinkClaim } from "../actions";

type Props = {
  producerId: string;
  locale: string;
  labels: { button: string; confirm: string };
};

export function UnlinkButton({ producerId, locale, labels }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    if (!confirm(labels.confirm)) return;
    startTransition(async () => {
      const r = await unlinkClaim({ producerId });
      if (r.ok) {
        router.push(`/${locale}/me/producer`);
        router.refresh();
      } else {
        alert(r.formError ?? "Unlink failed.");
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="text-xs text-down border border-down/40 rounded px-3 py-1.5 hover:bg-down/10 disabled:opacity-50"
    >
      {labels.button}
    </button>
  );
}
```

- [ ] **Step 2: Create the detail page (server component)**

Create `src/app/[locale]/me/producer/[id]/page.tsx`:

```tsx
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CardForm } from "./card-form";
import { ProfileForm } from "./profile-form";
import { UnlinkButton } from "./unlink-button";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ claimed?: string }>;
};

export default async function ProducerCabinetPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const { claimed } = await searchParams;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/producer/${id}`);

  const producer = await prisma.producer.findUnique({
    where: { id },
    include: { profile: true },
  });
  if (!producer) notFound();
  if (producer.claimedById !== session.user.id) notFound();

  const t = await getTranslations("cabinet.producer");

  return (
    <div className="max-w-3xl space-y-10">
      <div>
        <Link href={`/${locale}/me/producer`} className="text-sm text-muted hover:text-foreground">← {t("backToList")}</Link>
        <h1 className="text-[28px] font-bold mt-2 mb-2">{producer.displayName}</h1>
        <p className="text-sm text-muted">
          <Link href={`/${locale}/p/${producer.handle}`} className="hover:underline">{t("viewPublic")} →</Link>
        </p>
        {claimed === "1" && (
          <div className="mt-4 p-3 rounded-xl bg-up/10 border border-up/30 text-sm">
            ✓ {t("justClaimedBanner")}
          </div>
        )}
      </div>

      <CardForm
        producerId={producer.id}
        initial={{
          displayName: producer.displayName,
          bio: producer.bio,
          logoUrl: producer.logoUrl,
          websiteUrl: producer.websiteUrl,
          twitterUrl: producer.twitterUrl,
        }}
        labels={{
          sectionTitle: t("cardSection"),
          displayName: t("displayName"),
          bio: t("bio"),
          logoUrl: t("logoUrl"),
          websiteUrl: t("websiteUrl"),
          twitterUrl: t("twitterUrl"),
          submit: t("save"),
          saved: t("saved"),
        }}
      />

      <ProfileForm
        producerId={producer.id}
        initial={{
          description: producer.profile?.description ?? null,
          founded: producer.profile?.founded ?? null,
          employees: producer.profile?.employees ?? null,
          website: producer.profile?.website ?? null,
          email: producer.profile?.email ?? null,
          phone: producer.profile?.phone ?? null,
          address: producer.profile?.address ?? null,
          ceo: producer.profile?.ceo ?? null,
          stockTicker: producer.profile?.stockTicker ?? null,
        }}
        labels={{
          sectionTitle: t("profileSection"),
          description: t("description"),
          founded: t("founded"),
          employees: t("employees"),
          website: t("website"),
          email: t("email"),
          phone: t("phone"),
          address: t("address"),
          ceo: t("ceo"),
          stockTicker: t("stockTicker"),
          submit: t("save"),
          saved: t("saved"),
        }}
      />

      <div className="pt-6 border-t border-hairline">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">{t("dangerSection")}</h2>
        <p className="text-xs text-muted mb-3">{t("unlinkHint")}</p>
        <UnlinkButton
          producerId={producer.id}
          locale={locale}
          labels={{ button: t("unlinkButton"), confirm: t("unlinkConfirm") }}
        />
      </div>
    </div>
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
git add src/app/\[locale\]/me/producer/\[id\]/page.tsx src/app/\[locale\]/me/producer/\[id\]/unlink-button.tsx
git commit -m "feat(claim-r3c): add producer cabinet detail page + unlink

Server page enforces login + claimedById ownership (notFound on
mismatch). Renders header, post-claim banner (?claimed=1), CardForm,
ProfileForm, and a Danger section with the UnlinkButton (confirms
via browser prompt then routes back to /me/producer)."
```

---

## Task 6: Update R3b verify redirect → `/me/producer/[id]?claimed=1` + i18n strings

**Files:**
- Modify: `src/app/[locale]/me/claim/[entityType]/[entityId]/verify/verify-form.tsx`
- Modify: `messages/en.json`, `messages/ru.json`, `messages/sk.json`

- [ ] **Step 1: Update R3b verify redirect**

Open `src/app/[locale]/me/claim/[entityType]/[entityId]/verify/verify-form.tsx`. Find this line:

```tsx
        router.push(`/${locale}/p/${handle}?claimed=1`);
```

Replace with:

```tsx
        router.push(`/${locale}/me/producer/${entityId}?claimed=1`);
```

(The `handle` prop is now unused. Keep it in the Props type / signature for backward compat — removing it would require an edit in `/me/claim/[entityType]/[entityId]/verify/page.tsx` as well; small enough scope to leave the prop in place. Marking it as "passed through but unused" is fine.)

Actually, to keep things tidy: since we're touching this file, also remove the `handle` prop. Find:

```tsx
type Props = {
  entityType: "PRODUCER";
  entityId: string;
  handle: string;
  locale: string;
  labels: { code: string; submit: string };
};

export function VerifyForm({ entityType, entityId, handle, locale, labels }: Props) {
```

Replace with:

```tsx
type Props = {
  entityType: "PRODUCER";
  entityId: string;
  locale: string;
  labels: { code: string; submit: string };
};

export function VerifyForm({ entityType, entityId, locale, labels }: Props) {
```

Then open `src/app/[locale]/me/claim/[entityType]/[entityId]/verify/page.tsx` and find:

```tsx
      <VerifyForm
        entityType="PRODUCER"
        entityId={producer.id}
        handle={producer.handle}
        locale={locale}
```

Remove the `handle={producer.handle}` line so it becomes:

```tsx
      <VerifyForm
        entityType="PRODUCER"
        entityId={producer.id}
        locale={locale}
```

The `producer.handle` field is no longer needed by this page; the `select` clause already includes it but removing it from the `select` is optional cleanup — leave it for now to keep this task focused.

- [ ] **Step 2: Update the R3b post-claim banner copy on the PUBLIC card to remove "R3c is coming" wording**

The banner in `src/app/[locale]/p/[handle]/page.tsx` currently says (via the i18n key `claim.publicBanner`): "You've claimed this card. The editing UI is coming in R3c." Now that R3c IS the editing UI, the user lands in the cabinet, NOT on the public card. The `?claimed=1` query param on the public card path is no longer triggered by the post-claim flow.

But we keep the banner on the public card for the case where someone might still navigate there manually with `?claimed=1` (e.g., an old bookmark from R3b's stub redirect). Update the wording in all three locales — see Step 3.

- [ ] **Step 3: Add `cabinet.producer.*` namespace and update `claim.publicBanner` in `messages/en.json`**

Open `messages/en.json`. Find the `claim` namespace. Update `publicBanner`:

```json
    "publicBanner": "You've claimed this card. Edit it from your cabinet."
```

Then find a sensible alphabetical place (likely after `cabinet.contractor` if that namespace exists, otherwise after `bot` and before `charger`) and ADD a `cabinet.producer` sub-namespace. If a `cabinet` namespace already exists with sub-keys (e.g., `cabinet.contractor`), nest under it:

```json
  "cabinet": {
    "contractor": { ... existing ... },
    "producer": {
      "listTitle": "My producer cards",
      "emptyState": "You haven't claimed any producer cards yet.",
      "emptyStateCta": "Browse the directory",
      "backToList": "Back to my cards",
      "viewPublic": "View public page",
      "justClaimedBanner": "You've just claimed this card. Edits will appear publicly within 60 seconds.",
      "cardSection": "Card",
      "displayName": "Display name",
      "bio": "Short bio",
      "logoUrl": "Logo URL",
      "websiteUrl": "Website URL",
      "twitterUrl": "Twitter URL",
      "profileSection": "Company profile",
      "description": "About the company",
      "founded": "Founded (year)",
      "employees": "Employees",
      "website": "Website",
      "email": "Contact email",
      "phone": "Phone",
      "address": "Address",
      "ceo": "CEO",
      "stockTicker": "Stock ticker",
      "save": "Save",
      "saved": "Saved",
      "dangerSection": "Danger zone",
      "unlinkHint": "Unlinks this card from your account. You can re-claim it later if no one else does first.",
      "unlinkButton": "Unlink claim",
      "unlinkConfirm": "Are you sure? This unlinks the card from your account."
    }
  },
```

If `cabinet` is a top-level namespace already with no `contractor` sub-namespace (or named differently), just ADD the `producer` sub-namespace under the existing structure. If there is NO `cabinet` namespace at all, ADD the whole thing as a new top-level namespace.

- [ ] **Step 4: Add the same keys to `messages/ru.json`**

```json
    "producer": {
      "listTitle": "Мои карточки производителя",
      "emptyState": "Вы пока не заявили права на ни одну карточку.",
      "emptyStateCta": "Открыть каталог",
      "backToList": "К моим карточкам",
      "viewPublic": "Открыть публичную страницу",
      "justClaimedBanner": "Вы только что заявили права на эту карточку. Изменения появятся публично в течение 60 секунд.",
      "cardSection": "Карточка",
      "displayName": "Отображаемое имя",
      "bio": "Короткое описание",
      "logoUrl": "URL логотипа",
      "websiteUrl": "URL сайта",
      "twitterUrl": "URL Twitter",
      "profileSection": "Профиль компании",
      "description": "О компании",
      "founded": "Год основания",
      "employees": "Сотрудники",
      "website": "Сайт",
      "email": "Контактный email",
      "phone": "Телефон",
      "address": "Адрес",
      "ceo": "Генеральный директор",
      "stockTicker": "Биржевой тикер",
      "save": "Сохранить",
      "saved": "Сохранено",
      "dangerSection": "Опасная зона",
      "unlinkHint": "Отвязывает карточку от вашего аккаунта. Заявить права снова можно позже, если её не забрал кто-то другой.",
      "unlinkButton": "Отвязать карточку",
      "unlinkConfirm": "Уверены? Это отвяжет карточку от вашего аккаунта."
    }
```

Also update `claim.publicBanner` in `messages/ru.json`:

```json
    "publicBanner": "Вы заявили права на эту карточку. Редактируйте её в кабинете."
```

- [ ] **Step 5: Add the same keys to `messages/sk.json`**

```json
    "producer": {
      "listTitle": "Moje karty výrobcu",
      "emptyState": "Zatiaľ ste neprevzali žiadnu kartu výrobcu.",
      "emptyStateCta": "Otvoriť katalóg",
      "backToList": "Späť na moje karty",
      "viewPublic": "Otvoriť verejnú stránku",
      "justClaimedBanner": "Práve ste prevzali túto kartu. Zmeny sa zobrazia verejne do 60 sekúnd.",
      "cardSection": "Karta",
      "displayName": "Zobrazované meno",
      "bio": "Krátky popis",
      "logoUrl": "URL loga",
      "websiteUrl": "URL webu",
      "twitterUrl": "URL Twitter",
      "profileSection": "Profil spoločnosti",
      "description": "O spoločnosti",
      "founded": "Rok založenia",
      "employees": "Zamestnanci",
      "website": "Web",
      "email": "Kontaktný e-mail",
      "phone": "Telefón",
      "address": "Adresa",
      "ceo": "Generálny riaditeľ",
      "stockTicker": "Burzový symbol",
      "save": "Uložiť",
      "saved": "Uložené",
      "dangerSection": "Nebezpečná zóna",
      "unlinkHint": "Odpojí túto kartu od vášho účtu. Môžete si ju neskôr znova prevziať, ak ju medzitým nezabral niekto iný.",
      "unlinkButton": "Odpojiť kartu",
      "unlinkConfirm": "Naozaj? Toto odpojí kartu od vášho účtu."
    }
```

Also update `claim.publicBanner` in `messages/sk.json`:

```json
    "publicBanner": "Prevzali ste túto kartu. Upravte ju vo svojom kabinete."
```

- [ ] **Step 6: Verify JSON files parse**

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
git add src/app/\[locale\]/me/claim/\[entityType\]/\[entityId\]/verify/ messages/
git commit -m "feat(claim-r3c): redirect post-verify to cabinet + add cabinet.producer i18n

- After successful code verify, send user to /me/producer/[id]?claimed=1
  (was /p/[handle]?claimed=1) so they land directly in the edit UI.
- Drop unused 'handle' prop from VerifyForm.
- Update claim.publicBanner copy in EN/RU/SK to point users to the
  cabinet instead of promising 'R3c is coming'.
- Add cabinet.producer.* namespace in all 3 locales (~28 keys)."
```

---

## Task 7: Build + restart + smoke verification

**Files:** none (verification only)

- [ ] **Step 1: Run full test suite**

```bash
cd /home/dv/poolwatt && npm test
```

Expected: all tests pass. Baseline 161 + R3c additions (11 server-action tests) = 172.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Rebuild + restart (production serves pre-built .next/)**

```bash
npm run build && pm2 restart poolwatt-web
sleep 4
pm2 logs poolwatt-web --lines 30 --nostream
```

Expected: build completes, "Ready in …ms" line. Pre-existing zh-locale errors are NOT new — ignore.

- [ ] **Step 4: Smoke landing + detail (unclaimed state)**

```bash
curl -sS -o /dev/null -w "landing  %{http_code}\n" https://poolwatt.com/en
curl -sS -o /dev/null -w "jinko    %{http_code}\n" https://poolwatt.com/en/p/jinko-solar-haining
curl -sS https://poolwatt.com/en/p/jinko-solar-haining | grep -c "claim this card"
```

Expected: landing 200, jinko 200, ≥ 1 claim CTA. (No real claim yet, so CTA still shows.)

- [ ] **Step 5: Smoke the cabinet pages (anonymous → redirect to /login)**

```bash
curl -sS -o /dev/null -w "list     %{http_code}  redirect=%{redirect_url}\n" "https://poolwatt.com/en/me/producer"
JINKO_ID=$(node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const j = await p.producer.findUnique({ where: { handle: 'jinko-solar-haining' }, select: { id: true } });
  console.log(j.id);
  await p.\$disconnect();
})();
")
curl -sS -o /dev/null -w "detail   %{http_code}  redirect=%{redirect_url}\n" "https://poolwatt.com/en/me/producer/$JINKO_ID"
```

Expected: both 307 with `redirect_url` containing `/login` (middleware-level auth gate). If 200, the page rendered for an anonymous request — bug.

- [ ] **Step 6: Verify the i18n strings exist in the built bundles**

```bash
curl -sS https://poolwatt.com/ru/p/jinko-solar-haining | grep -c "забрать карточку"
curl -sS https://poolwatt.com/sk/p/jinko-solar-haining | grep -c "prevziať kartu"
```

Expected: ≥ 1 each. (R3b strings — confirms i18n still works after the publicBanner copy update.)

- [ ] **Step 7: No commit — verification only.**

---

## Definition of done for R3c

- [ ] `src/app/[locale]/me/producer/actions.ts` exports `updateProducerCard`, `updateProducerProfile`, `unlinkClaim`; all gated on `claimedById === session.user.id`; 11 tests pass.
- [ ] `/me/producer` lists claimed cards (or shows empty state).
- [ ] `/me/producer/[id]` requires login + ownership; renders header + CardForm (5 fields) + ProfileForm (9 fields) + UnlinkButton.
- [ ] Saving either form persists to DB and refreshes the page.
- [ ] Unlink button clears `claimedById/claimedAt` and routes back to `/me/producer`.
- [ ] R3b post-verify redirect now sends users to `/me/producer/[id]?claimed=1`.
- [ ] EN/RU/SK i18n keys added (28 new keys per locale + 1 updated key).
- [ ] `npm test` (172) + `npx tsc --noEmit` green.
- [ ] `npm run build && pm2 restart poolwatt-web` succeeds; landing + jinko 200; `/me/producer` and `/me/producer/[id]` redirect anonymous users to /login.
- [ ] 7 commits on `main` labeled `feat(claim-r3c): …` (+ Task 6's modify-and-add commit).

**Next:** R4 — polymorphic BuildRequestClaim + producer BR feed. Separate plan.

---

## Self-review

- **Spec coverage:** Spec § "Cabinets > `/me/producer`" — list page covered in Task 2; empty state included. Spec § "Cabinets > `/me/producer/[id]`" Tab 1 (Card) covered in Tasks 3+5; Tab 2 (Profile) covered in Tasks 4+5; Tab 3 (BuildRequests) deliberately deferred to R4; Tab 4 (Settings) reduced to a single unlink button in Task 5 (no notification email field — Producer has no such column, would require schema change out of R3c scope). Spec § "Public-UI visibility" Verified badge / claim CTA / banner — already done in R3b; R3c only updates the banner copy.
- **Placeholders:** None. Every step contains complete code, exact paths, and exact commands.
- **Type consistency:** `ActionResult` defined once in `actions.ts`; both forms expect the same shape with `fieldErrors` / `formError`. `updateProducerCard` input type derived from zod schema. `UnlinkButton` props match `unlinkClaim` signature. Detail page passes initial values to both forms matching their `initial` prop shapes (DB fields: `string | null` for optional text columns; `number | null` for `founded`).
