# Poolwatt — Contractor EV Charging Section (design)

**Date:** 2026-05-30
**Scope:** Extend the existing contractor registration cabinet (V2a) with
an optional "EV Charging Infrastructure" section. A contractor toggles
"this company operates EV charging stations" and fills a 7-field
questionnaire about their charging fleet (power source, connector
types, usage type, etc.). The new fields render publicly on
`/contractors/[slug]` and surface as a filter + badge on `/contractors`.
**Out of scope:** Per-station registration with addresses/coordinates;
integration with the existing `/navigator` mock chargers; OCPI / real-time
availability; bookings / payments; map view of contractor-operated
chargers.
**Phase:** Phase 2 extension of V2a. Builds directly on V2a's
`Contractor` model.

---

## 0. Roadmap context

This is an **incremental extension** of V2a — not a new sub-project. It
adds 4 enums + 8 nullable columns to `Contractor` and surfaces them in
the existing cabinet form and public detail page. No new routes, no
new models, no new server actions (extends the existing
`createContractor` / `updateContractor` via the existing zod schema +
form).

The reusable charger taxonomy in `src/lib/chargers.ts` (`ConnectorType`,
`PowerLevel`, `UsageType`) — already used by `/navigator` and `/c/[id]`
mocks — is **the source of truth for naming**. The new Prisma enums
mirror those names so future V2x can join contractor-operated chargers
with the navigator without taxonomy reconciliation.

---

## 1. What we ship

A signed-in OWNER editing `/me/contractor/new` (or `[id]/edit` while
PENDING) sees a new fieldset at the bottom of the form:

> **☐ This company operates EV charging stations**

Toggling it reveals a 7-question questionnaire. Toggling it off hides
and clears the fields.

The same data renders on:
- `/me/contractor/[id]` (owner view)
- `/admin/contractors/[id]` (admin view)
- `/contractors/[slug]` (public view) — only if `providesEvCharging === true`
- `/contractors` listing — small ⚡ badge on each card if true; new
  `?ev=true` filter narrows to only contractors with EV charging

Out of scope (deferred, explicitly):
- Per-station registration (`ContractorEvStation[]` with addresses /
  coordinates) — separate spec
- `/navigator` integration (merging contractor-operated chargers with
  existing mocks) — separate spec
- Real-time station status (free/busy/offline), OCPI hookup, bookings,
  payments
- "% green energy" sliders — V1 uses a coarse 3-option enum
- Per-locale `evDescription` — single language per contractor

---

## 2. Architecture

### Single-table extension

Considered three approaches:

| | Plan |
|---|---|
| **A1: Nullable fields on `Contractor`** *(chosen)* | One flag + 7 fields, all nullable. Single model. Smallest diff. |
| A2: Separate `EvChargingProfile` 1:1 to `Contractor` | Cleaner if EV grows large; overkill for V1 |
| A3: `ContractorEvStation[]` list of physical stations | Real charger model; future feature for navigator integration |

**Chosen: A1.** Contractor only gains 1 flag + 7 nullable columns.
Adding a station list (A3) later as `ContractorEvStation` table doesn't
require removing the A1 fields — they coexist as company-level summary
vs per-station detail.

### No new server actions

`createContractor` and `updateContractor` already accept a typed
`ContractorInput`. We extend `ContractorInput` (and the zod schema)
with the new fields. The existing actions' `data: { ... }` blocks
already copy every field — we just add to that map. Owner-only +
PENDING-only gates already apply.

### Form behavior

- The `providesEvCharging` checkbox is a controlled React state in
  `ContractorForm`.
- When `false`, the EV section is not rendered (no input names emitted)
  and the submit handler sends `providesEvCharging: false` with all
  other ev* fields `undefined`.
- When `true`, the section renders. Submit handler reads each EV field
  and sends them; the action persists. If owner later toggles off and
  re-saves, the action **wipes** the ev* fields to null.

---

## 3. Data model

### New Prisma enums

```prisma
enum EvPowerSource {
  GRID
  MIXED
  RENEWABLE_ONLY
}

enum EvConnectorType {
  CCS2
  CHAdeMO
  TYPE2
  TYPE1
  TESLA
  GB_T
  SCHUKO
}

enum EvPowerLevel {
  AC_SLOW           // ≤ 7 kW (Schuko / single-phase Type2)
  AC_FAST           // 11–22 kW (three-phase Type2)
  DC_FAST           // 50–150 kW (CCS, CHAdeMO)
  DC_ULTRA          // ≥ 150 kW (CCS, Tesla Supercharger V3+)
}

enum EvUsageType {
  PUBLIC
  MEMBERSHIP
  PRIVATE
  PAY_AT_LOCATION
}
```

### Additions to `Contractor` model

```prisma
model Contractor {
  // ... existing fields unchanged ...

  // EV charging extension
  providesEvCharging   Boolean              @default(false)
  evPowerSource        EvPowerSource?
  evStationCount       Int?
  evConnectorTypes     EvConnectorType[]
  evPowerLevels        EvPowerLevel[]
  evUsageType          EvUsageType?
  evMaxPowerKw         Decimal?             @db.Decimal(6, 2)
  evDescription        String?              @db.Text
}
```

All EV fields are nullable. `providesEvCharging` defaults to `false` so
existing rows stay unchanged.

### Validation (zod, append to `src/lib/contractor-schema.ts`)

Extend the `contractorSchema` z.object with:

```ts
providesEvCharging: z.boolean(),
evPowerSource: z.enum(["GRID", "MIXED", "RENEWABLE_ONLY"]).optional(),
evStationCount: z.number().int().min(1).max(10000).optional(),
evConnectorTypes: z.array(z.enum(["CCS2","CHAdeMO","TYPE2","TYPE1","TESLA","GB_T","SCHUKO"])).optional(),
evPowerLevels: z.array(z.enum(["AC_SLOW","AC_FAST","DC_FAST","DC_ULTRA"])).optional(),
evUsageType: z.enum(["PUBLIC","MEMBERSHIP","PRIVATE","PAY_AT_LOCATION"]).optional(),
evMaxPowerKw: z.number().min(3.7).max(400).optional(),
evDescription: z.string().min(50).max(2000).optional(),
```

Add cross-field checks in `superRefine`:

```ts
if (data.providesEvCharging) {
  if (!data.evPowerSource) addIssue("evPowerSource", "required when providesEvCharging");
  if (data.evStationCount == null) addIssue("evStationCount", "required when providesEvCharging");
  if (!data.evConnectorTypes || data.evConnectorTypes.length === 0)
    addIssue("evConnectorTypes", "at least one connector type required");
  if (!data.evPowerLevels || data.evPowerLevels.length === 0)
    addIssue("evPowerLevels", "at least one power level required");
  if (!data.evUsageType) addIssue("evUsageType", "required when providesEvCharging");
  if (data.evMaxPowerKw == null) addIssue("evMaxPowerKw", "required when providesEvCharging");
  if (!data.evDescription) addIssue("evDescription", "required when providesEvCharging");
  // No duplicates in arrays
  for (const f of ["evConnectorTypes","evPowerLevels"] as const) {
    const arr = data[f];
    if (arr && new Set(arr).size !== arr.length)
      addIssue(f, "no duplicates allowed");
  }
}
```

When `providesEvCharging === false`, the action stores all ev* as null /
empty array on update.

---

## 4. Routes & UI

No new routes. Touched files:

| File | Change |
|---|---|
| `prisma/schema.prisma` | 4 new enums + 8 new columns + run migration |
| `src/lib/contractor-schema.ts` | Add ev fields + superRefine checks |
| `src/app/[locale]/me/contractor/actions.ts` | `createContractor` + `updateContractor` data blocks: persist ev* (or wipe to null when off) |
| `src/components/cabinet/contractor-form.tsx` | New 4th fieldset "EV Charging Infrastructure" with conditional reveal |
| `src/lib/contractor-form-labels.ts` | Add `field.ev*` labels to the labels helper |
| `src/app/[locale]/me/contractor/[id]/page.tsx` | If `providesEvCharging`, render new section |
| `src/app/[locale]/admin/contractors/[id]/page.tsx` | Same — admin sees the same EV section |
| `src/components/contractor/contractor-card.tsx` | Add ⚡ badge if `providesEvCharging` |
| `src/app/[locale]/contractors/page.tsx` | Add `?ev=true` filter param + filter UI checkbox + adjust query |
| `src/components/contractor/contractor-filters.tsx` | Add EV checkbox |
| `src/app/[locale]/contractors/[slug]/page.tsx` | If `providesEvCharging`, render new public EV section |
| `src/lib/contractor-queries.ts` | Accept `ev?: boolean` in `readApprovedContractors`; ensure `PUBLIC_SELECT` includes the ev* fields |
| `messages/en.json`, `ru.json`, `sk.json` | Add `cabinet.contractor.field.ev*` and `public.contractor.detail.ev*` |

### Form section layout

```
[ existing 3 sections: Identity / What we do / Contact ]

────────── EV Charging Infrastructure ──────────

  ☐ This company operates EV charging stations
  ┊ (when checked, reveals:)
  ┊
  ┊  Power source [radio]
  ┊    ○ Grid (regular utility power)
  ┊    ○ Mixed (grid + own renewable / certified green)
  ┊    ○ Renewable only (100% own solar / wind / off-grid)
  ┊
  ┊  Number of stations operated [number 1–10000]
  ┊
  ┊  Connector types [multi-checkbox]
  ┊    ☐ CCS2  ☐ CHAdeMO  ☐ Type 2  ☐ Type 1
  ┊    ☐ Tesla ☐ GB/T     ☐ Schuko
  ┊
  ┊  Power levels [multi-checkbox]
  ┊    ☐ AC slow (≤7 kW)
  ┊    ☐ AC fast (11–22 kW)
  ┊    ☐ DC fast (50–150 kW)
  ┊    ☐ DC ultra (≥150 kW)
  ┊
  ┊  Access type [radio]
  ┊    ○ Public (anyone can use)
  ┊    ○ Membership (registered users only)
  ┊    ○ Private (own fleet / employees only)
  ┊    ○ Pay at location (cash / card at site)
  ┊
  ┊  Max power per point (kW) [number 3.7–400]
  ┊
  ┊  Description [textarea 50–2000]
  ┊    e.g. "12 stations along Bratislava-Vienna corridor,
  ┊          powered by 240 kW rooftop PV + grid backup,
  ┊          24/7 public with mobile app activation"
```

### Public detail page rendering

If `providesEvCharging === true`, render a new section after "Contact":

```
──────── EV Charging Infrastructure ⚡ ────────

Power source:     Renewable only (100% own solar)
Stations:         12
Connectors:       CCS2, Type 2
Power levels:     DC fast, DC ultra
Access:           Public
Max power:        150 kW

[description text, whitespace-preserved]
```

---

## 5. Listing filter

`/contractors` gains a third filter param `?ev=true`. Query becomes:

```ts
where: {
  status: "APPROVED",
  ...(args.country ? { country: args.country } : {}),
  ...(args.renewable ? { renewableTypes: { has: args.renewable } } : {}),
  ...(args.ev === true ? { providesEvCharging: true } : {}),
}
```

`ev` accepts only the literal string `"true"` — anything else is ignored.

Filter UI in `<ContractorFilters>`: a single checkbox **"☐ Only EV charging operators"** next to the existing two `<select>` controls.

---

## 6. Card badge

In `<ContractorCard>`, after the existing chips, if `providesEvCharging`:

```tsx
<span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-700 dark:text-yellow-300">
  ⚡ EV
</span>
```

(Tailwind chip with electric-bolt iconography.)

---

## 7. i18n

New keys under existing `cabinet.contractor.field`:

```
cabinet.contractor.field.providesEvCharging.label
cabinet.contractor.field.evPowerSource.{label, GRID, MIXED, RENEWABLE_ONLY, GRID_hint, MIXED_hint, RENEWABLE_ONLY_hint}
cabinet.contractor.field.evStationCount.label
cabinet.contractor.field.evConnectorTypes.{label, CCS2, CHAdeMO, TYPE2, TYPE1, TESLA, GB_T, SCHUKO}
cabinet.contractor.field.evPowerLevels.{label, AC_SLOW, AC_FAST, DC_FAST, DC_ULTRA}
cabinet.contractor.field.evUsageType.{label, PUBLIC, MEMBERSHIP, PRIVATE, PAY_AT_LOCATION}
cabinet.contractor.field.evMaxPowerKw.label
cabinet.contractor.field.evDescription.{label, placeholder}
```

Plus new section heading + public filter:

```
cabinet.contractor.new.section.ev          // form section heading
public.contractor.detail.ev               // detail section heading
public.contractor.detail.evBadge          // card badge text
public.contractor.filter.evOnly           // listing filter label
```

EN/RU/SK fully translated at merge.

---

## 8. Testing

### Unit (extend `src/lib/contractor-schema.test.ts`)

- accepts a valid contractor with `providesEvCharging: false` and no ev*
- accepts a valid contractor with `providesEvCharging: true` and all ev fields
- rejects `providesEvCharging: true` with missing `evPowerSource`
- rejects `providesEvCharging: true` with empty `evConnectorTypes`
- rejects `providesEvCharging: true` with duplicate `evConnectorTypes`
- rejects `providesEvCharging: true` with `evMaxPowerKw` out of range
- rejects `providesEvCharging: true` with `evDescription` < 50 chars

### Integration (extend `actions.test.ts`)

- `createContractor` with `providesEvCharging: true` + full ev set persists all fields
- `updateContractor` with `providesEvCharging: false` clears previously-set ev fields to null/empty array

### E2E (extend `tests/e2e/contractor-flow.spec.ts`)

Add to the existing happy-path test:
- toggle "operates EV stations" → fill 7 EV fields → submit
- on detail page, verify EV section renders
- after admin approves, on `/contractors` public listing, the card shows ⚡ EV badge
- on public detail, EV section renders with all 7 fields

### Public-side e2e (extend `tests/e2e/contractor-public.spec.ts`)

Seed an APPROVED contractor with `providesEvCharging: true` + full ev set.
- listing card shows ⚡ EV badge
- `?ev=true` filter narrows the list to only this contractor
- detail page shows the public EV section

---

## 9. Migration & deployment

- Single Prisma migration `add_contractor_ev_charging`. Adds 4 enums + 8
  nullable columns + `providesEvCharging` default false.
- Existing rows: untouched. `providesEvCharging` defaults to false.
- No data backfill.
- After build + `pm2 restart poolwatt-web`, the new section appears in
  the form. Existing approved contractors are unaffected (their `false`
  flag means no EV section rendered).

---

## 10. Open questions deferred to future

- **Per-station registration** (`ContractorEvStation[]` with lat/lng,
  individual hours, individual prices) — separate spec, needed for
  navigator integration.
- **Navigator integration** — merging contractor-operated stations with
  existing mock chargers on `/navigator`. Requires per-station model
  above. Separate spec.
- **OCPI / real-time status** — needs partner agreements. Out of scope
  indefinitely.
- **% green slider** (e.g., "70% renewable / 30% grid") — V1 uses
  trichotomy; finer granularity comes if real operators ask.
- **Pricing model field** (per kWh / per minute / subscription) — could
  add as a 4th enum. Deferred; description field captures it for now.
- **Localized `evDescription`** — single language per contractor in V1.
  When we get bilingual operators, decide between Json field or
  separate locale rows.
