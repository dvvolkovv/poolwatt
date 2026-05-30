# Public Contractor Listing V2b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build V2b — public-facing `/contractors` listing with two filters + `/contractors/[slug]` detail + homepage block of 6 newest approved contractors.

**Architecture:** Pure read-side over V2a's `Contractor` table. New `src/lib/contractor-queries.ts` enforces `APPROVED` filter + safe `PUBLIC_SELECT` (no `adminNote`). Server components for both routes. New `<ContractorCard>` shared between listing + homepage. No DB migrations, no server actions, no auth.

**Tech Stack:** Next.js 16 App Router, React 19 server components, Prisma 5, next-intl 4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-05-30-contractor-public-listing-v2b-design.md`

---

## Conventions across this plan

- **TDD** for the data layer (`contractor-queries.ts`). UI pages are verified by lint+tsc+e2e.
- **Test layout**: unit/integration tests co-located `*.test.ts`. E2E in `tests/e2e/`.
- **Commits**: one commit per task, message format `feat(contractor-public): <what>` (or `feat(homepage)` for the page.tsx change).
- **i18n**: EN + RU + SK at task time. Other 26 locales fall back to EN.
- **Path aliases**: `@/lib/*`, `@/components/*`. Use them everywhere.
- **Existing infra reused from V1/V2a**:
  - `vitest.config.ts` with `@/` alias + `loadEnv` of `.env.local` + `clearMocks: true`
  - Prisma `Contractor` table (V2a commit `67767af`) with 4 enums + index `[status, createdAt]` + `[country, status]`
  - i18n labels `cabinet.contractor.field.*` (V2a commit `bab3d70`) — REUSED for enum display (workCategories, renewableTypes, entityType)

---

## Task 1: Data access module `src/lib/contractor-queries.ts` (TDD)

**Files:**
- Create: `src/lib/contractor-queries.ts`
- Create: `src/lib/contractor-queries.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/contractor-queries.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  readApprovedContractors,
  readContractorBySlug,
  readNewestApprovedContractors,
} from "./contractor-queries";

const PREFIX = "test_pub_";

async function seedUser(username: string) {
  return prisma.user.upsert({
    where: { username },
    update: {},
    create: { username, passwordHash: "x" },
  });
}

async function seedContractor(opts: {
  slug: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";
  country: string;
  renewables: ("SOLAR" | "WIND" | "HYDRO" | "BIOMASS" | "GEOTHERMAL" | "HYBRID")[];
  daysAgo?: number;
}) {
  const ownerUsername = `${PREFIX}owner_${opts.slug}`;
  const owner = await seedUser(ownerUsername);
  const created = await prisma.contractor.create({
    data: {
      slug: `${PREFIX}${opts.slug}`,
      entityType: "INDIVIDUAL",
      displayName: `Test ${opts.slug}`,
      country: opts.country,
      city: "Bratislava",
      workCategories: ["INSTALLATION"],
      renewableTypes: opts.renewables,
      countriesServed: [opts.country],
      bio: "x".repeat(150),
      contactEmail: `info@${opts.slug}.test`,
      contactPhone: "+421900000000",
      adminNote: "SECRET-internal-note-should-never-leak",
      status: opts.status,
    },
  });
  await prisma.contractorMember.create({
    data: { contractorId: created.id, userId: owner.id, role: "OWNER" },
  });
  if (opts.daysAgo) {
    const date = new Date(Date.now() - opts.daysAgo * 24 * 60 * 60 * 1000);
    await prisma.contractor.update({ where: { id: created.id }, data: { createdAt: date } });
  }
  return created;
}

beforeAll(async () => {
  await prisma.contractor.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });

  await seedContractor({ slug: "a-approved-sk-solar", status: "APPROVED", country: "SK", renewables: ["SOLAR"], daysAgo: 5 });
  await seedContractor({ slug: "b-approved-cz-wind", status: "APPROVED", country: "CZ", renewables: ["WIND"], daysAgo: 3 });
  await seedContractor({ slug: "c-approved-sk-wind-solar", status: "APPROVED", country: "SK", renewables: ["WIND", "SOLAR"], daysAgo: 1 });
  await seedContractor({ slug: "d-pending-sk", status: "PENDING", country: "SK", renewables: ["SOLAR"] });
  await seedContractor({ slug: "e-rejected-sk", status: "REJECTED", country: "SK", renewables: ["SOLAR"] });
  await seedContractor({ slug: "f-suspended-sk", status: "SUSPENDED", country: "SK", renewables: ["SOLAR"] });
});

afterAll(async () => {
  await prisma.contractor.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("readApprovedContractors", () => {
  it("returns only APPROVED rows", async () => {
    const { rows } = await readApprovedContractors({ pageSize: 50 });
    const ourRows = rows.filter((r) => r.slug.startsWith(PREFIX));
    expect(ourRows).toHaveLength(3);
    for (const r of ourRows) {
      expect(["a-approved-sk-solar", "b-approved-cz-wind", "c-approved-sk-wind-solar"].some((s) => r.slug.endsWith(s))).toBe(true);
    }
  });

  it("does NOT include adminNote", async () => {
    const { rows } = await readApprovedContractors({ pageSize: 50 });
    for (const r of rows) {
      expect((r as Record<string, unknown>).adminNote).toBeUndefined();
    }
  });

  it("filters by country", async () => {
    const { rows, total } = await readApprovedContractors({ country: "CZ", pageSize: 50 });
    const ours = rows.filter((r) => r.slug.startsWith(PREFIX));
    expect(ours).toHaveLength(1);
    expect(ours[0].slug.endsWith("b-approved-cz-wind")).toBe(true);
    expect(total).toBeGreaterThanOrEqual(1);
  });

  it("filters by renewable (has) matches contractors that include the type", async () => {
    const { rows } = await readApprovedContractors({ renewable: "WIND", pageSize: 50 });
    const ours = rows.filter((r) => r.slug.startsWith(PREFIX));
    expect(ours.map((r) => r.slug.replace(PREFIX, "")).sort()).toEqual(
      ["b-approved-cz-wind", "c-approved-sk-wind-solar"].sort(),
    );
  });

  it("sorts newest first (createdAt DESC)", async () => {
    const { rows } = await readApprovedContractors({ pageSize: 50 });
    const ours = rows.filter((r) => r.slug.startsWith(PREFIX));
    expect(ours[0].slug.endsWith("c-approved-sk-wind-solar")).toBe(true);
  });

  it("caps pageSize at 50 (defensive)", async () => {
    const { rows } = await readApprovedContractors({ pageSize: 99999 });
    expect(rows.length).toBeLessThanOrEqual(50);
  });
});

describe("readContractorBySlug", () => {
  it("returns an APPROVED contractor by slug", async () => {
    const r = await readContractorBySlug(`${PREFIX}a-approved-sk-solar`);
    expect(r).not.toBeNull();
    expect(r!.slug).toBe(`${PREFIX}a-approved-sk-solar`);
  });

  it("returns null for non-APPROVED slug", async () => {
    expect(await readContractorBySlug(`${PREFIX}d-pending-sk`)).toBeNull();
    expect(await readContractorBySlug(`${PREFIX}e-rejected-sk`)).toBeNull();
    expect(await readContractorBySlug(`${PREFIX}f-suspended-sk`)).toBeNull();
  });

  it("returns null for non-existent slug", async () => {
    expect(await readContractorBySlug(`${PREFIX}does-not-exist`)).toBeNull();
  });

  it("does NOT include adminNote", async () => {
    const r = await readContractorBySlug(`${PREFIX}a-approved-sk-solar`);
    expect((r as Record<string, unknown>).adminNote).toBeUndefined();
  });
});

describe("readNewestApprovedContractors", () => {
  it("returns newest APPROVED only", async () => {
    const rows = await readNewestApprovedContractors(50);
    const ours = rows.filter((r) => r.slug.startsWith(PREFIX));
    expect(ours.map((r) => r.slug.replace(PREFIX, ""))).toEqual([
      "c-approved-sk-wind-solar",
      "b-approved-cz-wind",
      "a-approved-sk-solar",
    ]);
  });

  it("limits to `limit`", async () => {
    const rows = await readNewestApprovedContractors(1);
    expect(rows.length).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/contractor-queries.test.ts`
Expected: FAIL — module `./contractor-queries` not found.

- [ ] **Step 3: Implement the module**

Create `src/lib/contractor-queries.ts`:

```ts
import { prisma } from "@/lib/prisma";
import type { ContractorRenewableType } from "@prisma/client";

// Public-safe SELECT — explicitly excludes adminNote, reviewedById, reviewedAt.
const PUBLIC_SELECT = {
  id: true,
  slug: true,
  entityType: true,
  displayName: true,
  legalName: true,
  registrationNumber: true,
  country: true,
  city: true,
  foundedYear: true,
  workCategories: true,
  renewableTypes: true,
  countriesServed: true,
  bio: true,
  websiteUrl: true,
  logoUrl: true,
  contactEmail: true,
  contactPhone: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type PublicContractor = NonNullable<
  Awaited<ReturnType<typeof readContractorBySlug>>
>;

export type PublicContractorList = {
  rows: PublicContractor[];
  total: number;
};

export async function readApprovedContractors(args: {
  country?: string;
  renewable?: ContractorRenewableType;
  page?: number;
  pageSize?: number;
}): Promise<PublicContractorList> {
  const page = Math.max(1, args.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, args.pageSize ?? 24));
  const where = {
    status: "APPROVED" as const,
    ...(args.country ? { country: args.country } : {}),
    ...(args.renewable ? { renewableTypes: { has: args.renewable } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.contractor.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: PUBLIC_SELECT,
    }),
    prisma.contractor.count({ where }),
  ]);
  return { rows, total };
}

export async function readContractorBySlug(slug: string) {
  return prisma.contractor.findFirst({
    where: { slug, status: "APPROVED" },
    select: PUBLIC_SELECT,
  });
}

export async function readNewestApprovedContractors(limit = 6) {
  return prisma.contractor.findMany({
    where: { status: "APPROVED" },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: PUBLIC_SELECT,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/contractor-queries.test.ts`
Expected: 11 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/contractor-queries.ts src/lib/contractor-queries.test.ts
git commit -m "feat(contractor-public): add read-side queries with APPROVED gate + safe SELECT"
```

---

## Task 2: i18n strings (EN/RU/SK)

**Files:**
- Modify: `messages/en.json`, `messages/ru.json`, `messages/sk.json`

- [ ] **Step 1: Add to EN**

Read `messages/en.json` first. Add a new top-level key `"public"` (or merge into existing `public` if present), with sub-block `contractor`:

```json
"public": {
  "contractor": {
    "listing": {
      "title": "Contractors",
      "subtitle": "Renewable energy partners — design, install, commission your power station.",
      "empty": "No approved contractors yet.",
      "emptyCta": "Be the first — register your company →",
      "page": "Page {page} of {total}",
      "total": "{count} contractors"
    },
    "filter": {
      "country": "Country",
      "renewable": "Renewable",
      "all": "All",
      "apply": "Apply",
      "clear": "Clear filters"
    },
    "detail": {
      "about": "About",
      "whatWeDo": "What we do",
      "workCategories": "Services",
      "renewableTypes": "Renewable types",
      "countriesServed": "Countries served",
      "contact": "Contact",
      "contactEmail": "Email",
      "contactPhone": "Phone",
      "website": "Website",
      "companyInfo": "Company info",
      "legalName": "Legal name",
      "registrationNumber": "Registration #",
      "foundedYear": "Founded",
      "back": "Back to contractors"
    },
    "homepage": {
      "title": "Build your own power station",
      "subtitle": "Partners across Europe ready to design, install and commission your solar, wind, or hybrid setup.",
      "viewAll": "View all contractors →"
    }
  }
}
```

If `public` already exists, merge `contractor` into it. Otherwise add at the root.

- [ ] **Step 2: Translate to RU**

Same structure in `messages/ru.json`:

- `listing.title` → `"Подрядчики"`
- `listing.subtitle` → `"Партнёры по возобновляемой энергии — проектирование, монтаж, пусконаладка вашей станции."`
- `listing.empty` → `"Пока нет одобренных подрядчиков."`
- `listing.emptyCta` → `"Станьте первым — зарегистрируйте свою компанию →"`
- `listing.page` → `"Страница {page} из {total}"`
- `listing.total` → `"всего {count}"`
- `filter.country/renewable/all/apply/clear` → `"Страна" / "Источник" / "Все" / "Применить" / "Сбросить"`
- `detail.about` → `"О компании"`
- `detail.whatWeDo` → `"Чем занимаемся"`
- `detail.workCategories` → `"Услуги"`
- `detail.renewableTypes` → `"Типы источников"`
- `detail.countriesServed` → `"Страны работы"`
- `detail.contact` → `"Контакт"`
- `detail.contactEmail/contactPhone/website` → `"Email" / "Телефон" / "Сайт"`
- `detail.companyInfo` → `"Реквизиты"`
- `detail.legalName/registrationNumber/foundedYear` → `"Юридическое название" / "Рег. номер" / "Основана"`
- `detail.back` → `"К списку подрядчиков"`
- `homepage.title` → `"Постройте свою электростанцию"`
- `homepage.subtitle` → `"Партнёры по всей Европе готовы спроектировать, смонтировать и запустить вашу солнечную, ветровую или гибридную станцию."`
- `homepage.viewAll` → `"Все подрядчики →"`

- [ ] **Step 3: Translate to SK**

Same structure in `messages/sk.json`:

- `listing.title` → `"Dodávatelia"`
- `listing.subtitle` → `"Partneri pre obnoviteľné zdroje — projekt, inštalácia a uvedenie do prevádzky vašej elektrárne."`
- `listing.empty` → `"Zatiaľ nie sú žiadni schválení dodávatelia."`
- `listing.emptyCta` → `"Buďte prví — zaregistrujte svoju firmu →"`
- `listing.page` → `"Strana {page} z {total}"`
- `listing.total` → `"spolu {count}"`
- `filter.country/renewable/all/apply/clear` → `"Krajina" / "Zdroj" / "Všetky" / "Použiť" / "Vyčistiť"`
- `detail.about` → `"O firme"`
- `detail.whatWeDo` → `"Čo robíme"`
- `detail.workCategories` → `"Služby"`
- `detail.renewableTypes` → `"Typy zdrojov"`
- `detail.countriesServed` → `"Krajiny pôsobenia"`
- `detail.contact` → `"Kontakt"`
- `detail.contactEmail/contactPhone/website` → `"Email" / "Telefón" / "Web"`
- `detail.companyInfo` → `"Údaje o firme"`
- `detail.legalName/registrationNumber/foundedYear` → `"Právny názov" / "IČO" / "Založené"`
- `detail.back` → `"Späť na dodávateľov"`
- `homepage.title` → `"Postavte si vlastnú elektráreň"`
- `homepage.subtitle` → `"Partneri po celej Európe pripravení projektovať, inštalovať a uvádzať do prevádzky vaše solárne, veterné alebo hybridné riešenie."`
- `homepage.viewAll` → `"Všetci dodávatelia →"`

- [ ] **Step 4: Verify JSON parses**

Run: `node -e "['en','ru','sk'].forEach(l => JSON.parse(require('fs').readFileSync('messages/'+l+'.json','utf-8')))"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add messages/en.json messages/ru.json messages/sk.json
git commit -m "feat(contractor-public): add EN/RU/SK i18n strings"
```

---

## Task 3: `<ContractorCard>` component

**Files:**
- Create: `src/components/contractor/contractor-card.tsx`

- [ ] **Step 1: Implement**

Create `src/components/contractor/contractor-card.tsx`:

```tsx
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { PublicContractor } from "@/lib/contractor-queries";

type Props = {
  locale: string;
  contractor: Pick<
    PublicContractor,
    "slug" | "displayName" | "entityType" | "country" | "city" |
    "workCategories" | "renewableTypes" | "logoUrl"
  >;
};

export async function ContractorCard({ locale, contractor: c }: Props) {
  const t = await getTranslations("cabinet.contractor");

  const initial = c.displayName.charAt(0).toUpperCase();
  const topWorks = c.workCategories.slice(0, 2);
  const topRenewables = c.renewableTypes.slice(0, 2);

  return (
    <Link
      href={`/${locale}/contractors/${c.slug}`}
      prefetch={false}
      className="block border border-hairline rounded-lg p-5 hover:border-accent transition-colors bg-card"
    >
      <div className="flex items-start gap-3 mb-3">
        {c.logoUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={c.logoUrl}
            alt={`${c.displayName} logo`}
            className="w-12 h-12 rounded object-cover border border-hairline"
          />
        ) : (
          <div className="w-12 h-12 rounded bg-foreground/10 flex items-center justify-center font-bold text-lg text-muted">
            {initial}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-[15px] truncate">{c.displayName}</h3>
          <p className="text-xs text-muted truncate">
            {t(`field.entityType.${c.entityType}`)} · {c.city}, {c.country}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 mt-3">
        {topWorks.map((w) => (
          <span key={w} className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-foreground/5 text-muted">
            {t(`field.workCategories.${w}`)}
          </span>
        ))}
        {topRenewables.map((r) => (
          <span key={r} className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-accent/10 text-accent">
            {t(`field.renewableTypes.${r}`)}
          </span>
        ))}
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/contractor/contractor-card.tsx
git commit -m "feat(contractor-public): add ContractorCard component"
```

---

## Task 4: `<ContractorFilters>` client component

**Files:**
- Create: `src/components/contractor/contractor-filters.tsx`

- [ ] **Step 1: Implement**

Create `src/components/contractor/contractor-filters.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const RENEWABLES = ["SOLAR", "WIND", "HYDRO", "BIOMASS", "GEOTHERMAL", "HYBRID"] as const;

type Props = {
  locale: string;
  initialCountry: string;
  initialRenewable: string;
  countryOptions: string[]; // ISO-2 codes that have at least one APPROVED contractor
  labels: {
    country: string;
    renewable: string;
    all: string;
    apply: string;
    clear: string;
    renewableLabels: Record<string, string>;
  };
};

export function ContractorFilters({
  locale,
  initialCountry,
  initialRenewable,
  countryOptions,
  labels,
}: Props) {
  const router = useRouter();
  const [country, setCountry] = useState(initialCountry);
  const [renewable, setRenewable] = useState(initialRenewable);

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const qs = new URLSearchParams();
    if (country) qs.set("country", country);
    if (renewable) qs.set("renewable", renewable);
    const url = `/${locale}/contractors${qs.toString() ? `?${qs}` : ""}`;
    router.push(url);
  }

  function clear() {
    setCountry("");
    setRenewable("");
    router.push(`/${locale}/contractors`);
  }

  const hasFilters = country || renewable;

  return (
    <form onSubmit={apply} className="flex flex-wrap gap-2 items-center mb-6 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-muted">{labels.country}</span>
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="border border-hairline rounded px-2 py-1 bg-card"
        >
          <option value="">{labels.all}</option>
          {countryOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2">
        <span className="text-muted">{labels.renewable}</span>
        <select
          value={renewable}
          onChange={(e) => setRenewable(e.target.value)}
          className="border border-hairline rounded px-2 py-1 bg-card"
        >
          <option value="">{labels.all}</option>
          {RENEWABLES.map((r) => (
            <option key={r} value={r}>{labels.renewableLabels[r] ?? r}</option>
          ))}
        </select>
      </label>

      <button type="submit" className="px-3 py-1 bg-foreground text-bg rounded">{labels.apply}</button>
      {hasFilters && (
        <button type="button" onClick={clear} className="px-3 py-1 border border-hairline rounded">
          {labels.clear}
        </button>
      )}
    </form>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/contractor/contractor-filters.tsx
git commit -m "feat(contractor-public): add ContractorFilters client component"
```

---

## Task 5: `/contractors` listing page

**Files:**
- Create: `src/app/[locale]/contractors/page.tsx`

- [ ] **Step 1: Implement**

Create `src/app/[locale]/contractors/page.tsx`:

```tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ContractorRenewableType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readApprovedContractors } from "@/lib/contractor-queries";
import { ContractorCard } from "@/components/contractor/contractor-card";
import { ContractorFilters } from "@/components/contractor/contractor-filters";

const RENEWABLES: ContractorRenewableType[] = ["SOLAR", "WIND", "HYDRO", "BIOMASS", "GEOTHERMAL", "HYBRID"];

export const metadata = {
  title: "Contractors — Poolwatt",
  description: "Find renewable energy contractors who can build your solar, wind, or hybrid power station.",
};

export default async function ContractorsListPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ country?: string; renewable?: string; page?: string }>;
}) {
  const { locale } = await params;
  const { country: rc, renewable: rr, page: rp } = await searchParams;
  setRequestLocale(locale);

  const country = rc?.match(/^[A-Z]{2}$/) ? rc : undefined;
  const renewable = RENEWABLES.includes(rr as ContractorRenewableType)
    ? (rr as ContractorRenewableType)
    : undefined;
  const page = Math.max(1, Number(rp) || 1);
  const pageSize = 24;

  const [{ rows, total }, distinctCountries, tListing, tFilter, tField] = await Promise.all([
    readApprovedContractors({ country, renewable, page, pageSize }),
    prisma.contractor.findMany({
      where: { status: "APPROVED" },
      select: { country: true },
      distinct: ["country"],
      orderBy: { country: "asc" },
    }),
    getTranslations("public.contractor.listing"),
    getTranslations("public.contractor.filter"),
    getTranslations("cabinet.contractor.field.renewableTypes"),
  ]);

  const countryOptions = distinctCountries.map((c) => c.country);
  const renewableLabels = Object.fromEntries(
    RENEWABLES.map((r) => [r, tField(r)]),
  );

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="bg-bg min-h-[calc(100vh-4rem)]">
      <div className="max-w-[1400px] mx-auto px-4 md:px-12 xl:px-20 py-12 md:py-20">
        <header className="mb-8">
          <h1 className="text-[32px] md:text-[48px] font-bold tracking-[-0.02em]">{tListing("title")}</h1>
          <p className="text-muted mt-2 max-w-2xl">{tListing("subtitle")}</p>
        </header>

        <ContractorFilters
          locale={locale}
          initialCountry={country ?? ""}
          initialRenewable={renewable ?? ""}
          countryOptions={countryOptions}
          labels={{
            country: tFilter("country"),
            renewable: tFilter("renewable"),
            all: tFilter("all"),
            apply: tFilter("apply"),
            clear: tFilter("clear"),
            renewableLabels,
          }}
        />

        {rows.length === 0 ? (
          <div className="border border-hairline rounded-lg p-8 text-center">
            <p className="text-muted mb-4">{tListing("empty")}</p>
            <Link href={`/${locale}/me/contractor/new`} className="text-accent underline">
              {tListing("emptyCta")}
            </Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {rows.map((c) => (
                <ContractorCard key={c.id} locale={locale} contractor={c} />
              ))}
            </div>

            <div className="flex items-center justify-between mt-8 text-sm text-muted">
              <p>{tListing("total", { count: total })}</p>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link
                    href={`/${locale}/contractors?${new URLSearchParams({
                      ...(country ? { country } : {}),
                      ...(renewable ? { renewable } : {}),
                      page: String(page - 1),
                    })}`}
                    className="px-3 py-1 border border-hairline rounded"
                  >
                    ←
                  </Link>
                )}
                <span className="px-3 py-1">{tListing("page", { page, total: totalPages })}</span>
                {page < totalPages && (
                  <Link
                    href={`/${locale}/contractors?${new URLSearchParams({
                      ...(country ? { country } : {}),
                      ...(renewable ? { renewable } : {}),
                      page: String(page + 1),
                    })}`}
                    className="px-3 py-1 border border-hairline rounded"
                  >
                    →
                  </Link>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/contractors/page.tsx
git commit -m "feat(contractor-public): add /contractors list page with filters + pagination"
```

---

## Task 6: `/contractors/[slug]` detail page

**Files:**
- Create: `src/app/[locale]/contractors/[slug]/page.tsx`

- [ ] **Step 1: Implement**

Create `src/app/[locale]/contractors/[slug]/page.tsx`:

```tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { readContractorBySlug } from "@/lib/contractor-queries";

type RouteParams = { locale: string; slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { slug } = await params;
  const c = await readContractorBySlug(slug);
  if (!c) return { title: "Contractor not found — Poolwatt" };
  const desc = (c.bio ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  return {
    title: `${c.displayName} — Poolwatt`,
    description: desc,
    openGraph: c.logoUrl
      ? { images: [{ url: c.logoUrl }] }
      : undefined,
  };
}

export default async function ContractorDetailPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const c = await readContractorBySlug(slug);
  if (!c) notFound();

  const [tDetail, tField] = await Promise.all([
    getTranslations("public.contractor.detail"),
    getTranslations("cabinet.contractor.field"),
  ]);

  const initial = c.displayName.charAt(0).toUpperCase();

  return (
    <main className="bg-bg min-h-[calc(100vh-4rem)]">
      <div className="max-w-3xl mx-auto px-4 md:px-12 py-12 md:py-20">
        <Link href={`/${locale}/contractors`} className="text-sm text-muted">← {tDetail("back")}</Link>

        <header className="flex items-start gap-4 mt-6 mb-10">
          {c.logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={c.logoUrl}
              alt={`${c.displayName} logo`}
              className="w-20 h-20 rounded-lg object-cover border border-hairline"
            />
          ) : (
            <div className="w-20 h-20 rounded-lg bg-foreground/10 flex items-center justify-center font-bold text-3xl text-muted">
              {initial}
            </div>
          )}
          <div>
            <h1 className="text-[32px] md:text-[40px] font-bold tracking-[-0.02em]">{c.displayName}</h1>
            <p className="text-muted mt-1">
              {tField(`entityType.${c.entityType}`)} · {c.city}, {c.country}
            </p>
          </div>
        </header>

        <section className="mb-8">
          <h2 className="text-sm uppercase tracking-wider text-muted mb-2">{tDetail("about")}</h2>
          <p className="whitespace-pre-wrap leading-relaxed">{c.bio}</p>
        </section>

        <section className="mb-8 grid sm:grid-cols-2 gap-6">
          <div>
            <h3 className="text-xs uppercase tracking-wider text-muted mb-2">{tDetail("workCategories")}</h3>
            <ul className="text-sm space-y-1">
              {c.workCategories.map((w) => (
                <li key={w}>· {tField(`workCategories.${w}`)}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-xs uppercase tracking-wider text-muted mb-2">{tDetail("renewableTypes")}</h3>
            <ul className="text-sm space-y-1">
              {c.renewableTypes.map((r) => (
                <li key={r}>· {tField(`renewableTypes.${r}`)}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mb-8">
          <h3 className="text-xs uppercase tracking-wider text-muted mb-2">{tDetail("countriesServed")}</h3>
          <p className="text-sm">{c.countriesServed.join(", ")}</p>
        </section>

        <section className="border border-hairline rounded-lg p-5 mb-8">
          <h2 className="text-sm uppercase tracking-wider text-muted mb-3">{tDetail("contact")}</h2>
          <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
            <dt className="text-muted">{tDetail("contactEmail")}</dt>
            <dd><a href={`mailto:${c.contactEmail}`} className="text-accent underline">{c.contactEmail}</a></dd>
            <dt className="text-muted">{tDetail("contactPhone")}</dt>
            <dd><a href={`tel:${c.contactPhone}`} className="text-accent underline">{c.contactPhone}</a></dd>
            {c.websiteUrl && (
              <>
                <dt className="text-muted">{tDetail("website")}</dt>
                <dd>
                  <a href={c.websiteUrl} target="_blank" rel="noreferrer" className="text-accent underline">
                    {c.websiteUrl}
                  </a>
                </dd>
              </>
            )}
          </dl>
        </section>

        {(c.legalName || c.registrationNumber || c.foundedYear) && (
          <section className="border border-hairline rounded-lg p-5">
            <h2 className="text-sm uppercase tracking-wider text-muted mb-3">{tDetail("companyInfo")}</h2>
            <dl className="grid grid-cols-[160px_1fr] gap-y-2 text-sm">
              {c.legalName && (<><dt className="text-muted">{tDetail("legalName")}</dt><dd>{c.legalName}</dd></>)}
              {c.registrationNumber && (<><dt className="text-muted">{tDetail("registrationNumber")}</dt><dd>{c.registrationNumber}</dd></>)}
              {c.foundedYear != null && (<><dt className="text-muted">{tDetail("foundedYear")}</dt><dd>{c.foundedYear}</dd></>)}
            </dl>
          </section>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/contractors/[slug]/page.tsx
git commit -m "feat(contractor-public): add /contractors/[slug] detail page with generateMetadata"
```

---

## Task 7: `<ContractorsBlock>` homepage component

**Files:**
- Create: `src/components/contractor/contractors-block.tsx`

- [ ] **Step 1: Implement**

Create `src/components/contractor/contractors-block.tsx`:

```tsx
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { readNewestApprovedContractors } from "@/lib/contractor-queries";
import { ContractorCard } from "./contractor-card";

export async function ContractorsBlock({ locale }: { locale: string }) {
  const rows = await readNewestApprovedContractors(6);
  if (rows.length === 0) return null;

  const t = await getTranslations("public.contractor.homepage");

  return (
    <section className="py-12 md:py-20">
      <header className="mb-8 max-w-3xl">
        <h2 className="text-[28px] md:text-[40px] font-bold tracking-[-0.02em]">{t("title")}</h2>
        <p className="text-muted mt-2 text-[15px] md:text-[17px]">{t("subtitle")}</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map((c) => (
          <ContractorCard key={c.id} locale={locale} contractor={c} />
        ))}
      </div>

      <div className="mt-6">
        <Link href={`/${locale}/contractors`} className="text-accent text-sm font-semibold underline">
          {t("viewAll")}
        </Link>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/contractor/contractors-block.tsx
git commit -m "feat(contractor-public): add ContractorsBlock for homepage"
```

---

## Task 8: Render `<ContractorsBlock>` on homepage

**Files:**
- Modify: `src/app/[locale]/page.tsx`

- [ ] **Step 1: Add import**

In `src/app/[locale]/page.tsx`, near the other imports, add:

```tsx
import { ContractorsBlock } from "@/components/contractor/contractors-block";
```

- [ ] **Step 2: Render the block after the producers section**

The existing homepage has `<section id="producers" ...>` block ending around line 144. Insert AFTER that closing `</section>` and before the closing `</div>` of the page:

```tsx
<ContractorsBlock locale={locale} />
```

So the structure becomes:
```tsx
<section id="producers" className="py-12 scroll-mt-24">
  ...
  <ProducerListClient ... />
</section>

<ContractorsBlock locale={locale} />

</div>
</main>
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/page.tsx
git commit -m "feat(homepage): render ContractorsBlock after producers"
```

---

## Task 9: Dynamic sitemap

**Files:**
- Create: `src/app/sitemap.ts`

- [ ] **Step 1: Implement**

Create `src/app/sitemap.ts`:

```ts
import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

const BASE = process.env.NEXTAUTH_URL ?? "https://poolwatt.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const contractors = await prisma.contractor.findMany({
    where: { status: "APPROVED" },
    select: { slug: true, updatedAt: true },
  });

  const now = new Date();
  return [
    { url: `${BASE}/en`, lastModified: now, changeFrequency: "daily", priority: 1.0 },
    { url: `${BASE}/en/contractors`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    ...contractors.map((c) => ({
      url: `${BASE}/en/contractors/${c.slug}`,
      lastModified: c.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
```

V2b: default locale only. Multi-locale `hreflang` sitemap is a future task.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

After `npm run build`, the sitemap will be available at `/sitemap.xml`.

- [ ] **Step 3: Commit**

```bash
git add src/app/sitemap.ts
git commit -m "feat(seo): add dynamic sitemap including approved contractors"
```

---

## Task 10: Playwright e2e (public flow)

**Files:**
- Create: `tests/e2e/contractor-public.spec.ts`

- [ ] **Step 1: Write the spec**

Pre-flight: build + restart pm2 must be done by the orchestrator BEFORE this test runs (so new routes are live).

```ts
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const PREFIX = "e2e_pub_ctr_";

test.beforeAll(async () => {
  const owner = await prisma.user.upsert({
    where: { username: `${PREFIX}owner` },
    update: { passwordHash: await bcrypt.hash("Pass1234", 10) },
    create: { username: `${PREFIX}owner`, passwordHash: await bcrypt.hash("Pass1234", 10) },
  });

  // wipe any prior leftover
  await prisma.contractor.deleteMany({ where: { slug: { startsWith: PREFIX } } });

  await prisma.contractor.create({
    data: {
      slug: `${PREFIX}solarco`,
      entityType: "LEGAL_ENTITY",
      displayName: "PublicCo Solar s.r.o.",
      legalName: "PublicCo Solar Renewable Energy s.r.o.",
      registrationNumber: "99887766",
      country: "SK",
      city: "Bratislava",
      foundedYear: 2018,
      workCategories: ["DESIGN", "INSTALLATION"],
      renewableTypes: ["SOLAR"],
      countriesServed: ["SK", "CZ"],
      bio: "We design and install solar power stations across Slovakia and Czech Republic. ".repeat(3),
      contactEmail: "info@publicco-solar.test",
      contactPhone: "+421900555111",
      websiteUrl: "https://publicco-solar.test",
      status: "APPROVED",
      adminNote: "INTERNAL-ONLY-MUST-NOT-LEAK",
      members: { create: { userId: owner.id, role: "OWNER" } },
    },
  });

  // Also create a PENDING one to verify it does NOT show up
  await prisma.contractor.create({
    data: {
      slug: `${PREFIX}pending`,
      entityType: "INDIVIDUAL",
      displayName: "PublicCo Pending",
      country: "SK",
      city: "Bratislava",
      workCategories: ["INSTALLATION"],
      renewableTypes: ["WIND"],
      countriesServed: ["SK"],
      bio: "x".repeat(150),
      contactEmail: "x@x.test",
      contactPhone: "+421900555222",
      status: "PENDING",
      members: { create: { userId: owner.id, role: "OWNER" } },
    },
  });
});

test.afterAll(async () => {
  await prisma.contractor.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

test("anonymous visitor browses and views a contractor", async ({ page }) => {
  // Listing
  await page.goto("/en/contractors");
  await expect(page.locator("h1", { hasText: "Contractors" })).toBeVisible();
  await expect(page.locator("text=PublicCo Solar s.r.o.")).toBeVisible();
  // PENDING should NOT appear
  await expect(page.locator("text=PublicCo Pending")).not.toBeVisible();

  // Click through to detail
  await page.locator("text=PublicCo Solar s.r.o.").first().click();
  await expect(page).toHaveURL(/\/en\/contractors\/e2e_pub_ctr_solarco$/);
  await expect(page.locator("text=info@publicco-solar.test")).toBeVisible();
  await expect(page.locator("text=+421900555111")).toBeVisible();
  await expect(page.locator("text=https://publicco-solar.test")).toBeVisible();

  // adminNote must NEVER appear in HTML
  const html = await page.content();
  expect(html).not.toContain("INTERNAL-ONLY-MUST-NOT-LEAK");
});

test("non-approved slug returns 404", async ({ page }) => {
  const resp = await page.goto(`/en/contractors/${PREFIX}pending`);
  expect(resp?.status()).toBe(404);
});

test("homepage shows contractors block", async ({ page }) => {
  await page.goto("/en");
  await expect(page.locator("text=Build your own power station")).toBeVisible();
  await expect(page.locator("text=PublicCo Solar s.r.o.")).toBeVisible();
});

test("country filter narrows results", async ({ page }) => {
  await page.goto("/en/contractors?country=CZ");
  // Our SK-only test row should be absent
  await expect(page.locator("text=PublicCo Solar s.r.o.")).not.toBeVisible();
});
```

- [ ] **Step 2: Run**

Pre-flight: orchestrator has rebuilt + restarted poolwatt-web.

Run: `set -a && source .env.local && set +a && npx playwright test contractor-public 2>&1 | tail -25`
Expected: 4 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/contractor-public.spec.ts
git commit -m "test(contractor-public): add e2e — listing, detail, 404, homepage, filter"
```

---

## Task 11: README roadmap entry

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the line under the existing roadmap (right after V2a entry)**

```markdown
- [x] **Public contractor listing (V2b)** — `/contractors` directory + homepage block of newest approved contractors. See `docs/superpowers/specs/2026-05-30-contractor-public-listing-v2b-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(contractor-public): add V2b roadmap entry"
```

---

## Done criteria

- All 11 tasks committed.
- `npm run lint` clean (no NEW errors).
- `npm run test` green (V2b unit/integration tests).
- `npx playwright test contractor-public` green (4 tests).
- Manual smoke: visit `/en/contractors` anonymously, see APPROVED contractors. Visit `/en` homepage, see "Build your own power station" section.
- Spec coverage: §1–10 each have at least one task implementing them. §11 (V2c/V2d/future deferrals) intentionally untouched.

## Deferred to future plans

- Filter by `workCategories`
- Map view
- Admin-curated "featured" flag
- Contact form / message inbox (V2d)
- Reviews / ratings
- Multi-locale sitemap with `hreflang`
- ISR / HTTP caching
- Free-text search
