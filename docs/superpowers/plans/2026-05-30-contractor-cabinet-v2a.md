# Contractor Cabinet V2a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build V2a — homeowner-side cabinet at `/me/contractor` for registering a contractor company (EPC partner) + admin moderation queue at `/admin/contractors`. Single Contractor model with status enum; ContractorMember join table from day 1.

**Architecture:** Server Components + Server Actions (no REST). All mutations go through `"use server"` actions that gate on `auth()`. New Prisma models `Contractor` + `ContractorMember` (5 new enums). Resend-backed email side effects.

**Tech Stack:** Next.js 16 App Router, React 19 server components, Prisma 5 (Postgres enum arrays), Auth.js v5 (Credentials), zod 4, next-intl 4, Resend 6, Vitest, Playwright (system Chrome).

**Spec:** `docs/superpowers/specs/2026-05-30-contractor-cabinet-v2a-design.md`

---

## Conventions across this plan

- **TDD**: every server action + every schema → failing test first.
- **Test layout**: unit/integration tests are co-located `*.test.ts` next to source. E2E specs live in `tests/e2e/`.
- **Commits**: one commit per task, message format `feat(contractor): <what>` or `chore(contractor): <what>`. After every commit run `npm run lint && npm run test` and only commit if green.
- **i18n**: every user-visible string in EN + RU + SK at task time. Other 26 locales fall back to EN.
- **Path aliases**: `@/lib/*`, `@/components/*`, etc. — see `tsconfig.json`. Use them everywhere.
- **Existing infra to reuse** (from V1 build-request feature):
  - `vitest.config.ts` with `@/` alias + `loadEnv` of `.env.local` + `clearMocks: true`
  - `src/test-setup.ts` mocks `next/cache` + `next/headers`
  - `src/lib/resend.ts` + `src/lib/resend-build-request.ts` — Resend pattern to mirror
  - `src/app/[locale]/me/build-requests/actions.ts` — Server Action pattern to mirror
  - `src/app/[locale]/admin/layout.tsx` — admin-gated layout exists; just append sidebar entry
  - `scripts/grant-admin.ts` — exists

---

## Task 1: Prisma schema — Contractor model + ContractorMember + 5 enums + User relations

**Files:**
- Modify: `prisma/schema.prisma` (add enums + 2 models + User relations)
- Create: `prisma/migrations/<timestamp>_add_contractor/migration.sql` (auto-generated)

- [ ] **Step 1: Add 5 enums to schema**

Append to `prisma/schema.prisma` (after the existing `BuildRequestStatus` enum, near the bottom — group all Contractor enums together for grep-ability):

```prisma
enum ContractorEntityType {
  LEGAL_ENTITY
  SOLE_TRADER
  INDIVIDUAL
}

enum ContractorWorkCategory {
  DESIGN
  MANUFACTURE
  SUPPLY
  INSTALLATION
  COMMISSIONING
  MAINTENANCE
}

enum ContractorRenewableType {
  SOLAR
  WIND
  HYDRO
  BIOMASS
  GEOTHERMAL
  HYBRID
}

enum ContractorStatus {
  PENDING
  APPROVED
  REJECTED
  SUSPENDED
}

enum ContractorMemberRole {
  OWNER
  ADMIN
  MEMBER
}
```

- [ ] **Step 2: Add `Contractor` model**

Append after the enums:

```prisma
model Contractor {
  id                 String                       @id @default(cuid())
  slug               String                       @unique

  entityType         ContractorEntityType
  displayName        String
  legalName          String?
  registrationNumber String?
  country            String
  city               String
  foundedYear        Int?

  workCategories     ContractorWorkCategory[]
  renewableTypes     ContractorRenewableType[]
  countriesServed    String[]

  bio                String                       @db.Text
  websiteUrl         String?
  logoUrl            String?
  contactEmail       String
  contactPhone       String

  status             ContractorStatus             @default(PENDING)
  adminNote          String?                      @db.Text
  reviewedAt         DateTime?
  reviewedById       String?
  reviewer           User?                        @relation("ContractorReviewer", fields: [reviewedById], references: [id])

  members            ContractorMember[]
  createdAt          DateTime                     @default(now())
  updatedAt          DateTime                     @updatedAt

  @@index([status, createdAt])
  @@index([country, status])
}
```

- [ ] **Step 3: Add `ContractorMember` join model**

Append after `Contractor`:

```prisma
model ContractorMember {
  contractorId       String
  contractor         Contractor                   @relation(fields: [contractorId], references: [id], onDelete: Cascade)
  userId             String
  user               User                         @relation("ContractorMembership", fields: [userId], references: [id], onDelete: Cascade)
  role               ContractorMemberRole         @default(OWNER)
  addedAt            DateTime                     @default(now())

  @@id([contractorId, userId])
  @@index([userId])
}
```

- [ ] **Step 4: Extend `User` model**

In the existing `User { ... }` block, add two new relations alongside the existing `buildRequests` / `reviewedBuildRequests`:

```prisma
model User {
  // ... existing fields and relations ...
  buildRequests             BuildRequest[]      @relation("BuildRequestOwner")
  reviewedBuildRequests     BuildRequest[]      @relation("BuildRequestReviewer")
  contractorMemberships     ContractorMember[]  @relation("ContractorMembership")
  reviewedContractors       Contractor[]        @relation("ContractorReviewer")
}
```

- [ ] **Step 5: Generate the migration**

Run (with env loaded since DATABASE_URL lives in `.env.local`):

```bash
set -a && source .env.local && set +a && npm run db:migrate -- --name add_contractor
```

Expected: prompts confirm migration name, then prints `Your database is now in sync with your schema.` and `✔ Generated Prisma Client`.

If it fails because the dev DB is unreachable, STOP and report BLOCKED — do not modify env vars.

- [ ] **Step 6: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: no new errors. Pre-existing errors in other files (e.g. `reset-password/page.tsx`) are not your concern.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(contractor): add Contractor + ContractorMember Prisma models with 5 enums"
```

---

## Task 2: Slug helper utility (TDD)

**Files:**
- Create: `src/lib/slugify.ts`
- Create: `src/lib/slugify.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/slugify.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { slugify } from "./slugify";

describe("slugify", () => {
  it("lowercases", () => {
    expect(slugify("SolarCo")).toBe("solarco");
  });

  it("converts spaces to dashes", () => {
    expect(slugify("Solar Co Ltd")).toBe("solar-co-ltd");
  });

  it("strips non-alphanumeric except dash", () => {
    expect(slugify("Solar! Co. & Co.")).toBe("solar-co-co");
  });

  it("collapses multiple dashes", () => {
    expect(slugify("Solar  ---  Co")).toBe("solar-co");
  });

  it("trims leading/trailing dashes", () => {
    expect(slugify("---Solar---")).toBe("solar");
  });

  it("transliterates cyrillic", () => {
    expect(slugify("СолярКо")).toBe("solyarko");
  });

  it("handles slovak diacritics", () => {
    expect(slugify("Solárko s.r.o.")).toBe("solarko-sro");
  });

  it("caps at 60 chars", () => {
    const long = "a".repeat(100);
    expect(slugify(long).length).toBe(60);
  });

  it("returns 'x' for empty input", () => {
    expect(slugify("")).toBe("x");
    expect(slugify("!!!")).toBe("x");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/slugify.test.ts`
Expected: FAIL — module `./slugify` not found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/slugify.ts`:

```ts
// Minimal cyrillic + slovak diacritic transliteration. Not exhaustive —
// extend the map if a user reports a missing character. Lossy for chars
// not in the map (they're stripped).
const TRANSLIT: Record<string, string> = {
  // Cyrillic
  а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"yo",ж:"zh",з:"z",и:"i",й:"y",
  к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",
  х:"h",ц:"ts",ч:"ch",ш:"sh",щ:"sch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya",
  // Ukrainian extras
  є:"ye",і:"i",ї:"yi",ґ:"g",
  // Slovak diacritics
  á:"a",ä:"a",č:"c",ď:"d",é:"e",í:"i",ĺ:"l",ľ:"l",ň:"n",ó:"o",ô:"o",
  ŕ:"r",š:"s",ť:"t",ú:"u",ý:"y",ž:"z",
  // German / common
  ö:"o",ü:"u",ß:"ss",
};

export function slugify(input: string): string {
  const lower = input.toLowerCase();
  const ascii = Array.from(lower).map((ch) => TRANSLIT[ch] ?? ch).join("");
  const slug = ascii
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "x";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/slugify.test.ts`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/slugify.ts src/lib/slugify.test.ts
git commit -m "feat(lib): add slugify helper with cyrillic/slovak transliteration"
```

---

## Task 3: Zod schema for contractor input (TDD)

**Files:**
- Create: `src/lib/contractor-schema.ts`
- Create: `src/lib/contractor-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/contractor-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { contractorSchema } from "./contractor-schema";

const baseLegal = {
  entityType: "LEGAL_ENTITY" as const,
  displayName: "SolarCo s.r.o.",
  legalName: "SolarCo Renewable Energy s.r.o.",
  registrationNumber: "12345678",
  country: "SK",
  city: "Bratislava",
  foundedYear: 2015,
  workCategories: ["DESIGN", "INSTALLATION"],
  renewableTypes: ["SOLAR"],
  countriesServed: ["SK", "CZ"],
  bio: "x".repeat(150),
  contactEmail: "info@solarco.sk",
  contactPhone: "+421900000001",
};

const baseIndividual = {
  ...baseLegal,
  entityType: "INDIVIDUAL" as const,
  legalName: undefined,
  registrationNumber: undefined,
};

describe("contractorSchema", () => {
  it("accepts a valid LEGAL_ENTITY contractor", () => {
    expect(contractorSchema.safeParse(baseLegal).success).toBe(true);
  });

  it("requires legalName when entityType=LEGAL_ENTITY", () => {
    const r = contractorSchema.safeParse({ ...baseLegal, legalName: undefined });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some(i => i.path[0] === "legalName")).toBe(true);
  });

  it("requires registrationNumber for LEGAL_ENTITY and SOLE_TRADER", () => {
    const r1 = contractorSchema.safeParse({ ...baseLegal, registrationNumber: undefined });
    expect(r1.success).toBe(false);
    if (!r1.success) expect(r1.error.issues.some(i => i.path[0] === "registrationNumber")).toBe(true);

    const r2 = contractorSchema.safeParse({
      ...baseLegal,
      entityType: "SOLE_TRADER",
      legalName: undefined,
      registrationNumber: undefined,
    });
    expect(r2.success).toBe(false);
    if (!r2.success) expect(r2.error.issues.some(i => i.path[0] === "registrationNumber")).toBe(true);
  });

  it("allows INDIVIDUAL without legalName or registrationNumber", () => {
    expect(contractorSchema.safeParse(baseIndividual).success).toBe(true);
  });

  it("requires at least one workCategory", () => {
    const r = contractorSchema.safeParse({ ...baseLegal, workCategories: [] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some(i => i.path[0] === "workCategories")).toBe(true);
  });

  it("requires at least one renewableType", () => {
    const r = contractorSchema.safeParse({ ...baseLegal, renewableTypes: [] });
    expect(r.success).toBe(false);
  });

  it("requires at least one countriesServed entry", () => {
    const r = contractorSchema.safeParse({ ...baseLegal, countriesServed: [] });
    expect(r.success).toBe(false);
  });

  it("rejects bio shorter than 100 chars", () => {
    const r = contractorSchema.safeParse({ ...baseLegal, bio: "short" });
    expect(r.success).toBe(false);
  });

  it("rejects bio longer than 2000 chars", () => {
    const r = contractorSchema.safeParse({ ...baseLegal, bio: "x".repeat(2001) });
    expect(r.success).toBe(false);
  });

  it("rejects non-ISO-2 country", () => {
    const r = contractorSchema.safeParse({ ...baseLegal, country: "slo" });
    expect(r.success).toBe(false);
  });

  it("rejects non-ISO-2 entries in countriesServed", () => {
    const r = contractorSchema.safeParse({ ...baseLegal, countriesServed: ["SK", "slovakia"] });
    expect(r.success).toBe(false);
  });

  it("rejects invalid contactPhone (not E.164)", () => {
    const r = contractorSchema.safeParse({ ...baseLegal, contactPhone: "0900000001" });
    expect(r.success).toBe(false);
  });

  it("rejects invalid contactEmail", () => {
    const r = contractorSchema.safeParse({ ...baseLegal, contactEmail: "not-an-email" });
    expect(r.success).toBe(false);
  });

  it("rejects invalid websiteUrl scheme", () => {
    const r = contractorSchema.safeParse({ ...baseLegal, websiteUrl: "javascript:alert(1)" });
    expect(r.success).toBe(false);
  });

  it("accepts valid http(s) websiteUrl and logoUrl", () => {
    const r = contractorSchema.safeParse({
      ...baseLegal,
      websiteUrl: "https://solarco.sk",
      logoUrl: "https://cdn.solarco.sk/logo.png",
    });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/contractor-schema.test.ts`
Expected: FAIL — module `./contractor-schema` not found.

- [ ] **Step 3: Implement the schema**

Create `src/lib/contractor-schema.ts`:

```ts
import { z } from "zod";

const entityTypeEnum = z.enum(["LEGAL_ENTITY", "SOLE_TRADER", "INDIVIDUAL"]);
const workCategoryEnum = z.enum([
  "DESIGN", "MANUFACTURE", "SUPPLY", "INSTALLATION", "COMMISSIONING", "MAINTENANCE",
]);
const renewableTypeEnum = z.enum([
  "SOLAR", "WIND", "HYDRO", "BIOMASS", "GEOTHERMAL", "HYBRID",
]);

const isoCountry = z.string().regex(/^[A-Z]{2}$/, "Must be ISO-2 uppercase");

const httpUrl = z
  .string()
  .max(500)
  .refine(
    (s) => {
      try {
        const u = new URL(s);
        return u.protocol === "http:" || u.protocol === "https:";
      } catch {
        return false;
      }
    },
    "Must be a valid http(s) URL",
  );

export const contractorSchema = z
  .object({
    entityType: entityTypeEnum,
    displayName: z.string().min(2).max(100),
    legalName: z.string().min(2).max(200).optional(),
    registrationNumber: z.string().min(4).max(40).optional(),
    country: isoCountry,
    city: z.string().min(1).max(80),
    foundedYear: z.number().int().min(1900).max(new Date().getFullYear()).optional(),

    workCategories: z.array(workCategoryEnum).min(1),
    renewableTypes: z.array(renewableTypeEnum).min(1),
    countriesServed: z.array(isoCountry).min(1),

    bio: z.string().min(100).max(2000),
    websiteUrl: httpUrl.optional(),
    logoUrl: httpUrl.optional(),
    contactEmail: z.string().email().max(254),
    contactPhone: z.string().regex(/^\+[1-9]\d{6,14}$/, "Phone must be E.164"),
  })
  .superRefine((data, ctx) => {
    if (data.entityType === "LEGAL_ENTITY" && !data.legalName) {
      ctx.addIssue({
        code: "custom",
        path: ["legalName"],
        message: "legalName required for LEGAL_ENTITY",
      });
    }
    if (data.entityType !== "INDIVIDUAL" && !data.registrationNumber) {
      ctx.addIssue({
        code: "custom",
        path: ["registrationNumber"],
        message: "registrationNumber required for LEGAL_ENTITY and SOLE_TRADER",
      });
    }
    if (new Set(data.workCategories).size !== data.workCategories.length) {
      ctx.addIssue({ code: "custom", path: ["workCategories"], message: "no duplicates allowed" });
    }
    if (new Set(data.renewableTypes).size !== data.renewableTypes.length) {
      ctx.addIssue({ code: "custom", path: ["renewableTypes"], message: "no duplicates allowed" });
    }
    if (new Set(data.countriesServed).size !== data.countriesServed.length) {
      ctx.addIssue({ code: "custom", path: ["countriesServed"], message: "no duplicates allowed" });
    }
  });

export type ContractorInput = z.infer<typeof contractorSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/contractor-schema.test.ts`
Expected: 15 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/contractor-schema.ts src/lib/contractor-schema.test.ts
git commit -m "feat(contractor): add zod validation schema"
```

---

## Task 4: Server action `createContractor` (TDD)

**Files:**
- Create: `src/app/[locale]/me/contractor/actions.ts`
- Create: `src/app/[locale]/me/contractor/actions.test.ts`
- Create: `src/lib/resend-contractor.ts` (stub — real impl in Task 8)

- [ ] **Step 1: Create the resend-contractor stub**

This is needed by the test's `vi.mock`. Real implementation lands in Task 8.

Create `src/lib/resend-contractor.ts`:

```ts
// Stub created in Task 4. Real implementation lands in Task 8.
export async function sendContractorNewToAdmin(_c: unknown): Promise<void> {}
export async function sendContractorStatusChangedToOwner(
  _id: string,
  _status: string,
  _ownerId: string,
): Promise<void> {}
export async function sendContractorWithdrawnToAdmin(_c: unknown): Promise<void> {}
```

- [ ] **Step 2: Write the failing test**

Create `src/app/[locale]/me/contractor/actions.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createContractor } from "./actions";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/resend-contractor", () => ({
  sendContractorNewToAdmin: vi.fn(),
  sendContractorStatusChangedToOwner: vi.fn(),
  sendContractorWithdrawnToAdmin: vi.fn(),
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

const baseInput = {
  entityType: "LEGAL_ENTITY" as const,
  displayName: "TestCo s.r.o.",
  legalName: "TestCo Renewable Energy s.r.o.",
  registrationNumber: "12345678",
  country: "SK",
  city: "Bratislava",
  foundedYear: 2020,
  workCategories: ["DESIGN", "INSTALLATION"] as const,
  renewableTypes: ["SOLAR"] as const,
  countriesServed: ["SK", "CZ"] as const,
  bio: "We design and install solar power stations across Slovakia and Czech Republic. ".repeat(3),
  contactEmail: "info@testco.sk",
  contactPhone: "+421900000001",
};

beforeEach(async () => {
  await prisma.contractor.deleteMany({ where: { members: { some: { user: { username: { startsWith: "test_ctr_" } } } } } });
});

describe("createContractor", () => {
  it("rejects when not authenticated", async () => {
    mockedAuth.mockResolvedValueOnce(null as never);
    const r = await createContractor(baseInput);
    expect(r.ok).toBe(false);
    expect(r.formError).toMatch(/auth/i);
  });

  it("creates a contractor with status PENDING and OWNER member for an authed user", async () => {
    const u = await ensureUser("test_ctr_alice");
    mockedAuth.mockResolvedValueOnce({ user: { id: u.id, username: u.username, role: "USER" } } as never);

    const r = await createContractor(baseInput);
    expect(r.ok).toBe(true);
    expect(r.id).toBeDefined();

    const stored = await prisma.contractor.findUniqueOrThrow({
      where: { id: r.id! },
      include: { members: true },
    });
    expect(stored.status).toBe("PENDING");
    expect(stored.displayName).toBe("TestCo s.r.o.");
    expect(stored.slug).toMatch(/^testco/);
    expect(stored.members).toHaveLength(1);
    expect(stored.members[0].userId).toBe(u.id);
    expect(stored.members[0].role).toBe("OWNER");
  });

  it("generates collision-suffixed slug if displayName collides", async () => {
    const u1 = await ensureUser("test_ctr_bob");
    mockedAuth.mockResolvedValueOnce({ user: { id: u1.id, username: u1.username, role: "USER" } } as never);
    const r1 = await createContractor(baseInput);
    expect(r1.ok).toBe(true);
    const c1 = await prisma.contractor.findUniqueOrThrow({ where: { id: r1.id! } });

    const u2 = await ensureUser("test_ctr_carol");
    mockedAuth.mockResolvedValueOnce({ user: { id: u2.id, username: u2.username, role: "USER" } } as never);
    const r2 = await createContractor(baseInput);
    expect(r2.ok).toBe(true);
    const c2 = await prisma.contractor.findUniqueOrThrow({ where: { id: r2.id! } });

    expect(c2.slug).not.toBe(c1.slug);
    expect(c2.slug).toMatch(/-2$/);
  });

  it("returns fieldErrors on invalid input", async () => {
    const u = await ensureUser("test_ctr_dave");
    mockedAuth.mockResolvedValueOnce({ user: { id: u.id, username: u.username, role: "USER" } } as never);

    const r = await createContractor({ ...baseInput, bio: "too short" });
    expect(r.ok).toBe(false);
    expect(r.fieldErrors?.bio).toBeDefined();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/app/[locale]/me/contractor/actions.test.ts`
Expected: FAIL — module `./actions` not found.

- [ ] **Step 4: Implement `createContractor`**

Create `src/app/[locale]/me/contractor/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { contractorSchema, type ContractorInput } from "@/lib/contractor-schema";
import { slugify } from "@/lib/slugify";

export type ActionResult = {
  ok: boolean;
  id?: string;
  fieldErrors?: Record<string, string>;
  formError?: string;
};

async function generateUniqueSlug(base: string): Promise<string> {
  const root = slugify(base);
  const candidates = await prisma.contractor.findMany({
    where: { slug: { startsWith: root } },
    select: { slug: true },
  });
  const taken = new Set(candidates.map((c) => c.slug));
  if (!taken.has(root)) return root;
  for (let n = 2; n < 10_000; n++) {
    const cand = `${root}-${n}`.slice(0, 60);
    if (!taken.has(cand)) return cand;
  }
  // extremely unlikely fallback
  return `${root}-${Date.now()}`.slice(0, 60);
}

export async function createContractor(input: ContractorInput): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated" };

  const parsed = contractorSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0];
      if (typeof k === "string" && !fieldErrors[k]) fieldErrors[k] = issue.message;
    }
    return { ok: false, fieldErrors };
  }

  const d = parsed.data;
  const slug = await generateUniqueSlug(d.displayName);

  const created = await prisma.$transaction(async (tx) => {
    const c = await tx.contractor.create({
      data: {
        slug,
        entityType: d.entityType,
        displayName: d.displayName,
        legalName: d.legalName ?? null,
        registrationNumber: d.registrationNumber ?? null,
        country: d.country,
        city: d.city,
        foundedYear: d.foundedYear ?? null,
        workCategories: d.workCategories,
        renewableTypes: d.renewableTypes,
        countriesServed: d.countriesServed,
        bio: d.bio,
        websiteUrl: d.websiteUrl ?? null,
        logoUrl: d.logoUrl ?? null,
        contactEmail: d.contactEmail,
        contactPhone: d.contactPhone,
      },
      select: { id: true, slug: true, displayName: true, country: true, entityType: true },
    });
    await tx.contractorMember.create({
      data: { contractorId: c.id, userId: session.user.id, role: "OWNER" },
    });
    return c;
  });

  try {
    const { sendContractorNewToAdmin } = await import("@/lib/resend-contractor");
    await sendContractorNewToAdmin(created);
  } catch (err) {
    console.error("[contractor] admin notification failed:", err);
  }

  revalidatePath("/[locale]/me/contractor", "page");
  return { ok: true, id: created.id };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/app/[locale]/me/contractor/actions.test.ts`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/resend-contractor.ts \
  src/app/[locale]/me/contractor/actions.ts \
  src/app/[locale]/me/contractor/actions.test.ts
git commit -m "feat(contractor): add createContractor server action with slug + member transaction"
```

---

## Task 5: Server action `updateContractor` (TDD)

**Files:**
- Modify: `src/app/[locale]/me/contractor/actions.ts`
- Modify: `src/app/[locale]/me/contractor/actions.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `actions.test.ts`:

```ts
import { updateContractor } from "./actions";

describe("updateContractor", () => {
  it("updates a PENDING contractor when caller is OWNER", async () => {
    const u = await ensureUser("test_ctr_eve");
    mockedAuth.mockResolvedValue({ user: { id: u.id, username: u.username, role: "USER" } } as never);
    const created = await createContractor(baseInput);

    const r = await updateContractor(created.id!, { ...baseInput, displayName: "TestCo Renamed s.r.o." });
    expect(r.ok).toBe(true);
    const reloaded = await prisma.contractor.findUniqueOrThrow({ where: { id: created.id! } });
    expect(reloaded.displayName).toBe("TestCo Renamed s.r.o.");
  });

  it("refuses to update a non-PENDING contractor", async () => {
    const u = await ensureUser("test_ctr_frank");
    mockedAuth.mockResolvedValue({ user: { id: u.id, username: u.username, role: "USER" } } as never);
    const created = await createContractor(baseInput);
    await prisma.contractor.update({ where: { id: created.id! }, data: { status: "APPROVED" } });

    const r = await updateContractor(created.id!, { ...baseInput, displayName: "Should fail" });
    expect(r.ok).toBe(false);
    expect(r.formError).toMatch(/cannot edit/i);
  });

  it("refuses to update when caller is not OWNER", async () => {
    const owner = await ensureUser("test_ctr_grace");
    mockedAuth.mockResolvedValueOnce({ user: { id: owner.id, username: owner.username, role: "USER" } } as never);
    const created = await createContractor(baseInput);

    const intruder = await ensureUser("test_ctr_henry");
    mockedAuth.mockResolvedValueOnce({ user: { id: intruder.id, username: intruder.username, role: "USER" } } as never);

    const r = await updateContractor(created.id!, { ...baseInput, displayName: "Stealing" });
    expect(r.ok).toBe(false);
    expect(r.formError).toMatch(/not found|forbidden/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/[locale]/me/contractor/actions.test.ts`
Expected: 3 FAIL — `updateContractor is not a function`.

- [ ] **Step 3: Implement `updateContractor`**

Append to `actions.ts`:

```ts
async function requireOwnerMembership(contractorId: string, userId: string) {
  const member = await prisma.contractorMember.findUnique({
    where: { contractorId_userId: { contractorId, userId } },
    select: { role: true },
  });
  return member?.role === "OWNER";
}

export async function updateContractor(
  id: string,
  input: ContractorInput,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated" };

  const existing = await prisma.contractor.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!existing) return { ok: false, formError: "Contractor not found" };

  const isOwner = await requireOwnerMembership(id, session.user.id);
  if (!isOwner) return { ok: false, formError: "Contractor not found" };  // 404-style, don't leak existence

  if (existing.status !== "PENDING") {
    return { ok: false, formError: "Cannot edit a contractor that is no longer PENDING" };
  }

  const parsed = contractorSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0];
      if (typeof k === "string" && !fieldErrors[k]) fieldErrors[k] = issue.message;
    }
    return { ok: false, fieldErrors };
  }

  const d = parsed.data;
  // keep in sync with createContractor's data block
  await prisma.contractor.update({
    where: { id },
    data: {
      entityType: d.entityType,
      displayName: d.displayName,
      legalName: d.legalName ?? null,
      registrationNumber: d.registrationNumber ?? null,
      country: d.country,
      city: d.city,
      foundedYear: d.foundedYear ?? null,
      workCategories: d.workCategories,
      renewableTypes: d.renewableTypes,
      countriesServed: d.countriesServed,
      bio: d.bio,
      websiteUrl: d.websiteUrl ?? null,
      logoUrl: d.logoUrl ?? null,
      contactEmail: d.contactEmail,
      contactPhone: d.contactPhone,
    },
  });

  revalidatePath("/[locale]/me/contractor", "page");
  revalidatePath(`/[locale]/me/contractor/${id}`, "page");
  return { ok: true, id };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/[locale]/me/contractor/actions.test.ts`
Expected: all 7 passed (4 create + 3 update).

- [ ] **Step 5: Commit**

```bash
git add src/app/[locale]/me/contractor/actions.ts \
  src/app/[locale]/me/contractor/actions.test.ts
git commit -m "feat(contractor): add updateContractor server action"
```

---

## Task 6: Server action `withdrawContractor` (TDD)

**Files:**
- Modify: `src/app/[locale]/me/contractor/actions.ts`
- Modify: `src/app/[locale]/me/contractor/actions.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `actions.test.ts`:

```ts
import { withdrawContractor } from "./actions";

describe("withdrawContractor", () => {
  it("deletes a PENDING contractor and its members", async () => {
    const u = await ensureUser("test_ctr_ivy");
    mockedAuth.mockResolvedValue({ user: { id: u.id, username: u.username, role: "USER" } } as never);
    const created = await createContractor(baseInput);

    const r = await withdrawContractor(created.id!);
    expect(r.ok).toBe(true);

    const reloaded = await prisma.contractor.findUnique({ where: { id: created.id! } });
    expect(reloaded).toBeNull();
    const memberRows = await prisma.contractorMember.findMany({
      where: { contractorId: created.id! },
    });
    expect(memberRows).toHaveLength(0);
  });

  it("refuses to withdraw a non-PENDING contractor", async () => {
    const u = await ensureUser("test_ctr_jake");
    mockedAuth.mockResolvedValue({ user: { id: u.id, username: u.username, role: "USER" } } as never);
    const created = await createContractor(baseInput);
    await prisma.contractor.update({ where: { id: created.id! }, data: { status: "APPROVED" } });

    const r = await withdrawContractor(created.id!);
    expect(r.ok).toBe(false);
  });

  it("refuses to withdraw when caller is not OWNER", async () => {
    const owner = await ensureUser("test_ctr_kara");
    mockedAuth.mockResolvedValueOnce({ user: { id: owner.id, username: owner.username, role: "USER" } } as never);
    const created = await createContractor(baseInput);

    const intruder = await ensureUser("test_ctr_liam");
    mockedAuth.mockResolvedValueOnce({ user: { id: intruder.id, username: intruder.username, role: "USER" } } as never);

    const r = await withdrawContractor(created.id!);
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/[locale]/me/contractor/actions.test.ts`
Expected: 3 FAIL — `withdrawContractor is not a function`.

- [ ] **Step 3: Implement `withdrawContractor`**

Append to `actions.ts`:

```ts
export async function withdrawContractor(id: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated" };

  const existing = await prisma.contractor.findUnique({
    where: { id },
    select: { id: true, status: true, displayName: true, country: true, entityType: true },
  });
  if (!existing) return { ok: false, formError: "Contractor not found" };

  const isOwner = await requireOwnerMembership(id, session.user.id);
  if (!isOwner) return { ok: false, formError: "Contractor not found" };

  if (existing.status !== "PENDING") {
    return { ok: false, formError: "Cannot withdraw a contractor that is no longer PENDING" };
  }

  // Delete row; ContractorMember rows cascade.
  await prisma.contractor.delete({ where: { id } });

  try {
    const { sendContractorWithdrawnToAdmin } = await import("@/lib/resend-contractor");
    await sendContractorWithdrawnToAdmin(existing);
  } catch (err) {
    console.error("[contractor] withdraw notification failed:", err);
  }

  revalidatePath("/[locale]/me/contractor", "page");
  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/[locale]/me/contractor/actions.test.ts`
Expected: all 10 passed.

- [ ] **Step 5: Commit**

```bash
git add src/app/[locale]/me/contractor/actions.ts \
  src/app/[locale]/me/contractor/actions.test.ts
git commit -m "feat(contractor): add withdrawContractor server action"
```

---

## Task 7: Admin action `adminSetContractorStatus` (TDD)

**Files:**
- Create: `src/app/[locale]/admin/contractors/actions.ts`
- Create: `src/app/[locale]/admin/contractors/actions.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/app/[locale]/admin/contractors/actions.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { adminSetContractorStatus } from "./actions";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/resend-contractor", () => ({
  sendContractorNewToAdmin: vi.fn(),
  sendContractorStatusChangedToOwner: vi.fn(),
  sendContractorWithdrawnToAdmin: vi.fn(),
}));

import { auth } from "@/lib/auth";
const mockedAuth = vi.mocked(auth);

async function setupContractor() {
  const owner = await prisma.user.upsert({
    where: { username: "test_admin_ctr_owner" },
    update: {},
    create: { username: "test_admin_ctr_owner", passwordHash: "x" },
  });
  const c = await prisma.contractor.create({
    data: {
      slug: `test-admin-ctr-${Date.now()}`,
      entityType: "INDIVIDUAL",
      displayName: "Admin Test Contractor",
      country: "SK",
      city: "Bratislava",
      workCategories: ["INSTALLATION"],
      renewableTypes: ["SOLAR"],
      countriesServed: ["SK"],
      bio: "x".repeat(150),
      contactEmail: "info@admin-test.sk",
      contactPhone: "+421900000099",
    },
  });
  await prisma.contractorMember.create({
    data: { contractorId: c.id, userId: owner.id, role: "OWNER" },
  });
  return c;
}

async function seedAdmin() {
  return prisma.user.upsert({
    where: { username: "test_admin_ctr_user" },
    update: { role: "ADMIN" },
    create: { username: "test_admin_ctr_user", passwordHash: "x", role: "ADMIN" },
  });
}

beforeEach(async () => {
  await prisma.contractor.deleteMany({ where: { members: { some: { user: { username: { startsWith: "test_admin_ctr_" } } } } } });
});

describe("adminSetContractorStatus", () => {
  it("rejects non-admin sessions", async () => {
    const c = await setupContractor();
    mockedAuth.mockResolvedValueOnce({ user: { id: "x", username: "x", role: "USER" } } as never);

    const r = await adminSetContractorStatus(c.id, "APPROVED", "ok");
    expect(r.ok).toBe(false);
    expect(r.formError).toMatch(/admin/i);
  });

  it("transitions PENDING → APPROVED with adminNote", async () => {
    const c = await setupContractor();
    const admin = await seedAdmin();
    mockedAuth.mockResolvedValueOnce({ user: { id: admin.id, username: admin.username, role: "ADMIN" } } as never);

    const r = await adminSetContractorStatus(c.id, "APPROVED", "looks good");
    expect(r.ok).toBe(true);
    const reloaded = await prisma.contractor.findUniqueOrThrow({ where: { id: c.id } });
    expect(reloaded.status).toBe("APPROVED");
    expect(reloaded.adminNote).toBe("looks good");
    expect(reloaded.reviewedById).toBe(admin.id);
  });

  it("requires adminNote (non-empty after trim)", async () => {
    const c = await setupContractor();
    const admin = await seedAdmin();
    mockedAuth.mockResolvedValueOnce({ user: { id: admin.id, username: admin.username, role: "ADMIN" } } as never);

    const r = await adminSetContractorStatus(c.id, "APPROVED", "   ");
    expect(r.ok).toBe(false);
    expect(r.fieldErrors?.adminNote).toBeDefined();
  });

  it("rejects transition from APPROVED", async () => {
    const c = await setupContractor();
    await prisma.contractor.update({ where: { id: c.id }, data: { status: "APPROVED" } });
    const admin = await seedAdmin();
    mockedAuth.mockResolvedValueOnce({ user: { id: admin.id, username: admin.username, role: "ADMIN" } } as never);

    const r = await adminSetContractorStatus(c.id, "REJECTED", "changed mind");
    expect(r.ok).toBe(false);
    expect(r.formError).toMatch(/transition/i);
  });

  it("rejects unsupported transition target", async () => {
    const c = await setupContractor();
    const admin = await seedAdmin();
    mockedAuth.mockResolvedValueOnce({ user: { id: admin.id, username: admin.username, role: "ADMIN" } } as never);

    const r = await adminSetContractorStatus(c.id, "SUSPENDED" as never, "test");
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/[locale]/admin/contractors/actions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the action**

Create `src/app/[locale]/admin/contractors/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import type { ContractorStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type AdminActionResult = {
  ok: boolean;
  fieldErrors?: Record<string, string>;
  formError?: string;
};

// V2a only — V2c will add APPROVED↔SUSPENDED edges.
const VALID_TRANSITIONS: Record<ContractorStatus, ContractorStatus[]> = {
  PENDING: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
  SUSPENDED: [],
};

export async function adminSetContractorStatus(
  id: string,
  status: ContractorStatus,
  adminNote: string,
): Promise<AdminActionResult> {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return { ok: false, formError: "Admin only" };
  }

  const existing = await prisma.contractor.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!existing) return { ok: false, formError: "Contractor not found" };

  const allowed = VALID_TRANSITIONS[existing.status];
  if (!allowed.includes(status)) {
    return { ok: false, formError: `Invalid transition ${existing.status} → ${status}` };
  }

  const note = adminNote?.trim();
  if (!note) {
    return { ok: false, fieldErrors: { adminNote: "Required for this transition" } };
  }

  const ownerMember = await prisma.contractorMember.findFirst({
    where: { contractorId: id, role: "OWNER" },
    select: { userId: true },
  });

  await prisma.contractor.update({
    where: { id },
    data: {
      status,
      adminNote: note,
      reviewedAt: new Date(),
      reviewedById: session.user.id,
    },
  });

  if (ownerMember) {
    try {
      const { sendContractorStatusChangedToOwner } = await import("@/lib/resend-contractor");
      await sendContractorStatusChangedToOwner(id, status, ownerMember.userId);
    } catch (err) {
      console.error("[contractor] owner notification failed:", err);
    }
  }

  revalidatePath("/[locale]/admin/contractors", "page");
  revalidatePath(`/[locale]/admin/contractors/${id}`, "page");
  revalidatePath(`/[locale]/me/contractor/${id}`, "page");
  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/[locale]/admin/contractors/actions.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/app/[locale]/admin/contractors/actions.ts \
  src/app/[locale]/admin/contractors/actions.test.ts
git commit -m "feat(contractor): add adminSetContractorStatus with state machine"
```

---

## Task 8: Resend email helpers (real implementation)

**Files:**
- Modify (overwrite): `src/lib/resend-contractor.ts` — replace the Task 4 stub with real implementations.

No TDD — these are thin side-effect functions verified by the actions tests via mocks.

- [ ] **Step 1: Implement helpers**

Overwrite `src/lib/resend-contractor.ts`:

```ts
import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import type { ContractorStatus } from "@prisma/client";

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

export type ContractorSummary = {
  id: string;
  slug?: string;
  displayName: string;
  country: string;
  entityType: string;
};

export async function sendContractorNewToAdmin(c: ContractorSummary): Promise<void> {
  const to = process.env.ADMIN_EMAIL;
  if (!to) {
    console.warn("[resend-contractor] ADMIN_EMAIL not set, skipping new-contractor notification");
    return;
  }
  const url = `${BASE}/admin/contractors/${c.id}`;
  const shortId = c.id.slice(0, 8);
  const r = client();
  if (!r) {
    console.log(`[resend stub] new contractor ${shortId} → ${to}: ${url}`);
    return;
  }
  await r.emails.send({
    from: FROM,
    to,
    subject: `[Poolwatt] New contractor registration #${shortId} — ${c.displayName}, ${c.country}`,
    html: `
      <p>A new contractor registration was filed.</p>
      <p>Name: <b>${c.displayName}</b><br>
         Type: <b>${c.entityType}</b><br>
         Country: <b>${c.country}</b></p>
      <p><a href="${url}">Open in admin</a></p>
    `,
  });
}

export async function sendContractorStatusChangedToOwner(
  contractorId: string,
  newStatus: ContractorStatus,
  ownerUserId: string,
): Promise<void> {
  const owner = await prisma.user.findUnique({
    where: { id: ownerUserId },
    select: { email: true, emailVerified: true, username: true },
  });
  if (!owner?.email || !owner.emailVerified) {
    return;  // silent skip — no verified email
  }
  const url = `${BASE}/me/contractor/${contractorId}`;
  const shortId = contractorId.slice(0, 8);
  const r = client();
  if (!r) {
    console.log(`[resend stub] contractor ${shortId} → ${newStatus} for ${owner.email}: ${url}`);
    return;
  }
  await r.emails.send({
    from: FROM,
    to: owner.email,
    subject: `[Poolwatt] Your contractor registration #${shortId} is now ${newStatus}`,
    html: `
      <p>Hi ${owner.username},</p>
      <p>Your contractor registration <b>#${shortId}</b> changed status to <b>${newStatus}</b>.</p>
      <p><a href="${url}">View your registration</a></p>
    `,
  });
}

export async function sendContractorWithdrawnToAdmin(c: ContractorSummary): Promise<void> {
  const to = process.env.ADMIN_EMAIL;
  if (!to) {
    console.warn("[resend-contractor] ADMIN_EMAIL not set, skipping withdraw notification");
    return;
  }
  const shortId = c.id.slice(0, 8);
  const r = client();
  if (!r) {
    console.log(`[resend stub] contractor ${shortId} withdrawn → ${to}`);
    return;
  }
  await r.emails.send({
    from: FROM,
    to,
    subject: `[Poolwatt] Contractor registration #${shortId} withdrawn`,
    html: `<p>Owner withdrew the registration for <b>${c.displayName}</b> (${c.country}). The DB row has been deleted.</p>`,
  });
}
```

- [ ] **Step 2: Verify the type-check passes**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Verify the full test suite still passes**

Run: `npm run test`
Expected: all unit/integration tests green (actions tests mock this module).

- [ ] **Step 4: Commit**

```bash
git add src/lib/resend-contractor.ts
git commit -m "feat(contractor): add real Resend email helpers"
```

---

## Task 9: i18n strings (EN/RU/SK)

**Files:**
- Modify: `messages/en.json`, `messages/ru.json`, `messages/sk.json`

- [ ] **Step 1: Add `cabinet.contractor` and `admin.contractor` namespaces to EN**

Read `messages/en.json` first to find existing `cabinet` and `admin` blocks. MERGE (do not replace) the following keys under them. Add `cabinet.sidebar.contractor` to the existing `cabinet.sidebar` object.

```json
"cabinet": {
  "sidebar": {
    "contractor": "My company"
  },
  "contractor": {
    "title": "My company",
    "empty": "You haven't registered a company yet.",
    "newButton": "+ Register company",
    "new": {
      "title": "Register your company",
      "section": {
        "identity": "Company identity",
        "work": "What you do",
        "contact": "Contact & profile"
      }
    },
    "field": {
      "entityType": { "label": "Entity type", "LEGAL_ENTITY": "Legal entity (Ltd / s.r.o. / a.s.)", "SOLE_TRADER": "Sole trader (ИП / OSVČ / ФОП)", "INDIVIDUAL": "Individual specialist" },
      "displayName": { "label": "Display name" },
      "legalName": { "label": "Full legal name" },
      "registrationNumber": { "label": "Registration number (IČO / EDRPOU / etc.)" },
      "country": { "label": "Headquarters country" },
      "city": { "label": "City" },
      "foundedYear": { "label": "Year founded" },
      "workCategories": { "label": "What you do", "DESIGN": "Design / engineering", "MANUFACTURE": "Equipment manufacturing", "SUPPLY": "Equipment supply", "INSTALLATION": "Installation / construction", "COMMISSIONING": "Commissioning", "MAINTENANCE": "Maintenance / O&M" },
      "renewableTypes": { "label": "Renewable types", "SOLAR": "Solar", "WIND": "Wind", "HYDRO": "Hydro", "BIOMASS": "Biomass / biogas", "GEOTHERMAL": "Geothermal", "HYBRID": "Hybrid" },
      "countriesServed": { "label": "Countries served (ISO-2 codes, comma-separated)" },
      "bio": { "label": "About your company (100–2000 chars)" },
      "websiteUrl": { "label": "Website URL" },
      "logoUrl": { "label": "Logo URL" },
      "contactEmail": { "label": "Contact email" },
      "contactPhone": { "label": "Contact phone (E.164)" }
    },
    "status": {
      "PENDING": "Pending review", "APPROVED": "Approved", "REJECTED": "Rejected", "SUSPENDED": "Suspended"
    },
    "action": {
      "submit": "Submit registration",
      "save": "Save changes",
      "edit": "Edit",
      "withdraw": "Withdraw registration",
      "back": "Back to list",
      "newContractor": "Register new company",
      "confirmWithdraw": "Are you sure? This deletes the registration."
    },
    "error": {
      "notEditable": "This registration is being processed and can no longer be edited."
    }
  }
},
"admin": {
  "contractor": {
    "title": "Contractors",
    "filter": { "status": "Status", "country": "Country", "entityType": "Entity type", "all": "All" },
    "table": { "createdAt": "Created", "owner": "Owner", "displayName": "Name", "entityType": "Type", "country": "Country", "status": "Status" },
    "action": { "setStatus": "Change status", "adminNote": "Internal note (required)", "submit": "Apply", "approve": "Approve", "reject": "Reject" }
  }
}
```

- [ ] **Step 2: Translate to RU**

Mirror the structure in `messages/ru.json`. Key translations:

- `sidebar.contractor` → `"Моя компания"`
- `contractor.title` → `"Моя компания"`
- `contractor.empty` → `"Вы ещё не зарегистрировали компанию."`
- `contractor.newButton` → `"+ Зарегистрировать компанию"`
- `new.title` → `"Регистрация компании"`
- `section.identity/work/contact` → `"Реквизиты" / "Чем занимаетесь" / "Контакты и профиль"`
- `field.entityType.{label,LEGAL_ENTITY,SOLE_TRADER,INDIVIDUAL}` → `"Тип" / "Юр.лицо (ООО / s.r.o. / a.s.)" / "ИП / OSVČ / ФОП" / "Физлицо-специалист"`
- `field.displayName.label` → `"Название компании"`
- `field.legalName.label` → `"Полное юридическое название"`
- `field.registrationNumber.label` → `"Регистрационный номер (IČO / EDRPOU / др.)"`
- `field.country.label` → `"Страна регистрации"`
- `field.city.label` → `"Город"`
- `field.foundedYear.label` → `"Год основания"`
- `field.workCategories.{label,...}` → `"Чем занимаетесь" / "Проектирование" / "Производство оборудования" / "Поставка оборудования" / "Монтаж / стройработы" / "Пусконаладка" / "Сервис / O&M"`
- `field.renewableTypes.{label,...}` → `"Типы источников" / "Солнце" / "Ветер" / "Гидро" / "Биомасса / биогаз" / "Геотермал" / "Гибрид"`
- `field.countriesServed.label` → `"Страны работы (ISO-2 коды, через запятую)"`
- `field.bio.label` → `"О компании (100–2000 знаков)"`
- `field.websiteUrl.label` → `"URL сайта"`
- `field.logoUrl.label` → `"URL логотипа"`
- `field.contactEmail.label` → `"Email для связи"`
- `field.contactPhone.label` → `"Телефон (E.164)"`
- `status.{PENDING,APPROVED,REJECTED,SUSPENDED}` → `"На модерации" / "Одобрена" / "Отклонена" / "Заморожена"`
- `action.{submit,save,edit,withdraw,back,newContractor,confirmWithdraw}` → `"Отправить заявку" / "Сохранить" / "Редактировать" / "Отозвать заявку" / "К списку" / "Зарегистрировать новую" / "Уверены? Заявка удаляется."`
- `error.notEditable` → `"Заявка обрабатывается и больше не редактируется."`
- `admin.contractor.title` → `"Подрядчики"`
- `admin.contractor.filter.{status,country,entityType,all}` → `"Статус" / "Страна" / "Тип" / "Все"`
- `admin.contractor.table.{createdAt,owner,displayName,entityType,country,status}` → `"Создана" / "Владелец" / "Название" / "Тип" / "Страна" / "Статус"`
- `admin.contractor.action.{setStatus,adminNote,submit,approve,reject}` → `"Изменить статус" / "Внутренний комментарий (обязательно)" / "Применить" / "Одобрить" / "Отклонить"`

- [ ] **Step 3: Translate to SK**

Mirror in `messages/sk.json`:

- `sidebar.contractor` → `"Moja firma"`
- `contractor.title` → `"Moja firma"`
- `contractor.empty` → `"Zatiaľ ste si nezaregistrovali firmu."`
- `contractor.newButton` → `"+ Zaregistrovať firmu"`
- `new.title` → `"Registrácia firmy"`
- `section.identity/work/contact` → `"Identita firmy" / "Čo robíte" / "Kontakt a profil"`
- `field.entityType.{label,LEGAL_ENTITY,SOLE_TRADER,INDIVIDUAL}` → `"Typ subjektu" / "Právnická osoba (s.r.o. / a.s.)" / "Živnostník (OSVČ)" / "Individuálny špecialista"`
- `field.displayName.label` → `"Názov firmy"`
- `field.legalName.label` → `"Plný právny názov"`
- `field.registrationNumber.label` → `"IČO / registračné číslo"`
- `field.country.label` → `"Krajina sídla"`
- `field.city.label` → `"Mesto"`
- `field.foundedYear.label` → `"Rok založenia"`
- `field.workCategories.{...}` → `"Čo robíte" / "Projektovanie / inžiniering" / "Výroba zariadení" / "Dodávka zariadení" / "Inštalácia / stavebné práce" / "Uvedenie do prevádzky" / "Servis / O&M"`
- `field.renewableTypes.{...}` → `"Typy zdrojov" / "Solárne" / "Veterné" / "Vodné" / "Biomasa / bioplyn" / "Geotermálne" / "Hybridné"`
- `field.countriesServed.label` → `"Krajiny pôsobenia (ISO-2 kódy)"`
- `field.bio.label` → `"O firme (100–2000 znakov)"`
- `field.websiteUrl.label` → `"URL webu"`
- `field.logoUrl.label` → `"URL loga"`
- `field.contactEmail.label` → `"Kontaktný email"`
- `field.contactPhone.label` → `"Kontaktný telefón (E.164)"`
- `status.{PENDING,APPROVED,REJECTED,SUSPENDED}` → `"Čaká na schválenie" / "Schválené" / "Zamietnuté" / "Pozastavené"`
- `action.{submit,save,edit,withdraw,back,newContractor,confirmWithdraw}` → `"Odoslať žiadosť" / "Uložiť" / "Upraviť" / "Stiahnuť žiadosť" / "Späť na zoznam" / "Zaregistrovať novú" / "Naozaj? Žiadosť sa zmaže."`
- `error.notEditable` → `"Žiadosť sa spracováva a už nie je možné ju upraviť."`
- `admin.contractor.title` → `"Dodávatelia"`
- `admin.contractor.filter.{status,country,entityType,all}` → `"Stav" / "Krajina" / "Typ" / "Všetko"`
- `admin.contractor.table.{createdAt,owner,displayName,entityType,country,status}` → `"Vytvorené" / "Vlastník" / "Názov" / "Typ" / "Krajina" / "Stav"`
- `admin.contractor.action.{setStatus,adminNote,submit,approve,reject}` → `"Zmeniť stav" / "Interná poznámka (povinné)" / "Použiť" / "Schváliť" / "Zamietnuť"`

- [ ] **Step 4: Verify the JSON files parse**

Run: `node -e "['en','ru','sk'].forEach(l => JSON.parse(require('fs').readFileSync('messages/'+l+'.json','utf-8')))"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add messages/en.json messages/ru.json messages/sk.json
git commit -m "feat(contractor): add EN/RU/SK i18n strings"
```

---

## Task 10: Sidebar links (/me + /admin)

**Files:**
- Modify: `src/app/[locale]/me/layout.tsx`
- Modify: `src/app/[locale]/admin/layout.tsx`

- [ ] **Step 1: Add `/me/contractor` link**

In `src/app/[locale]/me/layout.tsx`, insert between Build requests and Settings:

```tsx
<SidebarLink href={`/${locale}/me/contractor`}>
  🏢 {t("contractor")}
</SidebarLink>
```

- [ ] **Step 2: Add `/admin/contractors` link**

In `src/app/[locale]/admin/layout.tsx`, the current `<nav>` block has only one Link to `/admin/build-requests`. The translation namespace is currently `admin.buildRequest` — but we now have two admin sections. Refactor the layout to load a broader namespace.

Replace the line `const t = await getTranslations("admin.buildRequest");` with:

```tsx
const tNav = await getTranslations("admin");
```

And replace the existing nav Link with TWO Links:

```tsx
<nav className="flex md:flex-col">
  <Link
    href={`/${locale}/admin/build-requests`}
    prefetch={false}
    className="text-[14px] text-muted hover:text-foreground py-2 md:py-2.5"
  >
    🔧 {tNav("buildRequest.title")}
  </Link>
  <Link
    href={`/${locale}/admin/contractors`}
    prefetch={false}
    className="text-[14px] text-muted hover:text-foreground py-2 md:py-2.5"
  >
    🏢 {tNav("contractor.title")}
  </Link>
</nav>
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/me/layout.tsx src/app/[locale]/admin/layout.tsx
git commit -m "feat(contractor): add sidebar links in /me and /admin"
```

---

## Task 11: `/me/contractor` list page

**Files:**
- Create: `src/app/[locale]/me/contractor/page.tsx`

- [ ] **Step 1: Implement**

Create `src/app/[locale]/me/contractor/page.tsx`:

```tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function ContractorListPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/contractor`);

  const memberships = await prisma.contractorMember.findMany({
    where: { userId: session.user.id },
    orderBy: { addedAt: "desc" },
    include: {
      contractor: {
        select: {
          id: true, slug: true, displayName: true, country: true, city: true,
          status: true, entityType: true, createdAt: true,
        },
      },
    },
  });

  const t = await getTranslations("cabinet.contractor");

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-[28px] md:text-[32px] font-bold tracking-[-0.02em]">{t("title")}</h1>
        <Link
          href={`/${locale}/me/contractor/new`}
          className="px-4 py-2 bg-foreground text-bg rounded text-sm"
        >
          {t("action.newContractor")}
        </Link>
      </div>

      {memberships.length === 0 ? (
        <p className="text-muted">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {memberships.map((m) => (
            <li key={m.contractorId} className="py-4">
              <Link
                href={`/${locale}/me/contractor/${m.contractorId}`}
                className="flex justify-between items-center hover:opacity-80"
              >
                <div>
                  <div className="font-medium">{m.contractor.displayName}</div>
                  <div className="text-sm text-muted">
                    {m.contractor.city}, {m.contractor.country} · {t(`field.entityType.${m.contractor.entityType}`)} · {m.contractor.createdAt.toISOString().slice(0, 10)}
                  </div>
                </div>
                <span className={`text-xs px-2 py-1 rounded ${statusClass(m.contractor.status)}`}>
                  {t(`status.${m.contractor.status}`)}
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
    case "PENDING": return "bg-yellow-100 text-yellow-700";
    case "APPROVED": return "bg-green-100 text-green-700";
    case "REJECTED": return "bg-gray-100 text-gray-700";
    case "SUSPENDED": return "bg-red-100 text-red-700";
    default: return "bg-gray-100 text-gray-700";
  }
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/me/contractor/page.tsx
git commit -m "feat(contractor): add /me/contractor list page"
```

---

## Task 12: Form component + label helper + `/me/contractor/new` page

**Files:**
- Create: `src/lib/contractor-form-labels.ts`
- Create: `src/components/cabinet/contractor-form.tsx`
- Create: `src/app/[locale]/me/contractor/new/page.tsx`

- [ ] **Step 0: Label helper**

Create `src/lib/contractor-form-labels.ts`:

```ts
import { getTranslations } from "next-intl/server";

export type ContractorFormLabels = {
  section: { identity: string; work: string; contact: string };
  field: Record<string, Record<string, string>>;
  action: { submit: string; save: string };
};

export async function getContractorFormLabels(): Promise<ContractorFormLabels> {
  const t = await getTranslations("cabinet.contractor");
  return {
    section: {
      identity: t("new.section.identity"),
      work: t("new.section.work"),
      contact: t("new.section.contact"),
    },
    field: {
      entityType: { label: t("field.entityType.label"), LEGAL_ENTITY: t("field.entityType.LEGAL_ENTITY"), SOLE_TRADER: t("field.entityType.SOLE_TRADER"), INDIVIDUAL: t("field.entityType.INDIVIDUAL") },
      displayName: { label: t("field.displayName.label") },
      legalName: { label: t("field.legalName.label") },
      registrationNumber: { label: t("field.registrationNumber.label") },
      country: { label: t("field.country.label") },
      city: { label: t("field.city.label") },
      foundedYear: { label: t("field.foundedYear.label") },
      workCategories: { label: t("field.workCategories.label"), DESIGN: t("field.workCategories.DESIGN"), MANUFACTURE: t("field.workCategories.MANUFACTURE"), SUPPLY: t("field.workCategories.SUPPLY"), INSTALLATION: t("field.workCategories.INSTALLATION"), COMMISSIONING: t("field.workCategories.COMMISSIONING"), MAINTENANCE: t("field.workCategories.MAINTENANCE") },
      renewableTypes: { label: t("field.renewableTypes.label"), SOLAR: t("field.renewableTypes.SOLAR"), WIND: t("field.renewableTypes.WIND"), HYDRO: t("field.renewableTypes.HYDRO"), BIOMASS: t("field.renewableTypes.BIOMASS"), GEOTHERMAL: t("field.renewableTypes.GEOTHERMAL"), HYBRID: t("field.renewableTypes.HYBRID") },
      countriesServed: { label: t("field.countriesServed.label") },
      bio: { label: t("field.bio.label") },
      websiteUrl: { label: t("field.websiteUrl.label") },
      logoUrl: { label: t("field.logoUrl.label") },
      contactEmail: { label: t("field.contactEmail.label") },
      contactPhone: { label: t("field.contactPhone.label") },
    },
    action: { submit: t("action.submit"), save: t("action.save") },
  };
}
```

- [ ] **Step 1: Form component**

Create `src/components/cabinet/contractor-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ContractorInput } from "@/lib/contractor-schema";
import type { ContractorFormLabels } from "@/lib/contractor-form-labels";
import { createContractor, updateContractor } from "@/app/[locale]/me/contractor/actions";

type Mode = { kind: "create" } | { kind: "edit"; id: string };

const WORK_VALUES = ["DESIGN", "MANUFACTURE", "SUPPLY", "INSTALLATION", "COMMISSIONING", "MAINTENANCE"] as const;
const RENEWABLE_VALUES = ["SOLAR", "WIND", "HYDRO", "BIOMASS", "GEOTHERMAL", "HYBRID"] as const;
const ENTITY_VALUES = ["LEGAL_ENTITY", "SOLE_TRADER", "INDIVIDUAL"] as const;

type Props = {
  mode: Mode;
  locale: string;
  initial?: Partial<ContractorInput>;
  labels: ContractorFormLabels;
};

export function ContractorForm({ mode, locale, initial, labels }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const [entityType, setEntityType] = useState<"LEGAL_ENTITY" | "SOLE_TRADER" | "INDIVIDUAL">(
    initial?.entityType ?? "LEGAL_ENTITY",
  );
  const [workCategories, setWorkCategories] = useState<string[]>(
    (initial?.workCategories as string[] | undefined) ?? [],
  );
  const [renewableTypes, setRenewableTypes] = useState<string[]>(
    (initial?.renewableTypes as string[] | undefined) ?? [],
  );

  function toggle(list: string[], v: string, set: (xs: string[]) => void) {
    if (list.includes(v)) set(list.filter((x) => x !== v));
    else set([...list, v]);
  }

  async function onSubmit(formData: FormData) {
    setErrors({});
    setFormError(null);

    const countriesServedRaw = String(formData.get("countriesServed") ?? "");
    const countriesServed = countriesServedRaw
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    const foundedYearRaw = String(formData.get("foundedYear") ?? "");
    const foundedYear = foundedYearRaw ? Number(foundedYearRaw) : undefined;

    const input = {
      entityType,
      displayName: String(formData.get("displayName") ?? "").trim(),
      legalName: entityType === "LEGAL_ENTITY"
        ? String(formData.get("legalName") ?? "").trim() || undefined
        : undefined,
      registrationNumber: entityType !== "INDIVIDUAL"
        ? String(formData.get("registrationNumber") ?? "").trim() || undefined
        : undefined,
      country: String(formData.get("country") ?? "").toUpperCase(),
      city: String(formData.get("city") ?? "").trim(),
      foundedYear,
      workCategories: workCategories as ContractorInput["workCategories"],
      renewableTypes: renewableTypes as ContractorInput["renewableTypes"],
      countriesServed,
      bio: String(formData.get("bio") ?? ""),
      websiteUrl: String(formData.get("websiteUrl") ?? "").trim() || undefined,
      logoUrl: String(formData.get("logoUrl") ?? "").trim() || undefined,
      contactEmail: String(formData.get("contactEmail") ?? "").trim(),
      contactPhone: String(formData.get("contactPhone") ?? "").trim(),
    } as ContractorInput;

    startTransition(async () => {
      const result = mode.kind === "create"
        ? await createContractor(input)
        : await updateContractor(mode.id, input);

      if (!result.ok) {
        if (result.fieldErrors) setErrors(result.fieldErrors);
        if (result.formError) setFormError(result.formError);
        return;
      }
      const targetId = result.id ?? (mode.kind === "edit" ? mode.id : "");
      router.push(`/${locale}/me/contractor/${targetId}`);
    });
  }

  return (
    <form action={onSubmit} className="space-y-8 max-w-2xl">
      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold">{labels.section.identity}</legend>

        <div>
          <label className="block text-sm mb-1">{labels.field.entityType.label}</label>
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value as typeof entityType)}
            className="border border-hairline rounded px-3 py-2 w-full"
          >
            {ENTITY_VALUES.map((v) => (
              <option key={v} value={v}>{labels.field.entityType[v]}</option>
            ))}
          </select>
        </div>

        <input name="displayName" defaultValue={initial?.displayName ?? ""} placeholder={labels.field.displayName.label} className="border border-hairline rounded px-3 py-2 w-full" />
        {errors.displayName && <p className="text-red-600 text-xs">{errors.displayName}</p>}

        {entityType === "LEGAL_ENTITY" && (
          <>
            <input name="legalName" defaultValue={initial?.legalName ?? ""} placeholder={labels.field.legalName.label} className="border border-hairline rounded px-3 py-2 w-full" />
            {errors.legalName && <p className="text-red-600 text-xs">{errors.legalName}</p>}
          </>
        )}

        {entityType !== "INDIVIDUAL" && (
          <>
            <input name="registrationNumber" defaultValue={initial?.registrationNumber ?? ""} placeholder={labels.field.registrationNumber.label} className="border border-hairline rounded px-3 py-2 w-full" />
            {errors.registrationNumber && <p className="text-red-600 text-xs">{errors.registrationNumber}</p>}
          </>
        )}

        <div className="flex gap-2">
          <input name="country" defaultValue={initial?.country ?? ""} placeholder="SK" maxLength={2} className="border border-hairline rounded px-3 py-2 w-20 uppercase" />
          <input name="city" defaultValue={initial?.city ?? ""} placeholder={labels.field.city.label} className="border border-hairline rounded px-3 py-2 flex-1" />
        </div>
        <input name="foundedYear" type="number" min="1900" defaultValue={initial?.foundedYear ?? ""} placeholder={labels.field.foundedYear.label} className="border border-hairline rounded px-3 py-2 w-40" />
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold">{labels.section.work}</legend>

        <div>
          <p className="text-sm mb-2">{labels.field.workCategories.label}</p>
          <div className="grid grid-cols-2 gap-2">
            {WORK_VALUES.map((v) => (
              <label key={v} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={workCategories.includes(v)}
                  onChange={() => toggle(workCategories, v, setWorkCategories)}
                />
                {labels.field.workCategories[v]}
              </label>
            ))}
          </div>
          {errors.workCategories && <p className="text-red-600 text-xs mt-1">{errors.workCategories}</p>}
        </div>

        <div>
          <p className="text-sm mb-2">{labels.field.renewableTypes.label}</p>
          <div className="grid grid-cols-2 gap-2">
            {RENEWABLE_VALUES.map((v) => (
              <label key={v} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={renewableTypes.includes(v)}
                  onChange={() => toggle(renewableTypes, v, setRenewableTypes)}
                />
                {labels.field.renewableTypes[v]}
              </label>
            ))}
          </div>
          {errors.renewableTypes && <p className="text-red-600 text-xs mt-1">{errors.renewableTypes}</p>}
        </div>

        <input name="countriesServed" defaultValue={(initial?.countriesServed as string[] | undefined)?.join(", ") ?? ""} placeholder={labels.field.countriesServed.label} className="border border-hairline rounded px-3 py-2 w-full uppercase" />
        {errors.countriesServed && <p className="text-red-600 text-xs">{errors.countriesServed}</p>}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold">{labels.section.contact}</legend>

        <textarea name="bio" defaultValue={initial?.bio ?? ""} rows={6} maxLength={2000} placeholder={labels.field.bio.label} className="border border-hairline rounded px-3 py-2 w-full" />
        {errors.bio && <p className="text-red-600 text-xs">{errors.bio}</p>}

        <input name="websiteUrl" type="url" defaultValue={initial?.websiteUrl ?? ""} placeholder={labels.field.websiteUrl.label} className="border border-hairline rounded px-3 py-2 w-full" />
        <input name="logoUrl" type="url" defaultValue={initial?.logoUrl ?? ""} placeholder={labels.field.logoUrl.label} className="border border-hairline rounded px-3 py-2 w-full" />
        <input name="contactEmail" type="email" defaultValue={initial?.contactEmail ?? ""} placeholder={labels.field.contactEmail.label} className="border border-hairline rounded px-3 py-2 w-full" />
        {errors.contactEmail && <p className="text-red-600 text-xs">{errors.contactEmail}</p>}
        <input name="contactPhone" type="tel" defaultValue={initial?.contactPhone ?? ""} placeholder={labels.field.contactPhone.label} className="border border-hairline rounded px-3 py-2 w-full" />
        {errors.contactPhone && <p className="text-red-600 text-xs">{errors.contactPhone}</p>}
      </fieldset>

      {formError && <p className="text-red-600 text-sm">{formError}</p>}

      <div className="sticky bottom-0 bg-bg pt-4 border-t border-hairline">
        <button
          type="submit"
          disabled={pending}
          className="px-6 py-2 bg-foreground text-bg rounded disabled:opacity-50"
        >
          {mode.kind === "create" ? labels.action.submit : labels.action.save}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: New page**

Create `src/app/[locale]/me/contractor/new/page.tsx`:

```tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { ContractorForm } from "@/components/cabinet/contractor-form";
import { getContractorFormLabels } from "@/lib/contractor-form-labels";

export default async function NewContractorPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/contractor/new`);

  const [t, labels] = await Promise.all([
    getTranslations("cabinet.contractor"),
    getContractorFormLabels(),
  ]);

  return (
    <div>
      <Link href={`/${locale}/me/contractor`} className="text-sm text-muted">← {t("action.back")}</Link>
      <h1 className="text-[28px] font-bold mt-2 mb-6">{t("new.title")}</h1>
      <ContractorForm mode={{ kind: "create" }} locale={locale} labels={labels} />
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/contractor-form-labels.ts \
  src/components/cabinet/contractor-form.tsx \
  src/app/[locale]/me/contractor/new/page.tsx
git commit -m "feat(contractor): add form component + label helper + /new page"
```

---

## Task 13: `/me/contractor/[id]` detail page + withdraw button

**Files:**
- Create: `src/components/cabinet/withdraw-contractor-button.tsx`
- Create: `src/app/[locale]/me/contractor/[id]/page.tsx`

- [ ] **Step 1: Withdraw button (client)**

Create `src/components/cabinet/withdraw-contractor-button.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { withdrawContractor } from "@/app/[locale]/me/contractor/actions";

type Props = { id: string; label: string; confirmText: string; locale: string };

export function WithdrawContractorButton({ id, label, confirmText, locale }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm(confirmText)) return;
        startTransition(async () => {
          const r = await withdrawContractor(id);
          if (r.ok) router.push(`/${locale}/me/contractor`);
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

- [ ] **Step 2: Detail page**

Create `src/app/[locale]/me/contractor/[id]/page.tsx`:

```tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { WithdrawContractorButton } from "@/components/cabinet/withdraw-contractor-button";

export default async function ContractorDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/contractor/${id}`);

  const member = await prisma.contractorMember.findUnique({
    where: { contractorId_userId: { contractorId: id, userId: session.user.id } },
  });
  if (!member) notFound();

  const c = await prisma.contractor.findUnique({ where: { id } });
  if (!c) notFound();

  const t = await getTranslations("cabinet.contractor");

  return (
    <div className="max-w-2xl">
      <Link href={`/${locale}/me/contractor`} className="text-sm text-muted">← {t("action.back")}</Link>
      <h1 className="text-[28px] font-bold mt-2 mb-6">{c.displayName}</h1>

      <div className="flex items-center gap-4 mb-8">
        <span className={`text-xs px-2 py-1 rounded ${statusClass(c.status)}`}>
          {t(`status.${c.status}`)}
        </span>
        {c.status === "PENDING" && member.role === "OWNER" && (
          <>
            <Link
              href={`/${locale}/me/contractor/${id}/edit`}
              className="text-sm underline"
            >
              {t("action.edit")}
            </Link>
            <WithdrawContractorButton
              id={id}
              locale={locale}
              label={t("action.withdraw")}
              confirmText={t("action.confirmWithdraw")}
            />
          </>
        )}
      </div>

      <dl className="grid grid-cols-[180px_1fr] gap-y-2 text-sm">
        <dt className="text-muted">{t("field.entityType.label")}</dt><dd>{t(`field.entityType.${c.entityType}`)}</dd>
        {c.legalName && <><dt className="text-muted">{t("field.legalName.label")}</dt><dd>{c.legalName}</dd></>}
        {c.registrationNumber && <><dt className="text-muted">{t("field.registrationNumber.label")}</dt><dd>{c.registrationNumber}</dd></>}
        <dt className="text-muted">{t("field.country.label")}</dt><dd>{c.country}, {c.city}</dd>
        {c.foundedYear != null && <><dt className="text-muted">{t("field.foundedYear.label")}</dt><dd>{c.foundedYear}</dd></>}
        <dt className="text-muted">{t("field.workCategories.label")}</dt>
        <dd>{c.workCategories.map(w => t(`field.workCategories.${w}`)).join(", ")}</dd>
        <dt className="text-muted">{t("field.renewableTypes.label")}</dt>
        <dd>{c.renewableTypes.map(r => t(`field.renewableTypes.${r}`)).join(", ")}</dd>
        <dt className="text-muted">{t("field.countriesServed.label")}</dt><dd>{c.countriesServed.join(", ")}</dd>
        <dt className="text-muted">{t("field.contactEmail.label")}</dt><dd>{c.contactEmail}</dd>
        <dt className="text-muted">{t("field.contactPhone.label")}</dt><dd>{c.contactPhone}</dd>
        {c.websiteUrl && <><dt className="text-muted">{t("field.websiteUrl.label")}</dt><dd><a href={c.websiteUrl} className="underline" target="_blank" rel="noreferrer">{c.websiteUrl}</a></dd></>}
        <dt className="text-muted">{t("field.bio.label")}</dt><dd className="whitespace-pre-wrap">{c.bio}</dd>
      </dl>
    </div>
  );
}

function statusClass(s: string) {
  switch (s) {
    case "PENDING": return "bg-yellow-100 text-yellow-700";
    case "APPROVED": return "bg-green-100 text-green-700";
    case "REJECTED": return "bg-gray-100 text-gray-700";
    case "SUSPENDED": return "bg-red-100 text-red-700";
    default: return "bg-gray-100 text-gray-700";
  }
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/cabinet/withdraw-contractor-button.tsx \
  src/app/[locale]/me/contractor/[id]/page.tsx
git commit -m "feat(contractor): add /me/contractor/[id] detail page with withdraw button"
```

---

## Task 14: `/me/contractor/[id]/edit` page

**Files:**
- Create: `src/app/[locale]/me/contractor/[id]/edit/page.tsx`

- [ ] **Step 1: Implement**

```tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ContractorForm } from "@/components/cabinet/contractor-form";
import { getContractorFormLabels } from "@/lib/contractor-form-labels";

export default async function EditContractorPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login`);

  const member = await prisma.contractorMember.findUnique({
    where: { contractorId_userId: { contractorId: id, userId: session.user.id } },
  });
  if (!member || member.role !== "OWNER") notFound();

  const c = await prisma.contractor.findUnique({ where: { id } });
  if (!c) notFound();

  if (c.status !== "PENDING") {
    redirect(`/${locale}/me/contractor/${id}?notEditable=1`);
  }

  const [t, labels] = await Promise.all([
    getTranslations("cabinet.contractor"),
    getContractorFormLabels(),
  ]);

  return (
    <div>
      <Link href={`/${locale}/me/contractor/${id}`} className="text-sm text-muted">← {t("action.back")}</Link>
      <h1 className="text-[28px] font-bold mt-2 mb-6">{t("action.edit")}</h1>
      <ContractorForm
        mode={{ kind: "edit", id }}
        locale={locale}
        labels={labels}
        initial={{
          entityType: c.entityType,
          displayName: c.displayName,
          legalName: c.legalName ?? undefined,
          registrationNumber: c.registrationNumber ?? undefined,
          country: c.country,
          city: c.city,
          foundedYear: c.foundedYear ?? undefined,
          workCategories: c.workCategories,
          renewableTypes: c.renewableTypes,
          countriesServed: c.countriesServed,
          bio: c.bio,
          websiteUrl: c.websiteUrl ?? undefined,
          logoUrl: c.logoUrl ?? undefined,
          contactEmail: c.contactEmail,
          contactPhone: c.contactPhone,
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/me/contractor/[id]/edit/page.tsx
git commit -m "feat(contractor): add /me/contractor/[id]/edit page"
```

---

## Task 15: `/admin/contractors` list with filters

**Files:**
- Create: `src/app/[locale]/admin/contractors/page.tsx`

- [ ] **Step 1: Implement**

```tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { ContractorStatus, ContractorEntityType } from "@prisma/client";

const VALID_STATUSES: ContractorStatus[] = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"];
const VALID_ENTITY: ContractorEntityType[] = ["LEGAL_ENTITY", "SOLE_TRADER", "INDIVIDUAL"];

export default async function AdminContractorsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; country?: string; entityType?: string; page?: string }>;
}) {
  const { locale } = await params;
  const { status: rs, country: rc, entityType: re, page: rp } = await searchParams;
  setRequestLocale(locale);

  const status = VALID_STATUSES.includes(rs as ContractorStatus) ? (rs as ContractorStatus) : undefined;
  const country = rc?.match(/^[A-Z]{2}$/) ? rc : undefined;
  const entityType = VALID_ENTITY.includes(re as ContractorEntityType) ? (re as ContractorEntityType) : undefined;
  const page = Math.max(1, Number(rp) || 1);
  const pageSize = 50;

  const where = {
    ...(status ? { status } : {}),
    ...(country ? { country } : {}),
    ...(entityType ? { entityType } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.contractor.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        members: { where: { role: "OWNER" }, take: 1, include: { user: { select: { username: true } } } },
      },
    }),
    prisma.contractor.count({ where }),
  ]);

  const t = await getTranslations("admin.contractor");

  return (
    <div>
      <h1 className="text-[28px] font-bold mb-6">{t("title")}</h1>

      <form className="flex gap-2 mb-6 text-sm">
        <select name="status" defaultValue={status ?? ""} className="border border-hairline rounded px-2 py-1">
          <option value="">{t("filter.all")}</option>
          {VALID_STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}
        </select>
        <input name="country" defaultValue={country ?? ""} placeholder="SK" maxLength={2} className="border border-hairline rounded px-2 py-1 w-20 uppercase" />
        <select name="entityType" defaultValue={entityType ?? ""} className="border border-hairline rounded px-2 py-1">
          <option value="">{t("filter.all")}</option>
          {VALID_ENTITY.map((e) => (<option key={e} value={e}>{e}</option>))}
        </select>
        <button type="submit" className="px-3 py-1 border border-hairline rounded">Apply</button>
      </form>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-hairline text-left text-muted">
            <th className="py-2">{t("table.createdAt")}</th>
            <th>{t("table.owner")}</th>
            <th>{t("table.displayName")}</th>
            <th>{t("table.entityType")}</th>
            <th>{t("table.country")}</th>
            <th>{t("table.status")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-b border-hairline">
              <td className="py-2">
                <Link href={`/${locale}/admin/contractors/${c.id}`} className="underline">
                  {c.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </Link>
              </td>
              <td>@{c.members[0]?.user.username ?? "—"}</td>
              <td>{c.displayName}</td>
              <td>{c.entityType}</td>
              <td>{c.country} {c.city}</td>
              <td>{c.status}</td>
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

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/admin/contractors/page.tsx
git commit -m "feat(admin): add /admin/contractors list with filters"
```

---

## Task 16: `/admin/contractors/[id]` detail + status form

**Files:**
- Create: `src/components/admin/contractor-status-form.tsx`
- Create: `src/app/[locale]/admin/contractors/[id]/page.tsx`

- [ ] **Step 1: Status form (client)**

Create `src/components/admin/contractor-status-form.tsx`:

```tsx
"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import type { ContractorStatus } from "@prisma/client";
import { adminSetContractorStatus } from "@/app/[locale]/admin/contractors/actions";

type Props = {
  id: string;
  currentStatus: ContractorStatus;
  allowedNext: ContractorStatus[];
  labels: { setStatus: string; adminNote: string; submit: string };
};

export function ContractorStatusForm({ id, currentStatus, allowedNext, labels }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<ContractorStatus | "">(allowedNext[0] ?? "");
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
      const r = await adminSetContractorStatus(id, target as ContractorStatus, note);
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
          onChange={(e) => setTarget(e.target.value as ContractorStatus)}
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

Create `src/app/[locale]/admin/contractors/[id]/page.tsx`:

```tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { ContractorStatus } from "@prisma/client";
import { ContractorStatusForm } from "@/components/admin/contractor-status-form";

const NEXT: Record<ContractorStatus, ContractorStatus[]> = {
  PENDING: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
  SUSPENDED: [],
};

export default async function AdminContractorDetail({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const c = await prisma.contractor.findUnique({
    where: { id },
    include: {
      members: {
        where: { role: "OWNER" },
        take: 1,
        include: { user: { select: { username: true, name: true, email: true, phone: true } } },
      },
    },
  });
  if (!c) notFound();

  const owner = c.members[0]?.user;
  const t = await getTranslations("admin.contractor");

  return (
    <div className="max-w-3xl space-y-6">
      <Link href={`/${locale}/admin/contractors`} className="text-sm text-muted">← Back</Link>
      <h1 className="text-[28px] font-bold">{c.displayName} <span className="text-sm text-muted">#{c.id.slice(0, 8)}</span></h1>

      <section className="border border-hairline rounded p-4">
        <h2 className="text-sm uppercase tracking-wide text-muted mb-2">Owner</h2>
        {owner ? (
          <>
            <p><b>@{owner.username}</b> ({owner.name ?? "—"})</p>
            <p>Email: {owner.email ?? "—"}</p>
            <p>Phone: {owner.phone ?? "—"}</p>
          </>
        ) : (
          <p className="text-muted">No OWNER member</p>
        )}
      </section>

      <section className="border border-hairline rounded p-4">
        <h2 className="text-sm uppercase tracking-wide text-muted mb-2">Identity</h2>
        <p>Type: {c.entityType}</p>
        {c.legalName && <p>Legal: {c.legalName}</p>}
        {c.registrationNumber && <p>Reg #: {c.registrationNumber}</p>}
        <p>HQ: {c.country}, {c.city}</p>
        {c.foundedYear != null && <p>Founded: {c.foundedYear}</p>}
      </section>

      <section className="border border-hairline rounded p-4">
        <h2 className="text-sm uppercase tracking-wide text-muted mb-2">What they do</h2>
        <p>Work: {c.workCategories.join(", ")}</p>
        <p>Renewables: {c.renewableTypes.join(", ")}</p>
        <p>Countries served: {c.countriesServed.join(", ")}</p>
      </section>

      <section className="border border-hairline rounded p-4">
        <h2 className="text-sm uppercase tracking-wide text-muted mb-2">Contact & profile</h2>
        <p>Email: {c.contactEmail}</p>
        <p>Phone: {c.contactPhone}</p>
        {c.websiteUrl && <p>Website: <a href={c.websiteUrl} className="underline" target="_blank" rel="noreferrer">{c.websiteUrl}</a></p>}
        {c.logoUrl && <p>Logo: <a href={c.logoUrl} className="underline" target="_blank" rel="noreferrer">{c.logoUrl}</a></p>}
        <p className="mt-2 whitespace-pre-wrap text-sm">{c.bio}</p>
      </section>

      <section className="border border-hairline rounded p-4">
        <h2 className="text-sm uppercase tracking-wide text-muted mb-2">Status</h2>
        <p>Current: <b>{c.status}</b></p>
        {c.adminNote && <p className="text-sm text-muted mt-2">Note: {c.adminNote}</p>}
      </section>

      <ContractorStatusForm
        id={c.id}
        currentStatus={c.status}
        allowedNext={NEXT[c.status]}
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

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/admin/contractors/[id]/page.tsx \
  src/components/admin/contractor-status-form.tsx
git commit -m "feat(admin): add /admin/contractors/[id] detail with status form"
```

---

## Task 17: E2E happy path (Playwright)

**Files:**
- Create: `tests/e2e/contractor-flow.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const OWNER = { username: "e2e_ctr_owner", password: "Pass1234" };
const ADMIN = { username: "e2e_ctr_admin", password: "Pass1234" };

test.beforeAll(async () => {
  const ownerHash = await bcrypt.hash(OWNER.password, 10);
  const adminHash = await bcrypt.hash(ADMIN.password, 10);
  await prisma.user.upsert({
    where: { username: OWNER.username },
    update: { passwordHash: ownerHash, name: "E2E Contractor Owner" },
    create: { username: OWNER.username, passwordHash: ownerHash, name: "E2E Contractor Owner" },
  });
  await prisma.user.upsert({
    where: { username: ADMIN.username },
    update: { passwordHash: adminHash, role: "ADMIN" },
    create: { username: ADMIN.username, passwordHash: adminHash, role: "ADMIN" },
  });
  await prisma.contractor.deleteMany({
    where: { members: { some: { user: { username: { in: [OWNER.username, ADMIN.username] } } } } },
  });
});

test.afterAll(async () => {
  await prisma.contractor.deleteMany({
    where: { members: { some: { user: { username: { in: [OWNER.username, ADMIN.username] } } } } },
  });
  await prisma.$disconnect();
});

test("owner registers a contractor, admin approves it", async ({ page }) => {
  // Owner logs in
  await page.goto("/en/login");
  await page.fill('input[name="username"]', OWNER.username);
  await page.fill('input[name="password"]', OWNER.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/en\/me(\/|$)/);

  // Registration form
  await page.goto("/en/me/contractor/new");
  await page.fill('input[name="displayName"]', "E2E Solar s.r.o.");
  await page.fill('input[name="legalName"]', "E2E Solar Renewable Energy s.r.o.");
  await page.fill('input[name="registrationNumber"]', "11223344");
  await page.fill('input[name="country"]', "sk");
  await page.fill('input[name="city"]', "Bratislava");

  // multi-select checkboxes — first DESIGN and INSTALLATION; first SOLAR
  await page.locator('label:has-text("Design / engineering") input[type="checkbox"]').check();
  await page.locator('label:has-text("Installation / construction") input[type="checkbox"]').check();
  await page.locator('label:has-text("Solar") input[type="checkbox"]').check();

  await page.fill('input[name="countriesServed"]', "SK, CZ");
  await page.fill('textarea[name="bio"]', "We design and install solar power stations across Slovakia and Czech Republic. ".repeat(3));
  await page.fill('input[name="contactEmail"]', "info@e2e-solar.sk");
  await page.fill('input[name="contactPhone"]', "+421900111222");

  await page.click('button[type="submit"]');
  await page.waitForURL(/\/en\/me\/contractor\/[a-z0-9]+/);
  await expect(page.locator("text=Pending review")).toBeVisible();

  const detailUrl = page.url();
  const contractorId = detailUrl.split("/").pop()!;

  // Switch to admin (clear cookies path — same as V1 build-request e2e)
  await page.context().clearCookies();
  await page.goto("/en/login");
  await page.fill('input[name="username"]', ADMIN.username);
  await page.fill('input[name="password"]', ADMIN.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/en\/me(\/|$)/);

  // Admin approves
  await page.goto(`/en/admin/contractors/${contractorId}`);
  await page.fill('textarea', "Looks legit, approving for V2b listing");
  await page.click('button:has-text("Apply")');
  await expect(page.locator("text=Current: APPROVED")).toBeVisible();
});
```

- [ ] **Step 2: Run it**

Pre-flight:
- `poolwatt-web` must be running with fresh build (`npm run build && pm2 restart poolwatt-web` if needed)
- `DATABASE_URL` must be loaded in shell: `set -a && source .env.local && set +a`

Then: `npx playwright test contractor-flow`
Expected: 1 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/contractor-flow.spec.ts
git commit -m "test(contractor): add e2e happy-path spec"
```

---

## Task 18: README roadmap entry

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a line under the existing roadmap section**

```markdown
- [x] **Contractor cabinet (V2a)** — homeowner registers a contractor company at `/me/contractor`; admin triages at `/admin/contractors`. See `docs/superpowers/specs/2026-05-30-contractor-cabinet-v2a-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(contractor): add V2a roadmap entry"
```

---

## Done criteria

- All 18 tasks committed.
- `npm run lint` clean (no NEW errors).
- `npm run test` green (unit + integration).
- `npx playwright test contractor-flow` green.
- Manually verified: signed-in user can register / view / edit / withdraw; admin can see all + approve / reject with note.
- Spec coverage: §1–10 each have at least one task implementing them. §11 (V2b/c/d deferrals) intentionally untouched.

## Deferred to future plans (not in this plan)

- V2b: public `/contractors` listing + homepage block.
- V2c: teammate invitations, post-approval profile editing, APPROVED↔SUSPENDED transitions.
- V2d: BuildRequest ↔ Contractor matching, claim, dual-status workflow.
- Logo / portfolio upload (needs blob storage).
- Translations for 26 non-EN/RU/SK locales.
- CAPTCHA on registration.
