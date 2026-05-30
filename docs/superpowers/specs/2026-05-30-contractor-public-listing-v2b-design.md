# Poolwatt — Public Contractor Listing V2b (design)

**Date:** 2026-05-30
**Scope:** Public-facing pages for approved contractors. List page at
`/[locale]/contractors` with two filters (country, renewable type),
detail page at `/[locale]/contractors/[slug]`, and a homepage block of
the 6 newest approved contractors. All read-only; no auth needed.
**Out of scope:** Filter by workCategory; map view; admin-curated
"featured"; contact form / message inbox; reviews / ratings;
full XML sitemap rollout (only an initial dynamic sitemap for V2b URLs).
**Phase:** Phase 2 — builds directly on V2a's `Contractor` model
(commits `67767af` … `dd87103`).

---

## 0. Roadmap context

V2b is the **second of four** V2 sub-projects:

```
V2a (shipped 2026-05-30)  Contractor registration + admin moderation
V2b (this spec)           Public listing — homepage block + /contractors directory
V2c                       Contractor cabinet — invite teammates, edit post-approval
V2d                       Contractor ↔ BuildRequest matching / claim
```

V2b depends on V2a's `Contractor` model. It does NOT depend on V2c
or V2d. After V2b, approved contractors become discoverable to public
visitors — the platform's two-sided marketplace effectively launches.

---

## 1. What we ship in V2b

A visitor (no auth required) can:

1. **Browse contractors** at `/[locale]/contractors` — list of all
   `APPROVED` contractors, 24 per page, sorted by `createdAt DESC`,
   with two filters (country, renewable type).
2. **View detail** at `/[locale]/contractors/[slug]` — full company
   profile, plain-text public contact info (email, phone, website).
3. **Discover from homepage** — new section on `/[locale]/page.tsx`
   showing 6 newest approved contractors as cards with "View all →".

Public listing rules:
- `WHERE status = APPROVED` everywhere — `PENDING`, `REJECTED`,
  `SUSPENDED` are hidden completely (including by slug-guessing).
- `adminNote` (internal field) NEVER renders in public views.
- Contact info (`contactEmail`, `contactPhone`, `websiteUrl`,
  `logoUrl`) is **plain-text public**. Owners explicitly chose these
  as public-facing during V2a registration; the i18n hint already
  marks them as "contact" not "private".

Out of scope (explicit):
- Filter by `workCategories` — V2b filters only by country + renewable
  type. workCategory filter added later if real users ask.
- Map view — V2c or later (needs geo coords on Contractor).
- Admin-curated "featured" — current sort = newest first; add a
  `featured` flag when there's curation need.
- Contact form / inbox — V2d work.
- Reviews / ratings — future.
- Full SEO-grade sitemap — initial dynamic sitemap covers `/contractors`
  + each contractor; richer SEO is a future task.

---

## 2. Architecture

### Read-only layer

V2b is **purely a read-side feature**. No new server actions, no new
DB writes, no new Prisma migrations. Reuses V2a's `Contractor` table.

### Trust boundary

- Public pages perform NO `auth()` call. Visitors are anonymous.
- All queries filter `WHERE status = APPROVED` at the data layer
  (not the UI layer) so a UI bug can't accidentally leak a PENDING
  contractor.
- `adminNote` is never selected in any public query.

### Why a separate `contractor-queries.ts` module

Putting these queries in a dedicated file (not directly in pages):
- Keeps the `APPROVED`-only filter in one place (security-critical)
- Centralizes the `select` clauses so we never accidentally include
  `adminNote`
- Makes unit testing the filter logic possible without rendering pages

---

## 3. Data access — new module `src/lib/contractor-queries.ts`

```ts
import { prisma } from "@/lib/prisma";
import type { ContractorRenewableType } from "@prisma/client";

// Public-safe SELECT — explicitly does NOT include adminNote, reviewedById, reviewedAt.
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

**Notes:**
- `renewableTypes: { has: x }` — Prisma's Postgres array `@>` operator.
- `country` filter is exact match on the contractor's HQ country, not
  `countriesServed`. V2b decision: HQ-country filter is more intuitive
  for "find a local contractor". A `?serves=SK` variant can be added
  later if users ask for "contractors who work in my country".
- `pageSize` capped at 50 server-side to prevent abuse via query params.

---

## 4. Routes & UI

| Route | Type | Notes |
|---|---|---|
| `/[locale]/contractors` | server component | List + filters + pagination |
| `/[locale]/contractors/[slug]` | server component | Full profile; `notFound()` if non-APPROVED or missing |
| `/[locale]/page.tsx` | modified | New section "Contractors" block |

### Listing page (`/contractors`)

Search params:
- `country` — ISO-2; validated, ignored if not `/^[A-Z]{2}$/`
- `renewable` — one of `SOLAR | WIND | HYDRO | BIOMASS | GEOTHERMAL | HYBRID`; ignored if invalid
- `page` — number; `Math.max(1, ...)`; default 1

Layout:
- Page title + subtitle
- Filter bar at top: two `<select>` elements + Apply button (form submit
  reloads with new query string)
- Active filters shown as removable chips below the bar
- Grid of contractor cards (3 cols desktop, 2 tablet, 1 mobile)
- Pagination: `Page N of M, total contractors` + prev/next links

Empty state: "No approved contractors yet. Be the first — register
your company →" with link to `/me/contractor/new`.

### Detail page (`/contractors/[slug]`)

Layout (single column, max-w-3xl):
- Hero band: logo (or initial avatar) + displayName + entityType badge + country
- Section "About" — full bio (whitespace-preserved)
- Section "What we do" — work categories + renewable types as chips,
  countries served as list
- Section "Contact" — email (`mailto:` link), phone (`tel:` link),
  website (external link with `target="_blank" rel="noreferrer"`)
- Section "Company info" — legal name, registration number, founded year
  (each rendered only if present)
- Back link: "← Back to contractors"

If contractor not found or not APPROVED: `notFound()` → renders the
existing not-found page (no leakage of existence).

### Homepage block (modification to `/[locale]/page.tsx`)

A new server component `<ContractorsBlock locale={locale} />` rendered
near the bottom (after existing producer/charger sections, before
footer). Internally calls `readNewestApprovedContractors(6)`.

Layout:
- Section heading + short subtitle
- Grid of 6 cards (same `<ContractorCard>` as the listing page)
- "View all →" link to `/[locale]/contractors`

If there are zero approved contractors: the section is **hidden
entirely** (don't render an empty block on the homepage — looks broken).

---

## 5. Components

| File | Responsibility |
|---|---|
| `src/components/contractor/contractor-card.tsx` | Single card used by listing + homepage. Shows logo (or initial), displayName, entityType badge, country, top 3 work + renewable chips. Click → detail page. |
| `src/components/contractor/contractor-filters.tsx` | Client component (`"use client"`). Two `<select>` + Apply button. Submits as a form → updates URL. Reads initial values from props. |
| `src/components/contractor/contractor-active-filters.tsx` | Server component. Renders chips showing active filters with × to remove (rendered as Link with the filter param cleared). |
| `src/components/contractor/contractors-block.tsx` | Server component for homepage. Calls `readNewestApprovedContractors`. Returns null if zero rows. |

---

## 6. SEO

- Both routes are SSR (dynamic) — Next.js renders fresh on every request.
- Detail page exports `generateMetadata({ params })`:
  - title: `${displayName} — Poolwatt`
  - description: first 160 chars of `bio` (stripped of newlines)
  - openGraph.images: `[{ url: logoUrl }]` if present
- Listing page exports static metadata: title `"Contractors — Poolwatt"`,
  description `"Find renewable energy contractors who can build your solar, wind, or hybrid power station."`
- Create `src/app/sitemap.ts` (file doesn't exist yet) that emits:
  - `/` (homepage)
  - `/contractors`
  - one entry per approved contractor at `/contractors/[slug]` with
    `lastModified: contractor.updatedAt`
  - All entries emitted for default locale only (`/en/...`) for V2b;
    multi-locale sitemap is a future task.

---

## 7. i18n

New namespace `public.contractor.*` in `messages/{en,ru,sk}.json`:

```
public.contractor.listing.title
public.contractor.listing.subtitle
public.contractor.listing.empty
public.contractor.listing.emptyCta
public.contractor.listing.page
public.contractor.listing.total

public.contractor.filter.country
public.contractor.filter.renewable
public.contractor.filter.all
public.contractor.filter.apply
public.contractor.filter.clear

public.contractor.detail.about
public.contractor.detail.whatWeDo
public.contractor.detail.workCategories
public.contractor.detail.renewableTypes
public.contractor.detail.countriesServed
public.contractor.detail.contact
public.contractor.detail.contactEmail
public.contractor.detail.contactPhone
public.contractor.detail.website
public.contractor.detail.companyInfo
public.contractor.detail.legalName
public.contractor.detail.registrationNumber
public.contractor.detail.foundedYear
public.contractor.detail.back

public.contractor.homepage.title
public.contractor.homepage.subtitle
public.contractor.homepage.viewAll
```

**Enum labels** for `workCategories.*`, `renewableTypes.*`, `entityType.*`
are reused from existing `cabinet.contractor.field.*.*` — no
duplication. The listing card and detail page import them via
`getTranslations("cabinet.contractor")` like the cabinet code does.

EN/RU/SK fully translated at merge. 26 other locales fall back to EN.

---

## 8. Testing

### Unit (vitest)

`src/lib/contractor-queries.test.ts`:
- Seeds APPROVED + PENDING + REJECTED + SUSPENDED contractors
- `readApprovedContractors()` returns only APPROVED
- `readApprovedContractors({ country: "SK" })` filters correctly
- `readApprovedContractors({ renewable: "SOLAR" })` filters using `has`
- `readContractorBySlug` returns null for non-APPROVED slug
- `readNewestApprovedContractors(2)` returns 2 most-recent APPROVED
- All queries' return shape does NOT include `adminNote`

### E2E (Playwright)

`tests/e2e/contractor-public.spec.ts`:
- Seed one APPROVED contractor (no auth needed for test)
- Visit `/en/contractors` as anonymous → see the card, click through
- On detail page, verify displayName, bio, contact email/phone/website
  are visible
- Try `/en/contractors/nonexistent-slug` → 404
- Apply filter `?country=SK` → URL updates, list filtered
- Visit `/en` (homepage) → contractor block visible with at least 1 card

### Manual smoke checks before merge

- Visit `/en/contractors/<slug>` for the PENDING `e2e_ctr_owner`'s
  contractor → must be 404 (proves status gate works)
- View page source of `/en/contractors/[approved-slug]` → verify
  `adminNote` text appears NOWHERE in the rendered HTML

---

## 9. Performance considerations (V2b scale)

- Initial scale: < 50 approved contractors. No pagination/caching
  performance concerns.
- Postgres queries are indexed via existing `@@index([status, createdAt])`
  from V2a's schema — list query hits the index.
- Filter by `country` benefits from existing `@@index([country, status])`.
- Filter by `renewableTypes` uses Postgres array `@>` (no index — table
  scan); fine at < 50 rows. If we hit > 500 rows and renewable filter
  becomes slow, add a GIN index in a follow-up migration.
- No HTTP caching headers / ISR in V2b — pure SSR for simplicity. If
  homepage block becomes a hot path later, add `revalidate: 300` or
  similar.

---

## 10. Deployment

- Same as V1/V2a: local commits on the server, `npm run build && pm2
  restart poolwatt-web`. No push to GitHub.
- No new env vars.
- No DB migration.
- Public routes are stateless — no rolling-deploy concerns.

---

## 11. Open questions deferred to V2c / V2d / future

- **V2d (matching):** the listing page might want a "Request a quote
  from this contractor" CTA on each card that pre-fills a BuildRequest.
  Defer until V2d defines the claim model.
- **V2c (post-approval edit):** when admin allows owner to edit profile
  after APPROVED, the cache strategy may need to flip from pure SSR
  to ISR with revalidation on save.
- **Internationalization:** today bio is single-language (whatever the
  owner wrote). When we get bilingual contractors, decide whether
  Contractor.bio becomes Json `{ en: ..., ru: ..., sk: ... }`.
- **Sitemap:** V2b emits a single default-locale sitemap. Full
  locale-aware sitemap with `hreflang` annotations is a future SEO task.
- **Featured / promoted contractors:** if admin wants to highlight
  specific companies on the homepage (paid promotion or quality
  curation), add a `featured: Boolean @default(false)` column + admin
  toggle UI. Not needed at V2b.
- **Search box:** free-text search across displayName + bio. Add when
  we have > 50 contractors and a real user need.
