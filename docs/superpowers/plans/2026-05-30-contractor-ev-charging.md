# Contractor EV Charging Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend V2a's `Contractor` cabinet with an optional "EV Charging Infrastructure" questionnaire — 1 boolean flag + 7 nullable fields surfaced in the form, owner/admin/public detail pages, and as a filter + ⚡ badge on `/contractors`.

**Architecture:** Single-table extension to `Contractor`. No new models or routes. Adds 4 Prisma enums (EvPowerSource, EvConnectorType, EvPowerLevel, EvUsageType) + 8 nullable columns. Reuses existing `createContractor` / `updateContractor` actions; extends the existing zod schema, form component, label helper, and queries module.

**Tech Stack:** Next.js 16, Prisma 5 (Postgres enum arrays), zod 4, next-intl 4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-05-30-contractor-ev-charging-design.md`

---

## Conventions

- **TDD** for schema + actions + queries.
- **Test layout**: co-located `*.test.ts`. E2E in `tests/e2e/`.
- **Commits**: one per task, message format `feat(contractor-ev): <what>`.
- **i18n**: EN + RU + SK at task time. Other 26 locales fall back to EN.

---

## Task 1: Prisma migration — 4 enums + 8 columns on Contractor

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_contractor_ev_charging/migration.sql` (auto-generated)

- [ ] **Step 1: Add 4 enums**

Append to `prisma/schema.prisma` after the existing `ContractorMemberRole` enum:

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
  AC_SLOW
  AC_FAST
  DC_FAST
  DC_ULTRA
}

enum EvUsageType {
  PUBLIC
  MEMBERSHIP
  PRIVATE
  PAY_AT_LOCATION
}
```

- [ ] **Step 2: Add 8 columns to `Contractor` model**

In the existing `Contractor { ... }` block, add the following fields BEFORE the `members` relation (so they group with other domain fields):

```prisma
  // EV charging extension
  providesEvCharging   Boolean              @default(false)
  evPowerSource        EvPowerSource?
  evStationCount       Int?
  evConnectorTypes     EvConnectorType[]
  evPowerLevels        EvPowerLevel[]
  evUsageType          EvUsageType?
  evMaxPowerKw         Decimal?             @db.Decimal(6, 2)
  evDescription        String?              @db.Text
```

- [ ] **Step 3: Generate the migration**

Run (DATABASE_URL is in `.env.local` — per project convention):

```bash
set -a && source .env.local && set +a && npm run db:migrate -- --name add_contractor_ev_charging
```

Expected: `Your database is now in sync with your schema.` + `✔ Generated Prisma Client`.

- [ ] **Step 4: Verify type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(contractor-ev): add 4 EV enums + 8 columns on Contractor"
```

---

## Task 2: Extend zod schema (TDD)

**Files:**
- Modify: `src/lib/contractor-schema.ts`
- Modify: `src/lib/contractor-schema.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/lib/contractor-schema.test.ts`:

```ts
describe("contractorSchema — EV charging extension", () => {
  const baseNoEv = { ...baseLegal, providesEvCharging: false };

  const baseWithEv = {
    ...baseLegal,
    providesEvCharging: true,
    evPowerSource: "MIXED" as const,
    evStationCount: 12,
    evConnectorTypes: ["CCS2", "TYPE2"] as const,
    evPowerLevels: ["DC_FAST"] as const,
    evUsageType: "PUBLIC" as const,
    evMaxPowerKw: 150,
    evDescription: "12 stations along the Bratislava-Vienna corridor, powered by rooftop PV plus grid backup.",
  };

  it("accepts a contractor with providesEvCharging=false and no ev fields", () => {
    expect(contractorSchema.safeParse(baseNoEv).success).toBe(true);
  });

  it("accepts a contractor with providesEvCharging=true and all ev fields", () => {
    expect(contractorSchema.safeParse(baseWithEv).success).toBe(true);
  });

  it("rejects providesEvCharging=true with missing evPowerSource", () => {
    const r = contractorSchema.safeParse({ ...baseWithEv, evPowerSource: undefined });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some(i => i.path[0] === "evPowerSource")).toBe(true);
  });

  it("rejects providesEvCharging=true with empty evConnectorTypes", () => {
    const r = contractorSchema.safeParse({ ...baseWithEv, evConnectorTypes: [] });
    expect(r.success).toBe(false);
  });

  it("rejects duplicate evConnectorTypes", () => {
    const r = contractorSchema.safeParse({
      ...baseWithEv,
      evConnectorTypes: ["CCS2", "CCS2"],
    });
    expect(r.success).toBe(false);
  });

  it("rejects evMaxPowerKw below 3.7", () => {
    const r = contractorSchema.safeParse({ ...baseWithEv, evMaxPowerKw: 2 });
    expect(r.success).toBe(false);
  });

  it("rejects evMaxPowerKw above 400", () => {
    const r = contractorSchema.safeParse({ ...baseWithEv, evMaxPowerKw: 500 });
    expect(r.success).toBe(false);
  });

  it("rejects evDescription shorter than 50 chars", () => {
    const r = contractorSchema.safeParse({ ...baseWithEv, evDescription: "too short" });
    expect(r.success).toBe(false);
  });
});
```

Note: the existing `baseLegal` fixture in this file is `ContractorInput`-typed without `providesEvCharging`. The new fields need to be added there too. Find the existing `const baseLegal` declaration and add `providesEvCharging: false` to it so it still type-checks after schema extension.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/contractor-schema.test.ts`
Expected: 8 new tests FAIL (because schema doesn't have `providesEvCharging` yet).

- [ ] **Step 3: Extend the schema**

In `src/lib/contractor-schema.ts`:

Add enum declarations near the existing ones (after `timelineEnum` / existing enums):

```ts
const evPowerSourceEnum = z.enum(["GRID", "MIXED", "RENEWABLE_ONLY"]);
const evConnectorTypeEnum = z.enum(["CCS2", "CHAdeMO", "TYPE2", "TYPE1", "TESLA", "GB_T", "SCHUKO"]);
const evPowerLevelEnum = z.enum(["AC_SLOW", "AC_FAST", "DC_FAST", "DC_ULTRA"]);
const evUsageTypeEnum = z.enum(["PUBLIC", "MEMBERSHIP", "PRIVATE", "PAY_AT_LOCATION"]);
```

Inside the main `z.object({ ... })` (BEFORE `.superRefine`), add:

```ts
providesEvCharging: z.boolean(),
evPowerSource: evPowerSourceEnum.optional(),
evStationCount: z.number().int().min(1).max(10000).optional(),
evConnectorTypes: z.array(evConnectorTypeEnum).optional(),
evPowerLevels: z.array(evPowerLevelEnum).optional(),
evUsageType: evUsageTypeEnum.optional(),
evMaxPowerKw: z.number().min(3.7).max(400).optional(),
evDescription: z.string().min(50).max(2000).optional(),
```

Add to the `superRefine` callback (at the end of the existing block):

```ts
if (data.providesEvCharging) {
  if (!data.evPowerSource) {
    ctx.addIssue({ code: "custom", path: ["evPowerSource"], message: "evPowerSource is required when providesEvCharging is true" });
  }
  if (data.evStationCount == null) {
    ctx.addIssue({ code: "custom", path: ["evStationCount"], message: "evStationCount is required when providesEvCharging is true" });
  }
  if (!data.evConnectorTypes || data.evConnectorTypes.length === 0) {
    ctx.addIssue({ code: "custom", path: ["evConnectorTypes"], message: "at least one evConnectorType required" });
  } else if (new Set(data.evConnectorTypes).size !== data.evConnectorTypes.length) {
    ctx.addIssue({ code: "custom", path: ["evConnectorTypes"], message: "no duplicates allowed" });
  }
  if (!data.evPowerLevels || data.evPowerLevels.length === 0) {
    ctx.addIssue({ code: "custom", path: ["evPowerLevels"], message: "at least one evPowerLevel required" });
  } else if (new Set(data.evPowerLevels).size !== data.evPowerLevels.length) {
    ctx.addIssue({ code: "custom", path: ["evPowerLevels"], message: "no duplicates allowed" });
  }
  if (!data.evUsageType) {
    ctx.addIssue({ code: "custom", path: ["evUsageType"], message: "evUsageType is required when providesEvCharging is true" });
  }
  if (data.evMaxPowerKw == null) {
    ctx.addIssue({ code: "custom", path: ["evMaxPowerKw"], message: "evMaxPowerKw is required when providesEvCharging is true" });
  }
  if (!data.evDescription) {
    ctx.addIssue({ code: "custom", path: ["evDescription"], message: "evDescription is required when providesEvCharging is true" });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/contractor-schema.test.ts`
Expected: all tests pass (existing + 8 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/contractor-schema.ts src/lib/contractor-schema.test.ts
git commit -m "feat(contractor-ev): extend zod schema with EV charging fields"
```

---

## Task 3: Extend server actions to persist EV fields (TDD)

**Files:**
- Modify: `src/app/[locale]/me/contractor/actions.ts`
- Modify: `src/app/[locale]/me/contractor/actions.test.ts`

- [ ] **Step 1: Add failing test**

Append to `src/app/[locale]/me/contractor/actions.test.ts`:

```ts
describe("createContractor — EV charging", () => {
  it("persists all ev* fields when providesEvCharging=true", async () => {
    const u = await ensureUser("test_ctr_ev_alice");
    mockedAuth.mockResolvedValueOnce({ user: { id: u.id, username: u.username, role: "USER" } } as never);

    const input = {
      ...baseInput,
      providesEvCharging: true,
      evPowerSource: "MIXED" as const,
      evStationCount: 7,
      evConnectorTypes: ["CCS2", "TYPE2"] as const,
      evPowerLevels: ["DC_FAST", "AC_FAST"] as const,
      evUsageType: "PUBLIC" as const,
      evMaxPowerKw: 150,
      evDescription: "Seven public DC fast chargers along the Bratislava–Žilina highway, powered by rooftop solar.",
    };

    const r = await createContractor(input);
    expect(r.ok).toBe(true);
    const stored = await prisma.contractor.findUniqueOrThrow({ where: { id: r.id! } });
    expect(stored.providesEvCharging).toBe(true);
    expect(stored.evPowerSource).toBe("MIXED");
    expect(stored.evStationCount).toBe(7);
    expect(stored.evConnectorTypes).toEqual(["CCS2", "TYPE2"]);
    expect(stored.evPowerLevels).toEqual(["DC_FAST", "AC_FAST"]);
    expect(stored.evUsageType).toBe("PUBLIC");
    expect(stored.evMaxPowerKw?.toNumber()).toBe(150);
    expect(stored.evDescription).toContain("Bratislava");
  });

  it("stores false + nulls when providesEvCharging=false", async () => {
    const u = await ensureUser("test_ctr_ev_bob");
    mockedAuth.mockResolvedValueOnce({ user: { id: u.id, username: u.username, role: "USER" } } as never);

    const r = await createContractor({ ...baseInput, providesEvCharging: false });
    expect(r.ok).toBe(true);
    const stored = await prisma.contractor.findUniqueOrThrow({ where: { id: r.id! } });
    expect(stored.providesEvCharging).toBe(false);
    expect(stored.evPowerSource).toBeNull();
    expect(stored.evStationCount).toBeNull();
    expect(stored.evConnectorTypes).toEqual([]);
    expect(stored.evPowerLevels).toEqual([]);
  });
});

describe("updateContractor — EV charging", () => {
  it("wipes ev fields to null/empty when toggled off", async () => {
    const u = await ensureUser("test_ctr_ev_carol");
    mockedAuth.mockResolvedValue({ user: { id: u.id, username: u.username, role: "USER" } } as never);

    // create with EV on
    const created = await createContractor({
      ...baseInput,
      providesEvCharging: true,
      evPowerSource: "GRID",
      evStationCount: 3,
      evConnectorTypes: ["TYPE2"],
      evPowerLevels: ["AC_FAST"],
      evUsageType: "MEMBERSHIP",
      evMaxPowerKw: 22,
      evDescription: "Three 22 kW AC Type 2 stations behind the Bratislava office for member-only use.",
    });
    expect(created.ok).toBe(true);

    // update with EV off
    const upd = await updateContractor(created.id!, { ...baseInput, providesEvCharging: false });
    expect(upd.ok).toBe(true);

    const reloaded = await prisma.contractor.findUniqueOrThrow({ where: { id: created.id! } });
    expect(reloaded.providesEvCharging).toBe(false);
    expect(reloaded.evPowerSource).toBeNull();
    expect(reloaded.evStationCount).toBeNull();
    expect(reloaded.evConnectorTypes).toEqual([]);
    expect(reloaded.evPowerLevels).toEqual([]);
    expect(reloaded.evUsageType).toBeNull();
    expect(reloaded.evMaxPowerKw).toBeNull();
    expect(reloaded.evDescription).toBeNull();
  });
});
```

ALSO: update the existing `baseInput` fixture in the same file — add `providesEvCharging: false` to keep it valid for the new schema. Find `const baseInput: ContractorInput = { ... }` and add `providesEvCharging: false,` right after `entityType: "LEGAL_ENTITY"` (or anywhere in the object — order doesn't matter for schema validation).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/[locale]/me/contractor/actions.test.ts`
Expected: 3 new tests fail (because the action doesn't persist ev fields yet).

- [ ] **Step 3: Update `createContractor` data block**

In `src/app/[locale]/me/contractor/actions.ts`, find the `prisma.$transaction` call in `createContractor`. In the `tx.contractor.create({ data: { ... } })` block, add the new EV fields to the data object (after `contactPhone`):

```ts
providesEvCharging: d.providesEvCharging,
evPowerSource: d.providesEvCharging ? (d.evPowerSource ?? null) : null,
evStationCount: d.providesEvCharging ? (d.evStationCount ?? null) : null,
evConnectorTypes: d.providesEvCharging ? (d.evConnectorTypes ?? []) : [],
evPowerLevels: d.providesEvCharging ? (d.evPowerLevels ?? []) : [],
evUsageType: d.providesEvCharging ? (d.evUsageType ?? null) : null,
evMaxPowerKw: d.providesEvCharging ? (d.evMaxPowerKw ?? null) : null,
evDescription: d.providesEvCharging ? (d.evDescription ?? null) : null,
```

- [ ] **Step 4: Update `updateContractor` data block**

In the same file, the `updateContractor` function has a `// keep in sync with createContractor's data block` comment above its own data block. Add the same EV field block there, identical to what you added in createContractor.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/app/[locale]/me/contractor/actions.test.ts`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/[locale]/me/contractor/actions.ts \
  src/app/[locale]/me/contractor/actions.test.ts
git commit -m "feat(contractor-ev): persist EV fields in create/update actions"
```

---

## Task 4: Extend contractor-queries with EV filter + PUBLIC_SELECT (TDD)

**Files:**
- Modify: `src/lib/contractor-queries.ts`
- Modify: `src/lib/contractor-queries.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/lib/contractor-queries.test.ts` BEFORE the closing afterAll:

```ts
describe("readApprovedContractors — EV filter", () => {
  it("includes EV fields in PUBLIC_SELECT", async () => {
    const { rows } = await readApprovedContractors({ pageSize: 50 });
    const ours = rows.filter((r) => r.slug.startsWith(PREFIX));
    expect(ours.length).toBeGreaterThan(0);
    for (const r of ours) {
      expect(r).toHaveProperty("providesEvCharging");
      expect(r).toHaveProperty("evPowerSource");
      expect(r).toHaveProperty("evConnectorTypes");
    }
  });

  it("filters to EV-only when ev=true", async () => {
    // mark one of our seeded approved contractors as EV
    const target = await prisma.contractor.findFirstOrThrow({
      where: { slug: `${PREFIX}a-approved-sk-solar` },
    });
    await prisma.contractor.update({
      where: { id: target.id },
      data: {
        providesEvCharging: true,
        evPowerSource: "MIXED",
        evStationCount: 3,
        evConnectorTypes: ["TYPE2"],
        evPowerLevels: ["AC_FAST"],
        evUsageType: "PUBLIC",
        evMaxPowerKw: 22,
        evDescription: "Three Type 2 AC stations powered by our rooftop solar plus grid backup for visitors.",
      },
    });

    const { rows } = await readApprovedContractors({ ev: true, pageSize: 50 });
    const ours = rows.filter((r) => r.slug.startsWith(PREFIX));
    expect(ours.length).toBe(1);
    expect(ours[0].slug).toBe(`${PREFIX}a-approved-sk-solar`);

    // restore
    await prisma.contractor.update({
      where: { id: target.id },
      data: { providesEvCharging: false },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/contractor-queries.test.ts`
Expected: 2 new tests fail — `readApprovedContractors` doesn't yet accept `ev`; also `PUBLIC_SELECT` doesn't include ev fields yet.

- [ ] **Step 3: Update PUBLIC_SELECT + add ev arg**

In `src/lib/contractor-queries.ts`, extend `PUBLIC_SELECT` (it's a `const` object literal — add at the end before the closing `} as const`):

```ts
providesEvCharging: true,
evPowerSource: true,
evStationCount: true,
evConnectorTypes: true,
evPowerLevels: true,
evUsageType: true,
evMaxPowerKw: true,
evDescription: true,
```

Update the `readApprovedContractors` args type and where-clause builder:

```ts
export async function readApprovedContractors(args: {
  country?: string;
  renewable?: ContractorRenewableType;
  ev?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<PublicContractorList> {
  const page = Math.max(1, args.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, args.pageSize ?? 24));
  const where = {
    status: "APPROVED" as const,
    ...(args.country ? { country: args.country } : {}),
    ...(args.renewable ? { renewableTypes: { has: args.renewable } } : {}),
    ...(args.ev === true ? { providesEvCharging: true } : {}),
  };
  // ... rest unchanged
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/contractor-queries.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/contractor-queries.ts src/lib/contractor-queries.test.ts
git commit -m "feat(contractor-ev): add ev filter + EV fields to PUBLIC_SELECT"
```

---

## Task 5: i18n EN/RU/SK

**Files:**
- Modify: `messages/en.json`, `messages/ru.json`, `messages/sk.json`

- [ ] **Step 1: Add EN keys**

Under `cabinet.contractor.field`, add the new EV keys. Under `cabinet.contractor.new.section`, add `"ev"`. Under `public.contractor.detail`, add the new EV keys. Under `public.contractor.filter`, add `evOnly`. Under `public.contractor.detail`, add `evBadge`.

In `messages/en.json`, add to existing `cabinet.contractor.new.section`:
```json
"ev": "EV Charging Infrastructure"
```

Add to existing `cabinet.contractor.field`:
```json
"providesEvCharging": { "label": "This company operates EV charging stations" },
"evPowerSource": {
  "label": "Power source",
  "GRID": "Grid (regular utility power)",
  "MIXED": "Mixed (grid + own renewable / certified green)",
  "RENEWABLE_ONLY": "Renewable only (100% own solar / wind / off-grid)"
},
"evStationCount": { "label": "Number of charging stations operated" },
"evConnectorTypes": {
  "label": "Connector types",
  "CCS2": "CCS2", "CHAdeMO": "CHAdeMO", "TYPE2": "Type 2",
  "TYPE1": "Type 1", "TESLA": "Tesla", "GB_T": "GB/T", "SCHUKO": "Schuko"
},
"evPowerLevels": {
  "label": "Power levels",
  "AC_SLOW": "AC slow (≤7 kW)",
  "AC_FAST": "AC fast (11–22 kW)",
  "DC_FAST": "DC fast (50–150 kW)",
  "DC_ULTRA": "DC ultra (≥150 kW)"
},
"evUsageType": {
  "label": "Access type",
  "PUBLIC": "Public (anyone can use)",
  "MEMBERSHIP": "Membership (registered users only)",
  "PRIVATE": "Private (own fleet / employees only)",
  "PAY_AT_LOCATION": "Pay at location (cash / card)"
},
"evMaxPowerKw": { "label": "Max power per point (kW)" },
"evDescription": {
  "label": "Description of your EV charging infrastructure",
  "placeholder": "e.g. 12 stations along the Bratislava–Vienna corridor, powered by 240 kW rooftop PV + grid backup, 24/7 public with mobile app activation"
}
```

Add to existing `public.contractor.detail`:
```json
"ev": "EV Charging Infrastructure",
"evBadge": "EV"
```

Add to existing `public.contractor.filter`:
```json
"evOnly": "Only EV charging operators"
```

- [ ] **Step 2: Add RU keys**

Mirror in `messages/ru.json`:
- `cabinet.contractor.new.section.ev` → `"Зарядка для электромобилей"`
- `cabinet.contractor.field.providesEvCharging.label` → `"Эта компания управляет EV-зарядными станциями"`
- `cabinet.contractor.field.evPowerSource.label` → `"Источник электроэнергии"`
- `cabinet.contractor.field.evPowerSource.GRID` → `"Сеть (обычное электричество)"`
- `cabinet.contractor.field.evPowerSource.MIXED` → `"Смешанная (сеть + своя зелёная / зелёный сертификат)"`
- `cabinet.contractor.field.evPowerSource.RENEWABLE_ONLY` → `"Только зелёная (100% свои солнечные / ветровые / off-grid)"`
- `cabinet.contractor.field.evStationCount.label` → `"Количество зарядных станций"`
- `cabinet.contractor.field.evConnectorTypes.label` → `"Типы коннекторов"`
- (connector type values: CCS2/CHAdeMO/Type 2/Type 1/Tesla/GB/T/Schuko — keep as English brand names)
- `cabinet.contractor.field.evPowerLevels.label` → `"Уровни мощности"`
- `cabinet.contractor.field.evPowerLevels.AC_SLOW` → `"AC slow (≤7 кВт)"`
- `cabinet.contractor.field.evPowerLevels.AC_FAST` → `"AC fast (11–22 кВт)"`
- `cabinet.contractor.field.evPowerLevels.DC_FAST` → `"DC fast (50–150 кВт)"`
- `cabinet.contractor.field.evPowerLevels.DC_ULTRA` → `"DC ultra (≥150 кВт)"`
- `cabinet.contractor.field.evUsageType.label` → `"Тип доступа"`
- `cabinet.contractor.field.evUsageType.PUBLIC` → `"Публичный (любой может использовать)"`
- `cabinet.contractor.field.evUsageType.MEMBERSHIP` → `"По подписке (только зарегистрированные)"`
- `cabinet.contractor.field.evUsageType.PRIVATE` → `"Приватный (только сотрудники / свой парк)"`
- `cabinet.contractor.field.evUsageType.PAY_AT_LOCATION` → `"Оплата на месте (наличные / карта)"`
- `cabinet.contractor.field.evMaxPowerKw.label` → `"Макс. мощность на точку (кВт)"`
- `cabinet.contractor.field.evDescription.label` → `"Описание EV-зарядной инфраструктуры"`
- `cabinet.contractor.field.evDescription.placeholder` → `"например: 12 станций вдоль трассы Братислава–Вена, питание от 240 кВт солнечных панелей на крыше + резерв из сети, 24/7 публичные с активацией через мобильное приложение"`
- `public.contractor.detail.ev` → `"Зарядка для электромобилей"`
- `public.contractor.detail.evBadge` → `"EV"`
- `public.contractor.filter.evOnly` → `"Только EV-операторы"`

- [ ] **Step 3: Add SK keys**

Mirror in `messages/sk.json`:
- `cabinet.contractor.new.section.ev` → `"Nabíjacia infraštruktúra pre EV"`
- `cabinet.contractor.field.providesEvCharging.label` → `"Táto firma prevádzkuje EV nabíjacie stanice"`
- `cabinet.contractor.field.evPowerSource.label` → `"Zdroj elektriny"`
- `cabinet.contractor.field.evPowerSource.GRID` → `"Sieť (bežná elektrina)"`
- `cabinet.contractor.field.evPowerSource.MIXED` → `"Zmiešané (sieť + vlastné OZE / certifikovaná zelená)"`
- `cabinet.contractor.field.evPowerSource.RENEWABLE_ONLY` → `"Iba zelená (100% vlastné solárne / veterné / off-grid)"`
- `cabinet.contractor.field.evStationCount.label` → `"Počet prevádzkovaných nabíjacích staníc"`
- `cabinet.contractor.field.evConnectorTypes.label` → `"Typy konektorov"`
- `cabinet.contractor.field.evPowerLevels.label` → `"Úrovne výkonu"`
- `cabinet.contractor.field.evPowerLevels.AC_SLOW` → `"AC pomalé (≤7 kW)"`
- `cabinet.contractor.field.evPowerLevels.AC_FAST` → `"AC rýchle (11–22 kW)"`
- `cabinet.contractor.field.evPowerLevels.DC_FAST` → `"DC rýchle (50–150 kW)"`
- `cabinet.contractor.field.evPowerLevels.DC_ULTRA` → `"DC ultra (≥150 kW)"`
- `cabinet.contractor.field.evUsageType.label` → `"Typ prístupu"`
- `cabinet.contractor.field.evUsageType.PUBLIC` → `"Verejný (každý môže použiť)"`
- `cabinet.contractor.field.evUsageType.MEMBERSHIP` → `"Členské (iba registrovaní)"`
- `cabinet.contractor.field.evUsageType.PRIVATE` → `"Súkromný (vlastný fleet / zamestnanci)"`
- `cabinet.contractor.field.evUsageType.PAY_AT_LOCATION` → `"Platba na mieste (hotovosť / karta)"`
- `cabinet.contractor.field.evMaxPowerKw.label` → `"Max. výkon na bod (kW)"`
- `cabinet.contractor.field.evDescription.label` → `"Popis vašej EV nabíjacej infraštruktúry"`
- `cabinet.contractor.field.evDescription.placeholder` → `"napr. 12 staníc pozdĺž koridoru Bratislava–Viedeň, napájané 240 kW strešnými PV + záloha zo siete, 24/7 verejné s aktiváciou cez mobilnú aplikáciu"`
- `public.contractor.detail.ev` → `"Nabíjacia infraštruktúra pre EV"`
- `public.contractor.detail.evBadge` → `"EV"`
- `public.contractor.filter.evOnly` → `"Iba EV operátori"`

- [ ] **Step 4: Verify JSON parses**

Run: `node -e "['en','ru','sk'].forEach(l => JSON.parse(require('fs').readFileSync('messages/'+l+'.json','utf-8')))"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add messages/en.json messages/ru.json messages/sk.json
git commit -m "feat(contractor-ev): add EN/RU/SK i18n strings"
```

---

## Task 6: Extend label helper + ContractorForm with EV fieldset

**Files:**
- Modify: `src/lib/contractor-form-labels.ts`
- Modify: `src/components/cabinet/contractor-form.tsx`

- [ ] **Step 1: Extend label helper**

In `src/lib/contractor-form-labels.ts`, extend the `ContractorFormLabels` type:

```ts
export type ContractorFormLabels = {
  section: { identity: string; work: string; contact: string; ev: string };
  field: Record<string, Record<string, string>>;
  action: { submit: string; save: string };
};
```

In `getContractorFormLabels`, add `ev: t("new.section.ev")` to the `section` block, and add EV fields to `field`:

```ts
return {
  section: {
    identity: t("new.section.identity"),
    work: t("new.section.work"),
    contact: t("new.section.contact"),
    ev: t("new.section.ev"),
  },
  field: {
    // ... existing fields unchanged ...
    providesEvCharging: { label: t("field.providesEvCharging.label") },
    evPowerSource: {
      label: t("field.evPowerSource.label"),
      GRID: t("field.evPowerSource.GRID"),
      MIXED: t("field.evPowerSource.MIXED"),
      RENEWABLE_ONLY: t("field.evPowerSource.RENEWABLE_ONLY"),
    },
    evStationCount: { label: t("field.evStationCount.label") },
    evConnectorTypes: {
      label: t("field.evConnectorTypes.label"),
      CCS2: t("field.evConnectorTypes.CCS2"),
      CHAdeMO: t("field.evConnectorTypes.CHAdeMO"),
      TYPE2: t("field.evConnectorTypes.TYPE2"),
      TYPE1: t("field.evConnectorTypes.TYPE1"),
      TESLA: t("field.evConnectorTypes.TESLA"),
      GB_T: t("field.evConnectorTypes.GB_T"),
      SCHUKO: t("field.evConnectorTypes.SCHUKO"),
    },
    evPowerLevels: {
      label: t("field.evPowerLevels.label"),
      AC_SLOW: t("field.evPowerLevels.AC_SLOW"),
      AC_FAST: t("field.evPowerLevels.AC_FAST"),
      DC_FAST: t("field.evPowerLevels.DC_FAST"),
      DC_ULTRA: t("field.evPowerLevels.DC_ULTRA"),
    },
    evUsageType: {
      label: t("field.evUsageType.label"),
      PUBLIC: t("field.evUsageType.PUBLIC"),
      MEMBERSHIP: t("field.evUsageType.MEMBERSHIP"),
      PRIVATE: t("field.evUsageType.PRIVATE"),
      PAY_AT_LOCATION: t("field.evUsageType.PAY_AT_LOCATION"),
    },
    evMaxPowerKw: { label: t("field.evMaxPowerKw.label") },
    evDescription: { label: t("field.evDescription.label"), placeholder: t("field.evDescription.placeholder") },
    // existing fields stay
  },
  action: { submit: t("action.submit"), save: t("action.save") },
};
```

- [ ] **Step 2: Extend ContractorForm**

In `src/components/cabinet/contractor-form.tsx`:

Add constants near the existing `WORK_VALUES` / `RENEWABLE_VALUES`:

```ts
const EV_POWER_SOURCES = ["GRID", "MIXED", "RENEWABLE_ONLY"] as const;
const EV_CONNECTOR_TYPES = ["CCS2", "CHAdeMO", "TYPE2", "TYPE1", "TESLA", "GB_T", "SCHUKO"] as const;
const EV_POWER_LEVELS = ["AC_SLOW", "AC_FAST", "DC_FAST", "DC_ULTRA"] as const;
const EV_USAGE_TYPES = ["PUBLIC", "MEMBERSHIP", "PRIVATE", "PAY_AT_LOCATION"] as const;
```

Add new React state near the existing `entityType` / `workCategories` state:

```ts
const [providesEvCharging, setProvidesEvCharging] = useState<boolean>(initial?.providesEvCharging ?? false);
const [evPowerSource, setEvPowerSource] = useState<"GRID" | "MIXED" | "RENEWABLE_ONLY" | "">(initial?.evPowerSource ?? "");
const [evConnectorTypes, setEvConnectorTypes] = useState<string[]>((initial?.evConnectorTypes as string[] | undefined) ?? []);
const [evPowerLevels, setEvPowerLevels] = useState<string[]>((initial?.evPowerLevels as string[] | undefined) ?? []);
const [evUsageType, setEvUsageType] = useState<"PUBLIC" | "MEMBERSHIP" | "PRIVATE" | "PAY_AT_LOCATION" | "">(initial?.evUsageType ?? "");
```

In the `onSubmit` function, add EV fields to the `input` object (after the existing fields, before the `as ContractorInput` cast):

```ts
const evStationCountRaw = String(formData.get("evStationCount") ?? "");
const evMaxPowerKwRaw = String(formData.get("evMaxPowerKw") ?? "");

const input = {
  // ... existing fields ...
  providesEvCharging,
  evPowerSource: providesEvCharging ? (evPowerSource || undefined) : undefined,
  evStationCount: providesEvCharging && evStationCountRaw ? Number(evStationCountRaw) : undefined,
  evConnectorTypes: providesEvCharging ? (evConnectorTypes as ContractorInput["evConnectorTypes"]) : undefined,
  evPowerLevels: providesEvCharging ? (evPowerLevels as ContractorInput["evPowerLevels"]) : undefined,
  evUsageType: providesEvCharging ? (evUsageType || undefined) : undefined,
  evMaxPowerKw: providesEvCharging && evMaxPowerKwRaw ? Number(evMaxPowerKwRaw) : undefined,
  evDescription: providesEvCharging ? (String(formData.get("evDescription") ?? "") || undefined) : undefined,
} as ContractorInput;
```

Add a NEW `<fieldset>` BEFORE the closing `<form>` and the sticky submit bar, after the existing "Contact & profile" fieldset:

```tsx
<fieldset className="space-y-4">
  <legend className="text-lg font-semibold">{labels.section.ev}</legend>

  <label className="flex items-center gap-2">
    <input
      type="checkbox"
      checked={providesEvCharging}
      onChange={(e) => setProvidesEvCharging(e.target.checked)}
    />
    {labels.field.providesEvCharging.label}
  </label>

  {providesEvCharging && (
    <div className="space-y-4 pl-6 border-l-2 border-accent/30">
      <div>
        <p className="text-sm mb-2">{labels.field.evPowerSource.label}</p>
        <div className="space-y-2">
          {EV_POWER_SOURCES.map((v) => (
            <label key={v} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="evPowerSource"
                value={v}
                checked={evPowerSource === v}
                onChange={() => setEvPowerSource(v)}
                className="mt-1"
              />
              <span>{labels.field.evPowerSource[v]}</span>
            </label>
          ))}
        </div>
        {errors.evPowerSource && <p className="text-red-600 text-xs mt-1">{errors.evPowerSource}</p>}
      </div>

      <div>
        <label className="block text-sm mb-1">{labels.field.evStationCount.label}</label>
        <input
          name="evStationCount" type="number" min="1" max="10000"
          defaultValue={initial?.evStationCount ?? ""}
          className="border border-hairline rounded px-3 py-2 w-40"
        />
        {errors.evStationCount && <p className="text-red-600 text-xs mt-1">{errors.evStationCount}</p>}
      </div>

      <div>
        <p className="text-sm mb-2">{labels.field.evConnectorTypes.label}</p>
        <div className="grid grid-cols-2 gap-2">
          {EV_CONNECTOR_TYPES.map((v) => (
            <label key={v} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={evConnectorTypes.includes(v)}
                onChange={() => toggle(evConnectorTypes, v, setEvConnectorTypes)}
              />
              {labels.field.evConnectorTypes[v]}
            </label>
          ))}
        </div>
        {errors.evConnectorTypes && <p className="text-red-600 text-xs mt-1">{errors.evConnectorTypes}</p>}
      </div>

      <div>
        <p className="text-sm mb-2">{labels.field.evPowerLevels.label}</p>
        <div className="grid grid-cols-2 gap-2">
          {EV_POWER_LEVELS.map((v) => (
            <label key={v} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={evPowerLevels.includes(v)}
                onChange={() => toggle(evPowerLevels, v, setEvPowerLevels)}
              />
              {labels.field.evPowerLevels[v]}
            </label>
          ))}
        </div>
        {errors.evPowerLevels && <p className="text-red-600 text-xs mt-1">{errors.evPowerLevels}</p>}
      </div>

      <div>
        <p className="text-sm mb-2">{labels.field.evUsageType.label}</p>
        <div className="space-y-2">
          {EV_USAGE_TYPES.map((v) => (
            <label key={v} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="evUsageType"
                value={v}
                checked={evUsageType === v}
                onChange={() => setEvUsageType(v)}
                className="mt-1"
              />
              <span>{labels.field.evUsageType[v]}</span>
            </label>
          ))}
        </div>
        {errors.evUsageType && <p className="text-red-600 text-xs mt-1">{errors.evUsageType}</p>}
      </div>

      <div>
        <label className="block text-sm mb-1">{labels.field.evMaxPowerKw.label}</label>
        <input
          name="evMaxPowerKw" type="number" step="0.1" min="3.7" max="400"
          defaultValue={initial?.evMaxPowerKw ?? ""}
          className="border border-hairline rounded px-3 py-2 w-40"
        />
        {errors.evMaxPowerKw && <p className="text-red-600 text-xs mt-1">{errors.evMaxPowerKw}</p>}
      </div>

      <div>
        <label className="block text-sm mb-1">{labels.field.evDescription.label}</label>
        <textarea
          name="evDescription"
          defaultValue={initial?.evDescription ?? ""}
          rows={4}
          maxLength={2000}
          placeholder={labels.field.evDescription.placeholder}
          className="border border-hairline rounded px-3 py-2 w-full"
        />
        {errors.evDescription && <p className="text-red-600 text-xs mt-1">{errors.evDescription}</p>}
      </div>
    </div>
  )}
</fieldset>
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors. (Pre-existing errors in `reset-password/page.tsx` and `verify-email/page.tsx` are unrelated.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/contractor-form-labels.ts src/components/cabinet/contractor-form.tsx
git commit -m "feat(contractor-ev): add EV charging fieldset to contractor form"
```

---

## Task 7: Owner + admin detail pages render EV section

**Files:**
- Modify: `src/app/[locale]/me/contractor/[id]/page.tsx`
- Modify: `src/app/[locale]/admin/contractors/[id]/page.tsx`

- [ ] **Step 1: Add EV section to owner detail page**

In `src/app/[locale]/me/contractor/[id]/page.tsx`, after the existing `<dl>` block that lists the fields, add a conditional EV section:

```tsx
{c.providesEvCharging && (
  <section className="mt-10 border border-hairline rounded-lg p-5">
    <h2 className="text-sm uppercase tracking-wider text-muted mb-3">
      ⚡ {t("field.providesEvCharging.label").replace(/^This company /, "")}
    </h2>
    <dl className="grid grid-cols-[180px_1fr] gap-y-2 text-sm">
      <dt className="text-muted">{t("field.evPowerSource.label")}</dt>
      <dd>{c.evPowerSource ? t(`field.evPowerSource.${c.evPowerSource}`) : "—"}</dd>
      <dt className="text-muted">{t("field.evStationCount.label")}</dt>
      <dd>{c.evStationCount ?? "—"}</dd>
      <dt className="text-muted">{t("field.evConnectorTypes.label")}</dt>
      <dd>{c.evConnectorTypes.map(k => t(`field.evConnectorTypes.${k}`)).join(", ")}</dd>
      <dt className="text-muted">{t("field.evPowerLevels.label")}</dt>
      <dd>{c.evPowerLevels.map(k => t(`field.evPowerLevels.${k}`)).join(", ")}</dd>
      <dt className="text-muted">{t("field.evUsageType.label")}</dt>
      <dd>{c.evUsageType ? t(`field.evUsageType.${c.evUsageType}`) : "—"}</dd>
      <dt className="text-muted">{t("field.evMaxPowerKw.label")}</dt>
      <dd>{c.evMaxPowerKw ? `${c.evMaxPowerKw.toString()} kW` : "—"}</dd>
      <dt className="text-muted">{t("field.evDescription.label")}</dt>
      <dd className="whitespace-pre-wrap">{c.evDescription}</dd>
    </dl>
  </section>
)}
```

- [ ] **Step 2: Add EV section to admin detail page**

In `src/app/[locale]/admin/contractors/[id]/page.tsx`, after the existing "Contact & profile" section and before the "Status" section, add:

```tsx
{c.providesEvCharging && (
  <section className="border border-hairline rounded p-4">
    <h2 className="text-sm uppercase tracking-wide text-muted mb-2">⚡ EV Charging</h2>
    <p>Power source: <b>{c.evPowerSource}</b></p>
    <p>Stations: <span className="num">{c.evStationCount}</span></p>
    <p>Connectors: {c.evConnectorTypes.join(", ")}</p>
    <p>Power levels: {c.evPowerLevels.join(", ")}</p>
    <p>Access: {c.evUsageType}</p>
    <p>Max power: <span className="num">{c.evMaxPowerKw?.toString()}</span> kW</p>
    {c.evDescription && <p className="mt-2 whitespace-pre-wrap text-sm">{c.evDescription}</p>}
  </section>
)}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/me/contractor/[id]/page.tsx \
  src/app/[locale]/admin/contractors/[id]/page.tsx
git commit -m "feat(contractor-ev): render EV section on owner + admin detail pages"
```

---

## Task 8: ContractorCard badge + public detail EV section

**Files:**
- Modify: `src/components/contractor/contractor-card.tsx`
- Modify: `src/app/[locale]/contractors/[slug]/page.tsx`

- [ ] **Step 1: Add ⚡ EV badge to ContractorCard**

In `src/components/contractor/contractor-card.tsx`, update the `Props` type to include `providesEvCharging`:

```ts
type Props = {
  locale: string;
  contractor: Pick<
    PublicContractor,
    "slug" | "displayName" | "entityType" | "country" | "city" |
    "workCategories" | "renewableTypes" | "logoUrl" | "providesEvCharging"
  >;
};
```

Add a translation lookup at the top of the component:

```ts
const tPublic = await getTranslations("public.contractor.detail");
```

In the chips/badges row at the bottom of the card, append after the renewable chips:

```tsx
{c.providesEvCharging && (
  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-700 dark:text-yellow-300">
    ⚡ {tPublic("evBadge")}
  </span>
)}
```

- [ ] **Step 2: Add public EV section to detail page**

In `src/app/[locale]/contractors/[slug]/page.tsx`, after the existing "Contact" section and BEFORE the optional "Company info" section, add:

```tsx
{c.providesEvCharging && (
  <section className="border border-hairline rounded-lg p-5 mb-8">
    <h2 className="text-sm uppercase tracking-wider text-muted mb-3">
      ⚡ {tDetail("ev")}
    </h2>
    <dl className="grid grid-cols-[180px_1fr] gap-y-2 text-sm">
      <dt className="text-muted">{tField("evPowerSource.label")}</dt>
      <dd>{c.evPowerSource ? tField(`evPowerSource.${c.evPowerSource}`) : "—"}</dd>
      <dt className="text-muted">{tField("evStationCount.label")}</dt>
      <dd className="num">{c.evStationCount}</dd>
      <dt className="text-muted">{tField("evConnectorTypes.label")}</dt>
      <dd>{c.evConnectorTypes.map(k => tField(`evConnectorTypes.${k}`)).join(", ")}</dd>
      <dt className="text-muted">{tField("evPowerLevels.label")}</dt>
      <dd>{c.evPowerLevels.map(k => tField(`evPowerLevels.${k}`)).join(", ")}</dd>
      <dt className="text-muted">{tField("evUsageType.label")}</dt>
      <dd>{c.evUsageType ? tField(`evUsageType.${c.evUsageType}`) : "—"}</dd>
      <dt className="text-muted">{tField("evMaxPowerKw.label")}</dt>
      <dd><span className="num">{c.evMaxPowerKw?.toString()}</span> kW</dd>
    </dl>
    {c.evDescription && (
      <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{c.evDescription}</p>
    )}
  </section>
)}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/contractor/contractor-card.tsx \
  src/app/[locale]/contractors/[slug]/page.tsx
git commit -m "feat(contractor-ev): add EV badge + public EV section"
```

---

## Task 9: `?ev=true` filter on /contractors

**Files:**
- Modify: `src/components/contractor/contractor-filters.tsx`
- Modify: `src/app/[locale]/contractors/page.tsx`

- [ ] **Step 1: Add EV checkbox to ContractorFilters**

In `src/components/contractor/contractor-filters.tsx`, extend the `Props` type:

```ts
type Props = {
  locale: string;
  initialCountry: string;
  initialRenewable: string;
  initialEv: boolean;
  countryOptions: string[];
  labels: {
    country: string;
    renewable: string;
    all: string;
    apply: string;
    clear: string;
    evOnly: string;
    renewableLabels: Record<string, string>;
  };
};
```

Add state for ev:

```ts
const [ev, setEv] = useState<boolean>(initialEv);
```

In `apply()`, add ev to the query string:

```ts
if (ev) qs.set("ev", "true");
```

In `clear()`, also reset ev:

```ts
setEv(false);
```

Update `hasFilters`:

```ts
const hasFilters = country || renewable || ev;
```

Add the checkbox between the renewable `<select>` and the buttons:

```tsx
<label className="flex items-center gap-2 text-sm">
  <input
    type="checkbox"
    checked={ev}
    onChange={(e) => setEv(e.target.checked)}
  />
  ⚡ {labels.evOnly}
</label>
```

- [ ] **Step 2: Wire `ev` searchParam through `/contractors` page**

In `src/app/[locale]/contractors/page.tsx`:

Update the searchParams type:

```ts
searchParams: Promise<{ country?: string; renewable?: string; ev?: string; page?: string }>;
```

Destructure the new param:

```ts
const { country: rc, renewable: rr, ev: re, page: rp } = await searchParams;
```

Add validation:

```ts
const ev = re === "true" ? true : undefined;
```

Pass `ev` to `readApprovedContractors`:

```ts
const [{ rows, total }, distinctCountries, tListing, tFilter, tField] = await Promise.all([
  readApprovedContractors({ country, renewable, ev, page, pageSize }),
  // ... unchanged
]);
```

Pass `initialEv` to `ContractorFilters` + add `evOnly` to labels:

```tsx
<ContractorFilters
  locale={locale}
  initialCountry={country ?? ""}
  initialRenewable={renewable ?? ""}
  initialEv={ev === true}
  countryOptions={countryOptions}
  labels={{
    country: tFilter("country"),
    renewable: tFilter("renewable"),
    all: tFilter("all"),
    apply: tFilter("apply"),
    clear: tFilter("clear"),
    evOnly: tFilter("evOnly"),
    renewableLabels,
  }}
/>
```

And update the pagination Links to preserve `ev`:

```tsx
href={`/${locale}/contractors?${new URLSearchParams({
  ...(country ? { country } : {}),
  ...(renewable ? { renewable } : {}),
  ...(ev ? { ev: "true" } : {}),
  page: String(page - 1),
})}`}
```

(Apply to both prev and next links.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/contractor/contractor-filters.tsx \
  src/app/[locale]/contractors/page.tsx
git commit -m "feat(contractor-ev): add ?ev=true filter on /contractors listing"
```

---

## Task 10: Extend e2e tests

**Files:**
- Modify: `tests/e2e/contractor-public.spec.ts`

Pre-flight: orchestrator (controller) will rebuild + restart `poolwatt-web` BEFORE running e2e. Don't do it inside the test.

- [ ] **Step 1: Update the seed in `contractor-public.spec.ts`**

In the existing `test.beforeAll` block in `tests/e2e/contractor-public.spec.ts`, the APPROVED contractor seed creates `PublicCo Solar s.r.o.`. Add EV fields to its `data` object (between `websiteUrl` and `status`):

```ts
providesEvCharging: true,
evPowerSource: "MIXED",
evStationCount: 12,
evConnectorTypes: ["CCS2", "TYPE2"],
evPowerLevels: ["DC_FAST"],
evUsageType: "PUBLIC",
evMaxPowerKw: 150,
evDescription: "Twelve DC fast chargers along the Bratislava–Vienna corridor, powered by rooftop solar plus grid backup. 24/7 public with mobile app activation.",
```

- [ ] **Step 2: Add new test cases**

Append to `tests/e2e/contractor-public.spec.ts` (before the closing `});` of the file if it ends with one — verify the file structure first):

```ts
test("listing card shows ⚡ EV badge for contractors providing EV charging", async ({ page }) => {
  await page.goto("/en/contractors");
  // Badge contains the EV text
  const card = page.locator("text=PublicCo Solar s.r.o.").locator("xpath=ancestor::a");
  await expect(card.locator("text=EV")).toBeVisible();
});

test("?ev=true filter narrows to EV operators only", async ({ page }) => {
  await page.goto("/en/contractors?ev=true");
  await expect(page.locator("text=PublicCo Solar s.r.o.")).toBeVisible();
  // (Other approved contractors without EV would be hidden — but we only seed one APPROVED so just verify our row appears)
});

test("public detail page renders EV section when providesEvCharging is true", async ({ page }) => {
  await page.goto(`/en/contractors/${PREFIX}solarco`);
  await expect(page.locator("text=EV Charging Infrastructure")).toBeVisible();
  await expect(page.locator("text=12").first()).toBeVisible();  // station count
  await expect(page.locator("text=CCS2")).toBeVisible();
  await expect(page.locator("text=150 kW").first()).toBeVisible();
});
```

- [ ] **Step 3: Run**

```bash
set -a && source .env.local && set +a && npx playwright test contractor-public 2>&1 | tail -25
```
Expected: all previous tests + 3 new ones pass.

If a selector is too vague (e.g. "12" matches multiple), use `.first()` or a more specific locator like `text=Stations` ancestor.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/contractor-public.spec.ts
git commit -m "test(contractor-ev): extend e2e — badge, ev filter, detail section"
```

---

## Task 11: README roadmap entry

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the line**

Add this line right after the existing V2b entry:

```markdown
  - [x] **Contractor EV charging extension** — optional EV charging questionnaire on the contractor profile; ⚡ badge + `?ev=true` filter on `/contractors`. See `docs/superpowers/specs/2026-05-30-contractor-ev-charging-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(contractor-ev): add roadmap entry"
```

---

## Done criteria

- All 11 tasks committed.
- `npm run lint` clean (no NEW errors).
- `npm run test` green.
- `npx playwright test contractor-public` green.
- Manual smoke: visit `/en/me/contractor/new` as biotecbank, toggle "operates EV stations", fill the 7-field anketa, submit. After admin approves, `/en/contractors` shows ⚡ EV badge on the card; `?ev=true` filters to only EV operators; detail page shows the EV section.
- Spec coverage: spec §1–10 each have at least one task implementing them. §11 (per-station / navigator / OCPI deferrals) intentionally untouched.

## Deferred to future plans

- Per-station registration (`ContractorEvStation[]` with addresses/coords)
- `/navigator` integration (merging contractor stations with existing mocks)
- OCPI / real-time availability
- Pricing model field (per kWh / per minute / subscription)
- Localized `evDescription`
