# M3-б-1 — карта и мини-карточка (§27) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/{locale}/app/map` — карта пунктов приёма под телефон: кластеризация, все девять фильтров §27, пин по типу и доступности, геолокация, мини-карточка по тапу с маршрутом в Google Maps / Apple Maps / Waze и переходом на расчёт зарядки.

**Architecture:** Фильтры применяет сервер (`searchPoints`), а не телефон: в прямоугольник карты влезает до трёхсот пунктов. Фильтры живут в адресе страницы, как в навигаторе на монитор. Цена пункта берётся из тарифного окна, которое действует сейчас, — для этого `tariffAt` переезжает из чека в общий модуль. Кластеризация — родная для GeoJSON-источника maplibre, новых зависимостей нет.

**Tech Stack:** Next.js 16 (App Router, server components по умолчанию), maplibre-gl 5, Prisma 5, next-intl 4, vitest, Playwright (проект `mobile`, Pixel 7).

Спецификация: `docs/superpowers/specs/2026-11-26-mobile-navigator-design.md`.

**Как запускать тесты в этом репозитории** (иначе они пойдут в живую базу):

```bash
cd ~/poolwatt
NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local \
  | tr -d '"' | sed 's|/poolwatt?|/poolwatt_test?|')" npx vitest run <путь>
```

---

## Файлы

| Файл | За что отвечает |
| --- | --- |
| `src/lib/points/point-tariff.ts` (создать) | минута суток по стране пункта и выбор действующего тарифного окна — один ответ для поиска, карточки и чека |
| `src/lib/points/point-tariff.test.ts` (создать) | окна суток, переход через полночь, страна без часового пояса |
| `src/lib/receipts/receipt-document.ts` (изменить) | снять свою копию `tariffAt`, позвать общую |
| `src/lib/points/point-search.ts` (изменить) | шесть новых фильтров §27 и цена действующего окна |
| `src/lib/points/point-search.test.ts` (изменить) | по случаю на каждый новый фильтр |
| `src/lib/points/point-to-station.ts` (изменить) | донести до карты тип пункта, способы оплаты и 24/7 |
| `src/lib/chargers.ts` (изменить) | три необязательных поля в `ChargerStation` |
| `src/lib/mobile/map-filters.ts` (создать) | фильтры ⇄ адрес страницы и правило «только наши» |
| `src/lib/mobile/map-filters.test.ts` (создать) | разбор, сборка, мусор в адресе, правило «только наши» |
| `src/app/api/chargers/route.ts` (изменить) | принять фильтры, не ходить в Overpass, когда включён наш фильтр |
| `src/app/[locale]/app/map/page.tsx` (создать) | серверный экран: подписи и начальные фильтры из адреса |
| `src/components/mobile/point-map.tsx` (создать) | карта, кластеризация, геолокация, выбор пина |
| `src/components/mobile/map-filter-sheet.tsx` (создать) | лист фильтров §27 |
| `src/components/mobile/point-mini-card.tsx` (создать) | мини-карточка по тапу |
| `src/components/route-sheet.tsx` (создать) | выбор навигатора: по умолчанию, Google, Apple, Waze |
| `src/components/mobile/charge-entry.tsx` (изменить) | кнопка «на карте» рядом со списком «что рядом» |
| `src/app/[locale]/app/charge/page.tsx` (изменить) | подпись кнопки |
| `messages/en.json`, `messages/ru.json`, `messages/sk.json` (изменить) | ветка `app.map` и `route.*` |
| `tests/e2e/mobile-navigator.mobile.spec.ts` (создать) | карта на Pixel 7 против живого домена |

---

### Task 1: действующее тарифное окно

**Files:**
- Create: `src/lib/points/point-tariff.ts`
- Test: `src/lib/points/point-tariff.test.ts`
- Modify: `src/lib/receipts/receipt-document.ts:193-212`

- [x] **Step 1: Write the failing test**

`src/lib/points/point-tariff.test.ts`:

```ts
// §28 «цена по времени суток». Чек это уже умел — теперь это умеет вся
// система, и одним и тем же кодом.

import { describe, it, expect } from "vitest";
import { localMinuteOfDay, tariffAt, zoneKnown } from "./point-tariff";

const DAY = { fromMinute: 360, toMinute: 1320, priceFiat: 0.4 };
const NIGHT = { fromMinute: 1320, toMinute: 360, priceFiat: 0.15 };
const FLAT = { fromMinute: 0, toMinute: 1440, priceFiat: 0.3 };

describe("localMinuteOfDay", () => {
  it("counts minutes in the point's own country", () => {
    // 2026-01-15T07:30:00Z — в Братиславе это 08:30, то есть 510 минут.
    const at = new Date("2026-01-15T07:30:00.000Z");
    expect(localMinuteOfDay(at, "SK")).toBe(510);
  });

  it("follows summer time", () => {
    // 2026-07-15T07:30:00Z — в Братиславе 09:30, то есть 570 минут.
    const at = new Date("2026-07-15T07:30:00.000Z");
    expect(localMinuteOfDay(at, "SK")).toBe(570);
  });

  it("falls back to UTC for a country we do not know", () => {
    const at = new Date("2026-01-15T07:30:00.000Z");
    expect(localMinuteOfDay(at, "ZZ")).toBe(450);
    expect(localMinuteOfDay(at, null)).toBe(450);
  });

  it("says whether the country's zone is known", () => {
    expect(zoneKnown("SK")).toBe(true);
    expect(zoneKnown("UA")).toBe(true);
    expect(zoneKnown("ZZ")).toBe(false);
    expect(zoneKnown(null)).toBe(false);
  });
});

describe("tariffAt", () => {
  it("picks the window that contains the minute", () => {
    expect(tariffAt([DAY, NIGHT], 600)?.priceFiat).toBe(0.4);
  });

  it("handles a window that wraps past midnight", () => {
    expect(tariffAt([DAY, NIGHT], 1400)?.priceFiat).toBe(0.15);
    expect(tariffAt([DAY, NIGHT], 120)?.priceFiat).toBe(0.15);
  });

  it("takes a flat day as it is", () => {
    expect(tariffAt([FLAT], 0)?.priceFiat).toBe(0.3);
    expect(tariffAt([FLAT], 1439)?.priceFiat).toBe(0.3);
  });

  it("falls back to the first window when nothing covers the minute", () => {
    expect(tariffAt([{ fromMinute: 600, toMinute: 700, priceFiat: 1 }], 0)?.priceFiat).toBe(1);
  });

  it("has nothing to say about a point without tariffs", () => {
    expect(tariffAt([], 600)).toBeNull();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local | tr -d '"' | sed 's|/poolwatt?|/poolwatt_test?|')" npx vitest run src/lib/points/point-tariff.test.ts`
Expected: FAIL — `Failed to resolve import "./point-tariff"`.

- [x] **Step 3: Write the implementation**

`src/lib/points/point-tariff.ts`:

```ts
// §28 «Тарифы»: цена по времени суток. Один ответ на вопрос «какая цена у
// пункта сейчас» — для поиска, карточки, мини-карточки и чека. Раньше эта
// логика жила внутри чека, а поиск брал просто первое окно суток, то есть
// в восемь вечера показывал утреннюю цену.
//
// Минуты считаются по времени страны пункта: тариф «ночь с 22:00» — это
// 22:00 там, где стоит станция, а не в UTC. Страны без записи в таблице
// считаются по UTC, и `zoneKnown` даёт карточке это пометить.

const ZONES: Record<string, string> = {
  AT: "Europe/Vienna",
  BE: "Europe/Brussels",
  BG: "Europe/Sofia",
  CH: "Europe/Zurich",
  CZ: "Europe/Prague",
  DE: "Europe/Berlin",
  DK: "Europe/Copenhagen",
  EE: "Europe/Tallinn",
  ES: "Europe/Madrid",
  FI: "Europe/Helsinki",
  FR: "Europe/Paris",
  GR: "Europe/Athens",
  HR: "Europe/Zagreb",
  HU: "Europe/Budapest",
  IE: "Europe/Dublin",
  IT: "Europe/Rome",
  LT: "Europe/Vilnius",
  LV: "Europe/Riga",
  NL: "Europe/Amsterdam",
  NO: "Europe/Oslo",
  PL: "Europe/Warsaw",
  PT: "Europe/Lisbon",
  RO: "Europe/Bucharest",
  SE: "Europe/Stockholm",
  SI: "Europe/Ljubljana",
  SK: "Europe/Bratislava",
  UA: "Europe/Kyiv",
};

export function zoneKnown(country: string | null | undefined): boolean {
  return !!country && country.toUpperCase() in ZONES;
}

/** Минут от местной полуночи, 0…1439. */
export function localMinuteOfDay(at: Date, country: string | null | undefined): number {
  const zone = country ? ZONES[country.toUpperCase()] : undefined;
  if (!zone) return at.getUTCHours() * 60 + at.getUTCMinutes();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  // "24:00" — как Intl в режиме hour12:false иногда называет полночь.
  return (hour % 24) * 60 + minute;
}

export interface TariffWindow {
  fromMinute: number;
  toMinute: number;
}

/**
 * Окно, которое действует в эту минуту. Окно с `toMinute <= fromMinute`
 * переходит через полночь («с 22:00 до 06:00»). Если ни одно окно минуту не
 * покрывает — первое, как и делал чек: лучше честная цена из прайса, чем
 * никакая.
 */
export function tariffAt<T extends TariffWindow>(
  tariffs: T[],
  minuteOfDay: number,
): T | null {
  if (tariffs.length === 0) return null;
  const covers = (t: T) =>
    t.toMinute > t.fromMinute
      ? minuteOfDay >= t.fromMinute && minuteOfDay < t.toMinute
      : minuteOfDay >= t.fromMinute || minuteOfDay < t.toMinute;
  return tariffs.find(covers) ?? tariffs[0];
}
```

- [x] **Step 4: Run test to verify it passes**

Run: the same vitest command.
Expected: PASS, 9 cases.

- [x] **Step 5: Make the receipt use it**

В `src/lib/receipts/receipt-document.ts` удалить локальную функцию `tariffAt`
(строки 202–212) и её тип-параметр, добавить к импортам
`import { tariffAt } from "@/lib/points/point-tariff";`. Вызов в файле не
меняется, если локальная подпись была `(tariffs, minute)`; если она была
`(tariffs, at)`, посчитать минуту через `localMinuteOfDay(at, point.country)`
и передать её.

- [x] **Step 6: Run the receipt tests**

Run: `NODE_ENV=test DATABASE_URL="…poolwatt_test…" npx vitest run src/lib/receipts`
Expected: PASS, как до правки.

- [x] **Step 7: Commit**

```bash
git add src/lib/points/point-tariff.ts src/lib/points/point-tariff.test.ts src/lib/receipts/receipt-document.ts
git commit -m "feat(points): one answer to what a point costs right now"
```

---

### Task 2: шесть новых фильтров §27 в поиске пунктов

**Files:**
- Modify: `src/lib/points/point-search.ts`
- Test: `src/lib/points/point-search.test.ts`

- [x] **Step 1: Write the failing tests**

Дописать в `src/lib/points/point-search.test.ts` внутри существующего
`describe`-блока (сев в `beforeAll` расширить: см. шаг 2):

```ts
  it("filters by point type", async () => {
    const found = await searchPoints({ bbox: BBOX, type: "POWERBANK" });
    expect(found.map((p) => p.name)).toEqual(["Powerbank"]);
  });

  it("filters by money price of the window in force", async () => {
    const found = await searchPoints({ bbox: BBOX, maxPriceFiat: 0.2 });
    expect(found.map((p) => p.name)).toContain("Cheap night");
    expect(found.map((p) => p.name)).not.toContain("Free CCS");
  });

  it("filters by token price", async () => {
    const found = await searchPoints({ bbox: BBOX, maxPriceTokens: 1.05 });
    expect(found.map((p) => p.name)).toEqual(["Tokens 1.0"]);
  });

  it("filters by round-the-clock opening", async () => {
    const found = await searchPoints({ bbox: BBOX, open24: true });
    expect(found.map((p) => p.name)).not.toContain("Nine to five");
  });

  it("filters by an accepted payment method", async () => {
    const found = await searchPoints({ bbox: BBOX, paymentMethod: "WHITE_LABEL_CARD" });
    expect(found.map((p) => p.name)).toEqual(["White label"]);
  });

  it("calls solar, wind, biogas and hydro green — grid and mixed not", async () => {
    const found = await searchPoints({ bbox: BBOX, greenOnly: true });
    expect(found.map((p) => p.name)).not.toContain("From the grid");
    expect(found.map((p) => p.name)).not.toContain("Mixed source");
    expect(found.map((p) => p.name)).toContain("Free CCS");
  });

  it("gives the price of the window in force, not the first of the day", async () => {
    // «Cheap night» стоит 0.15 с 22:00 и 0.40 днём; окно выбирается по
    // местному времени Братиславы, поэтому проверяем через подстановку минуты.
    const found = await searchPoints({ bbox: BBOX, nowMinuteOfDay: 1400 });
    const night = found.find((p) => p.name === "Cheap night");
    expect(night?.priceFiat).toBeCloseTo(0.15, 3);
    const byDay = await searchPoints({ bbox: BBOX, nowMinuteOfDay: 600 });
    expect(byDay.find((p) => p.name === "Cheap night")?.priceFiat).toBeCloseTo(0.4, 3);
  });
```

- [x] **Step 2: Extend the test seed**

В `beforeAll` того же файла добавить пункты, которых требуют новые случаи.
Функцию `seed` расширить необязательными полями:

```ts
async function seed(args: {
  name: string;
  status?: "DRAFT" | "REVIEW" | "TEST" | "PUBLISHED" | "SUSPENDED";
  lat?: number;
  lng?: number;
  visibility?: "PUBLIC" | "COOP_MEMBERS" | "OWN_CLIENTS";
  type?: "CHARGING_STATION" | "POWERBANK" | "GENERATION" | "MIXED";
  energySource?: "SOLAR" | "WIND" | "BIOGAS" | "HYDRO" | "GRID" | "MIXED";
  open24?: boolean;
  paymentMethods?: string[];
  tariffs?: {
    fromMinute: number;
    toMinute: number;
    priceFiat?: number;
    priceTokens?: number;
    currency?: string;
  }[];
  connectors: { type: string; powerKw: number; status: string; currentAc?: boolean }[];
}) {
  return prisma.acceptancePoint.create({
    data: {
      operatorId,
      type: (args.type ?? "CHARGING_STATION") as never,
      name: args.name,
      status: (args.status ?? "PUBLISHED") as never,
      country: "SK",
      city: "Bratislava",
      addressLine: "Hlavná 1",
      latitude: args.lat ?? 48.15,
      longitude: args.lng ?? 17.11,
      howToFind: "level -1",
      energySource: (args.energySource ?? "SOLAR") as never,
      open24: args.open24 ?? true,
      paymentMethods: args.paymentMethods ?? ["TOKEN"],
      visibility: (args.visibility ?? "PUBLIC") as never,
      publishedAt: new Date(),
      connectors: {
        create: args.connectors.map((c) => ({
          type: c.type as never,
          powerKw: c.powerKw,
          currentAc: c.currentAc ?? true,
          quantity: 1,
          status: c.status as never,
        })),
      },
      tariffs: {
        create: (
          args.tariffs ?? [{ fromMinute: 0, toMinute: 1440, priceFiat: 0.35 }]
        ).map((t) => ({
          fromMinute: t.fromMinute,
          toMinute: t.toMinute,
          priceFiat: t.priceFiat ?? null,
          priceTokens: t.priceTokens ?? null,
          currency: t.currency ?? "EUR",
        })),
      },
    },
  });
}
```

и новые пункты в конце `beforeAll`:

```ts
  await seed({
    name: "Powerbank",
    lat: 48.18,
    type: "POWERBANK",
    connectors: [{ type: "SCHUKO", powerKw: 3.7, status: "FREE" }],
  });
  await seed({
    name: "Cheap night",
    lat: 48.19,
    tariffs: [
      { fromMinute: 360, toMinute: 1320, priceFiat: 0.4 },
      { fromMinute: 1320, toMinute: 360, priceFiat: 0.15 },
    ],
    connectors: [{ type: "CCS2", powerKw: 50, status: "FREE", currentAc: false }],
  });
  await seed({
    name: "Tokens 1.0",
    lat: 48.2,
    tariffs: [{ fromMinute: 0, toMinute: 1440, priceTokens: 1.0 }],
    connectors: [{ type: "TYPE2", powerKw: 22, status: "FREE" }],
  });
  await seed({
    name: "Nine to five",
    lat: 48.21,
    open24: false,
    connectors: [{ type: "TYPE2", powerKw: 22, status: "FREE" }],
  });
  await seed({
    name: "White label",
    lat: 48.22,
    paymentMethods: ["TOKEN", "WHITE_LABEL_CARD"],
    connectors: [{ type: "TYPE2", powerKw: 22, status: "FREE" }],
  });
  await seed({
    name: "From the grid",
    lat: 48.23,
    energySource: "GRID",
    connectors: [{ type: "TYPE2", powerKw: 22, status: "FREE" }],
  });
  await seed({
    name: "Mixed source",
    lat: 48.24,
    energySource: "MIXED",
    connectors: [{ type: "TYPE2", powerKw: 22, status: "FREE" }],
  });
```

Прежние случаи файла считают пункты в выдаче — если какой-то из них
сравнивает длину массива, заменить сравнение на проверку наличия нужных
имён, потому что сев вырос.

- [x] **Step 3: Run tests to verify they fail**

Run: `NODE_ENV=test DATABASE_URL="…poolwatt_test…" npx vitest run src/lib/points/point-search.test.ts`
Expected: FAIL — новые поля `SearchArgs` не существуют (ошибка типа), фильтры не применяются.

- [x] **Step 4: Implement the filters**

В `src/lib/points/point-search.ts`:

1. Расширить `SearchArgs`:

```ts
export interface SearchArgs {
  bbox: SearchBox;
  connector?: string | null;
  minPowerKw?: number | null;
  freeOnly?: boolean;
  /** §27 «тип пункта». */
  type?: string | null;
  /** §27 «цена за кВт·ч в деньгах» — верхняя граница. */
  maxPriceFiat?: number | null;
  /** §27 «цена за кВт·ч в токенах» — верхняя граница. */
  maxPriceTokens?: number | null;
  /** §27 «работает 24/7». */
  open24?: boolean;
  /** §27 «принимает white label карты» и прочие способы оплаты §28. */
  paymentMethod?: string | null;
  /** §27 «зелёный источник»: солнце, ветер, биогаз, гидро. */
  greenOnly?: boolean;
  /** Sorts by distance and fills `distanceM`. */
  near?: { lat: number; lng: number } | null;
  limit?: number;
  /** Подстановка минуты суток для тестов; обычно берётся из страны пункта. */
  nowMinuteOfDay?: number | null;
}
```

2. Расширить `FoundPoint` тремя полями, которые нужны карте и мини-карточке:

```ts
  paymentMethods: string[];
  /** true, когда окно тарифа выбрано по известному часовому поясу страны. */
  priceZoneKnown: boolean;
  idleFeePerMin: number | null;
```

3. Добавить вверху файла:

```ts
import { localMinuteOfDay, tariffAt, zoneKnown } from "./point-tariff";
import { PointEnergySource } from "@prisma/client";

const GREEN = [
  PointEnergySource.SOLAR,
  PointEnergySource.WIND,
  PointEnergySource.BIOGAS,
  PointEnergySource.HYDRO,
];
```

4. В `where` запроса добавить то, что умеет база:

```ts
      ...(args.type ? { type: args.type as never } : {}),
      ...(args.open24 ? { open24: true } : {}),
      ...(args.paymentMethod ? { paymentMethods: { has: args.paymentMethod } } : {}),
      ...(args.greenOnly ? { energySource: { in: GREEN } } : {}),
```

5. Забирать **все** тарифные окна, а не первое:

```ts
      tariffs: { orderBy: { fromMinute: "asc" } },
```

6. В `map` считать цену по действующему окну:

```ts
      const minute =
        args.nowMinuteOfDay ?? localMinuteOfDay(new Date(), p.country);
      const tariff = tariffAt(p.tariffs, minute);
```

и в возвращаемом объекте:

```ts
        priceFiat: numOrNull(tariff?.priceFiat ?? null),
        priceTokens: numOrNull(tariff?.priceTokens ?? null),
        currency: tariff?.currency ?? "EUR",
        idleFeePerMin: numOrNull(tariff?.idleFeePerMin ?? null),
        paymentMethods: p.paymentMethods,
        priceZoneKnown:
          args.nowMinuteOfDay != null ? true : zoneKnown(p.country),
```

7. Цену нельзя отфильтровать в SQL — окно выбирается в коде, — поэтому
   фильтры по цене идут после `map`, перед сортировкой. Пункт без цены не
   проходит фильтр по цене: «дешевле 20 центов» — это обещание, а цены мы не
   знаем.

```ts
  let result = found;
  if (args.maxPriceFiat != null) {
    const ceiling = args.maxPriceFiat;
    result = result.filter((p) => p.priceFiat != null && p.priceFiat <= ceiling);
  }
  if (args.maxPriceTokens != null) {
    const ceiling = args.maxPriceTokens;
    result = result.filter((p) => p.priceTokens != null && p.priceTokens <= ceiling);
  }

  if (args.near) result.sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0));
  return result;
```

(переменную `found` оставить как есть, вернуть `result`).

- [x] **Step 5: Run tests to verify they pass**

Run: the same vitest command.
Expected: PASS — все прежние случаи плюс семь новых.

- [x] **Step 6: Commit**

```bash
git add src/lib/points/point-search.ts src/lib/points/point-search.test.ts
git commit -m "feat(points): the nine filters of §27 are applied by the server"
```

---

### Task 3: карта знает тип пункта, оплату и 24/7

**Files:**
- Modify: `src/lib/chargers.ts`
- Modify: `src/lib/points/point-to-station.ts`
- Test: `src/lib/points/point-to-station.test.ts` (создать)

- [x] **Step 1: Write the failing test**

`src/lib/points/point-to-station.test.ts`:

```ts
// Пин на карте показывает §27 «тип и доступность», а мини-карточка — цену в
// токенах и способы оплаты. Всё это есть у нашего пункта и нет у чужого
// пина, поэтому оно должно доехать до карты.

import { describe, it, expect } from "vitest";
import { pointToStation } from "./point-to-station";
import type { FoundPoint } from "./point-search";

const BASE: FoundPoint = {
  id: "p1",
  name: "Powerbank u Jozefa",
  operatorName: "Net",
  type: "POWERBANK",
  city: "Bratislava",
  country: "SK",
  addressLine: "Hlavná 1",
  latitude: 48.15,
  longitude: 17.11,
  energySource: "SOLAR",
  open24: true,
  priceFiat: 0.21,
  priceTokens: 1.05,
  currency: "EUR",
  idleFeePerMin: null,
  paymentMethods: ["TOKEN", "WHITE_LABEL_CARD"],
  priceZoneKnown: true,
  connectors: [{ type: "SCHUKO", powerKw: 3.7, quantity: 2, status: "FREE" }],
  distanceM: 400,
};

describe("pointToStation", () => {
  it("carries the point type, the payment methods and 24/7", () => {
    const s = pointToStation(BASE);
    expect(s.pointType).toBe("POWERBANK");
    expect(s.paymentMethods).toEqual(["TOKEN", "WHITE_LABEL_CARD"]);
    expect(s.open24).toBe(true);
    expect(s.distanceM).toBe(400);
  });

  it("keeps the price in tokens next to the price in money", () => {
    const s = pointToStation(BASE);
    expect(s.priceTokens).toBe(1.05);
    expect(s.costInfo).toBe("0.21 EUR/kWh");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test DATABASE_URL="…poolwatt_test…" npx vitest run src/lib/points/point-to-station.test.ts`
Expected: FAIL — `pointType`, `paymentMethods`, `open24`, `distanceM` не существуют в типе.

- [x] **Step 3: Implement**

В `src/lib/chargers.ts`, в конец типа `ChargerStation`:

```ts
  /** §27 — значок пина показывает тип пункта. Только у нашего пункта. */
  pointType?: string;
  /** §28 «Способы оплаты» — фильтр §27 «принимает white label карты». */
  paymentMethods?: string[];
  /** §27 «работает 24/7». */
  open24?: boolean;
  /** Метры до водителя, когда он дал геолокацию. */
  distanceM?: number | null;
```

В `src/lib/points/point-to-station.ts`, в возвращаемый объект:

```ts
    pointType: point.type,
    paymentMethods: point.paymentMethods,
    open24: point.open24,
    distanceM: point.distanceM,
```

- [x] **Step 4: Run test to verify it passes**

Expected: PASS, 2 cases.

- [x] **Step 5: Commit**

```bash
git add src/lib/chargers.ts src/lib/points/point-to-station.ts src/lib/points/point-to-station.test.ts
git commit -m "feat(navigator): a pin knows the type of the point it stands for"
```

---

### Task 4: фильтры в адресе страницы

**Files:**
- Create: `src/lib/mobile/map-filters.ts`
- Test: `src/lib/mobile/map-filters.test.ts`

- [x] **Step 1: Write the failing test**

`src/lib/mobile/map-filters.test.ts`:

```ts
// Найденный вид — это ссылка: фильтры живут в адресе, как в навигаторе на
// монитор. Мусор в адресе не ломает экран, он просто ничего не фильтрует.

import { describe, it, expect } from "vitest";
import {
  EMPTY_FILTERS,
  oursOnly,
  parseMapFilters,
  toQuery,
  type MapFilters,
} from "./map-filters";

function parse(search: string): MapFilters {
  return parseMapFilters(new URLSearchParams(search));
}

describe("parseMapFilters", () => {
  it("reads every filter of §27", () => {
    const f = parse(
      "type=POWERBANK&connector=CCS2&power=dc_fast&free=1&maxFiat=0.25&maxTokens=1.1&open24=1&pay=WHITE_LABEL_CARD&green=1",
    );
    expect(f).toEqual({
      type: "POWERBANK",
      connector: "CCS2",
      power: "dc_fast",
      freeOnly: true,
      maxPriceFiat: 0.25,
      maxPriceTokens: 1.1,
      open24: true,
      paymentMethod: "WHITE_LABEL_CARD",
      greenOnly: true,
    });
  });

  it("ignores values outside the vocabulary", () => {
    expect(parse("type=MOON&connector=Banana&power=warp&pay=cash")).toEqual(EMPTY_FILTERS);
  });

  it("ignores a price that is not a positive number", () => {
    expect(parse("maxFiat=abc&maxTokens=-3").maxPriceFiat).toBeNull();
    expect(parse("maxFiat=abc&maxTokens=-3").maxPriceTokens).toBeNull();
  });

  it("treats anything but 1 as off for the switches", () => {
    expect(parse("free=yes&open24=true&green=0").freeOnly).toBe(false);
    expect(parse("free=yes&open24=true&green=0").open24).toBe(false);
    expect(parse("free=yes&open24=true&green=0").greenOnly).toBe(false);
  });

  it("gives an empty address empty filters", () => {
    expect(parse("")).toEqual(EMPTY_FILTERS);
  });
});

describe("toQuery", () => {
  it("writes back exactly what was set, and nothing else", () => {
    const q = toQuery({ ...EMPTY_FILTERS, type: "POWERBANK", freeOnly: true });
    expect(q).toBe("type=POWERBANK&free=1");
  });

  it("survives a round trip", () => {
    const f = parse("connector=CCS2&maxFiat=0.25&green=1");
    expect(parseMapFilters(new URLSearchParams(toQuery(f)))).toEqual(f);
  });

  it("writes nothing for empty filters", () => {
    expect(toQuery(EMPTY_FILTERS)).toBe("");
  });
});

describe("oursOnly", () => {
  it("is false while nothing is filtered", () => {
    expect(oursOnly(EMPTY_FILTERS)).toBe(false);
  });

  it("is true for a filter an OpenStreetMap pin cannot answer", () => {
    expect(oursOnly({ ...EMPTY_FILTERS, freeOnly: true })).toBe(true);
    expect(oursOnly({ ...EMPTY_FILTERS, maxPriceTokens: 1 })).toBe(true);
    expect(oursOnly({ ...EMPTY_FILTERS, paymentMethod: "WHITE_LABEL_CARD" })).toBe(true);
    expect(oursOnly({ ...EMPTY_FILTERS, greenOnly: true })).toBe(true);
    expect(oursOnly({ ...EMPTY_FILTERS, type: "POWERBANK" })).toBe(true);
    expect(oursOnly({ ...EMPTY_FILTERS, open24: true })).toBe(true);
    expect(oursOnly({ ...EMPTY_FILTERS, maxPriceFiat: 0.3 })).toBe(true);
  });

  it("is false for the two filters a foreign pin can answer", () => {
    expect(oursOnly({ ...EMPTY_FILTERS, connector: "CCS2" })).toBe(false);
    expect(oursOnly({ ...EMPTY_FILTERS, power: "dc_fast" })).toBe(false);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Expected: FAIL — `Failed to resolve import "./map-filters"`.

- [x] **Step 3: Implement**

`src/lib/mobile/map-filters.ts`:

```ts
// Девять фильтров §27 живут в адресе страницы — ровно по той же причине, по
// которой они живут в адресе навигатора на монитор: найденный вид должен
// быть ссылкой, которую можно сохранить и отправить.
//
// Семь из девяти опираются на поля, которые есть только у нашего пункта:
// тип, цена, 24/7, способ оплаты, зелёный источник, «свободен сейчас».
// Включён хоть один такой — карта показывает только пункты Poolwatt и
// честно об этом пишет. Фильтровать чужие пины по данным, которых у них нет,
// значит врать о них.

export const POINT_TYPES = [
  "CHARGING_STATION",
  "POWERBANK",
  "GENERATION",
  "MIXED",
] as const;

export const CONNECTORS = [
  "CCS2",
  "CHAdeMO",
  "Type2",
  "Type1",
  "Tesla",
  "GB/T",
  "Schuko",
] as const;

export const POWER_LEVELS = ["ac_slow", "ac_fast", "dc_fast", "dc_ultra"] as const;

export const PAYMENT_METHODS = [
  "TOKEN",
  "POOLWATT_CARD",
  "WHITE_LABEL_CARD",
  "BANK_CARD",
  "QR",
] as const;

export interface MapFilters {
  type: string | null;
  connector: string | null;
  power: string | null;
  freeOnly: boolean;
  maxPriceFiat: number | null;
  maxPriceTokens: number | null;
  open24: boolean;
  paymentMethod: string | null;
  greenOnly: boolean;
}

export const EMPTY_FILTERS: MapFilters = {
  type: null,
  connector: null,
  power: null,
  freeOnly: false,
  maxPriceFiat: null,
  maxPriceTokens: null,
  open24: false,
  paymentMethod: null,
  greenOnly: false,
};

function oneOf(value: string | null, allowed: readonly string[]): string | null {
  return value && allowed.includes(value) ? value : null;
}

function positive(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Только "1" значит «включено»: всё остальное — чужой адрес или опечатка. */
function on(value: string | null): boolean {
  return value === "1";
}

export function parseMapFilters(sp: URLSearchParams): MapFilters {
  return {
    type: oneOf(sp.get("type"), POINT_TYPES),
    connector: oneOf(sp.get("connector"), CONNECTORS),
    power: oneOf(sp.get("power"), POWER_LEVELS),
    freeOnly: on(sp.get("free")),
    maxPriceFiat: positive(sp.get("maxFiat")),
    maxPriceTokens: positive(sp.get("maxTokens")),
    open24: on(sp.get("open24")),
    paymentMethod: oneOf(sp.get("pay"), PAYMENT_METHODS),
    greenOnly: on(sp.get("green")),
  };
}

export function toQuery(f: MapFilters): string {
  const sp = new URLSearchParams();
  if (f.type) sp.set("type", f.type);
  if (f.connector) sp.set("connector", f.connector);
  if (f.power) sp.set("power", f.power);
  if (f.freeOnly) sp.set("free", "1");
  if (f.maxPriceFiat != null) sp.set("maxFiat", String(f.maxPriceFiat));
  if (f.maxPriceTokens != null) sp.set("maxTokens", String(f.maxPriceTokens));
  if (f.open24) sp.set("open24", "1");
  if (f.paymentMethod) sp.set("pay", f.paymentMethod);
  if (f.greenOnly) sp.set("green", "1");
  return sp.toString();
}

/** Сколько фильтров включено — для бейджа на кнопке «Фильтры». */
export function activeCount(f: MapFilters): number {
  return Object.entries(f).filter(([, v]) => v !== null && v !== false).length;
}

export function oursOnly(f: MapFilters): boolean {
  return (
    f.type !== null ||
    f.freeOnly ||
    f.maxPriceFiat !== null ||
    f.maxPriceTokens !== null ||
    f.open24 ||
    f.paymentMethod !== null ||
    f.greenOnly
  );
}
```

- [x] **Step 4: Run test to verify it passes**

Expected: PASS, 11 cases.

- [x] **Step 5: Commit**

```bash
git add src/lib/mobile/map-filters.ts src/lib/mobile/map-filters.test.ts
git commit -m "feat(mobile): the nine filters of §27 live in the address"
```

---

### Task 5: `/api/chargers` принимает фильтры

**Files:**
- Modify: `src/app/api/chargers/route.ts`

- [x] **Step 1: Pass the filters through**

В `src/app/api/chargers/route.ts`:

1. Импорт: `import { oursOnly, parseMapFilters } from "@/lib/mobile/map-filters";`
2. После разбора прямоугольника:

```ts
  const filters = parseMapFilters(req.nextUrl.searchParams);
  const onlyOurs = oursOnly(filters);
  const minPowerKw = MIN_POWER_KW[filters.power ?? ""] ?? null;
```

и рядом с константами файла:

```ts
// §27 «мощность» — четыре ступени навигатора, в киловаттах снизу.
const MIN_POWER_KW: Record<string, number> = {
  ac_slow: 0,
  ac_fast: 11,
  dc_fast: 50,
  dc_ultra: 150,
};

// Поля enum у нас, а в навигаторе разъёмы названы по-человечески.
const CONNECTOR_ENUM: Record<string, string> = {
  CCS2: "CCS2",
  CHAdeMO: "CHAdeMO",
  Type2: "TYPE2",
  Type1: "TYPE1",
  Tesla: "TESLA",
  "GB/T": "GB_T",
  Schuko: "SCHUKO",
};
```

3. В `Promise.all` отдать фильтры поиску и не ходить в Overpass, когда
   включён наш фильтр: чужие пины такой фильтр заведомо не проходят, и
   запрос к чужой площадке — это только лишние секунды на мобильной сети.

```ts
  const [result, priceIndex, ours] = await Promise.all([
    onlyOurs
      ? Promise.resolve({ stations: [], source: "live" as const, mirror: undefined, error: undefined })
      : fetchChargersInBBox(parsed, {
          mockFallback: () => filterMockByBBox(MOCK_CHARGERS, parsed),
        }),
    fetchOperatorPriceIndex().catch(() => new Map()),
    searchPoints({
      bbox: parsed,
      connector: filters.connector ? CONNECTOR_ENUM[filters.connector] : null,
      minPowerKw,
      freeOnly: filters.freeOnly,
      type: filters.type,
      maxPriceFiat: filters.maxPriceFiat,
      maxPriceTokens: filters.maxPriceTokens,
      open24: filters.open24,
      paymentMethod: filters.paymentMethod,
      greenOnly: filters.greenOnly,
      near: near,
    }).catch((err) => {
      console.error("[chargers] point search failed", err);
      return [];
    }),
  ]);
```

4. Геолокация водителя, если он её дал, — чтобы расстояния считал сервер, а
   не телефон. Рядом с разбором прямоугольника:

```ts
  const atLat = parseFloat(req.nextUrl.searchParams.get("atLat") ?? "");
  const atLng = parseFloat(req.nextUrl.searchParams.get("atLng") ?? "");
  const near =
    Number.isFinite(atLat) && Number.isFinite(atLng) ? { lat: atLat, lng: atLng } : null;
```

(объявить `near` до `Promise.all`).

5. Заголовок, по которому экран понимает, что чужих пинов в выдаче нет:

```ts
  if (onlyOurs) headers["X-Ours-Only"] = "1";
```

- [x] **Step 2: Check the navigator on a monitor still works**

Старый навигатор зовёт `/api/chargers` без фильтров: `oursOnly` ложно,
поведение прежнее. Проверить на живой сборке после сборки (Task 9).

- [x] **Step 3: Commit**

```bash
git add src/app/api/chargers/route.ts
git commit -m "feat(navigator): the chargers endpoint applies the §27 filters"
```

---

### Task 6: выбор навигатора для маршрута

**Files:**
- Create: `src/components/route-sheet.tsx`
- Modify: `messages/en.json`, `messages/ru.json`, `messages/sk.json`

- [x] **Step 1: Write the component**

`src/components/route-sheet.tsx`:

```tsx
"use client";

// §27 «Маршрут через Google Maps, Apple Maps или Waze». Одна кнопка «отдать
// точку системе» остаётся первой: на Android чаще всего хотят именно её, и
// она же работает там, где ни одного из трёх приложений нет. Схему выбираем
// в момент нажатия, а не при отрисовке: на сервере угадать нечем.

import { useState } from "react";

type Props = {
  lat: number;
  lng: number;
  name?: string;
  labels: {
    route: string;
    openIn: string;
    system: string;
    google: string;
    apple: string;
    waze: string;
    cancel: string;
  };
  className?: string;
};

function systemUrl(lat: number, lng: number, name?: string): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const isiOS = /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
  if (isiOS) {
    return `maps://?daddr=${lat},${lng}${name ? `&q=${encodeURIComponent(name)}` : ""}`;
  }
  if (/Android/.test(ua)) {
    return `geo:0,0?q=${lat},${lng}${name ? `(${encodeURIComponent(name)})` : ""}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

export function RouteSheet({ lat, lng, name, labels, className }: Props) {
  const [open, setOpen] = useState(false);

  function go(url: string) {
    setOpen(false);
    window.location.href = url;
  }

  const options: { key: string; label: string; url: string }[] = [
    { key: "system", label: labels.system, url: systemUrl(lat, lng, name) },
    {
      key: "google",
      label: labels.google,
      url: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
    },
    {
      key: "apple",
      label: labels.apple,
      url: `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`,
    },
    { key: "waze", label: labels.waze, url: `https://waze.com/ul?ll=${lat},${lng}&navigate=yes` },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="route-button"
        className={
          className ??
          "inline-flex items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 text-[13px] font-semibold uppercase tracking-[0.18em] text-accent-foreground"
        }
      >
        {labels.route}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/60"
          onClick={() => setOpen(false)}
          data-testid="route-sheet"
        >
          <div
            className="w-full rounded-t-2xl border-t border-hairline bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 text-[12px] uppercase tracking-[0.16em] text-muted">
              {labels.openIn}
            </div>
            <ul className="divide-y divide-hairline">
              {options.map((o) => (
                <li key={o.key}>
                  <button
                    type="button"
                    onClick={() => go(o.url)}
                    data-testid={`route-${o.key}`}
                    className="w-full py-3 text-left text-[15px]"
                  >
                    {o.label}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-3 w-full rounded-lg border border-hairline py-3 text-[14px]"
            >
              {labels.cancel}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
```

- [x] **Step 2: Add the labels**

В `messages/en.json`, `messages/ru.json`, `messages/sk.json` добавить ветку
верхнего уровня `route`:

en: `{"route":{"route":"Route","openIn":"Open in","system":"Default navigator","google":"Google Maps","apple":"Apple Maps","waze":"Waze","cancel":"Cancel"}}`

ru: `{"route":{"route":"Маршрут","openIn":"Открыть в","system":"Навигатор по умолчанию","google":"Google Maps","apple":"Apple Maps","waze":"Waze","cancel":"Отмена"}}`

sk: `{"route":{"route":"Trasa","openIn":"Otvoriť v","system":"Predvolená navigácia","google":"Google Maps","apple":"Apple Maps","waze":"Waze","cancel":"Zrušiť"}}`

- [x] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in the new file.

- [x] **Step 4: Commit**

```bash
git add src/components/route-sheet.tsx messages/en.json messages/ru.json messages/sk.json
git commit -m "feat(navigator): a driver picks the navigator the route opens in"
```

---

### Task 7: экран карты

**Files:**
- Create: `src/app/[locale]/app/map/page.tsx`
- Create: `src/components/mobile/point-map.tsx`
- Create: `src/components/mobile/map-filter-sheet.tsx`
- Create: `src/components/mobile/point-mini-card.tsx`
- Modify: `messages/en.json`, `messages/ru.json`, `messages/sk.json`

- [x] **Step 1: The server screen**

`src/app/[locale]/app/map/page.tsx` — серверный компонент: `setRequestLocale`,
`getTranslations("app.map")`, разбор начальных фильтров из `searchParams`
через `parseMapFilters(new URLSearchParams(…))`, и отрисовка
`<PointMap locale={locale} initialFilters={…} labels={…} />` внутри
`<Screen title={t("title")} back={`/${locale}/app/charge`} />`.

Карта должна занимать весь экран, а `Screen` даёт колонку с отступами,
поэтому страница рисует свою обёртку: заголовок строкой сверху, под ним
`<PointMap>` высотой `calc(100dvh - 10rem)`.

Подписи, которые нужны (ветка `app.map`): `title`, `filters`, `apply`,
`reset`, `oursOnly`, `type`, `connector`, `power`, `free`, `maxFiat`,
`maxTokens`, `open24`, `pay`, `green`, `greenHint`, `any`, `locate`,
`locateDenied`, `empty`, `loading`, `charge`, `details`, `book`,
`freeOf`, `priceTokens`, `priceUtc`, `type.CHARGING_STATION`,
`type.POWERBANK`, `type.GENERATION`, `type.MIXED`,
`availability.FREE`, `availability.BUSY`, `availability.OUT_OF_SERVICE`,
`availability.BOOKED`, `availability.UNKNOWN`,
`pay.TOKEN`, `pay.POOLWATT_CARD`, `pay.WHITE_LABEL_CARD`, `pay.BANK_CARD`,
`pay.QR`, `power.ac_slow`, `power.ac_fast`, `power.dc_fast`, `power.dc_ultra`.

- [x] **Step 2: The map**

`src/components/mobile/point-map.tsx` — клиентский компонент. Что он делает:

- Поднимает `maplibregl.Map` на стиль
  `https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json`
  (тот же, что навигатор на монитор), `attributionControl` включён.
- Начальный вид: если геолокация пришла — вокруг водителя, зум 12; иначе
  Братислава `[17.1077, 48.1486]`, зум 10 (первая торговая зона из предложения
  владельцу).
- Один источник `points` типа `geojson` с `cluster: true`,
  `clusterRadius: 50`, `clusterMaxZoom: 12`.
- Слои: `clusters` (`circle`, радиус по `point_count` ступенями 16/20/26,
  цвет `#2563eb`), `cluster-count` (`symbol`, `text-field:
  ["get","point_count_abbreviated"]`), `pin` (`circle`, радиус 9, цвет по
  `["get","availability"]` через `match`: FREE `#10b981`, BUSY `#f5b400`,
  BOOKED `#38bdf8`, OUT_OF_SERVICE `#f87171`, остальное `#94a3b8`,
  обводка 2 px `#0b0f14`), `pin-glyph` (`symbol`, `text-field:
  ["get","glyph"]`, размер 11).
- Знак типа в `glyph`: `CHARGING_STATION` → `⚡`, `POWERBANK` → `▮`,
  `GENERATION` → `☀`, `MIXED` → `◆`, чужой пин (без `pointType`) → `·`.
- Тап по кластеру — `getClusterExpansionZoom` и `easeTo`; тап по пину —
  `setSelected(station)`.
- Загрузка данных: при `moveend` (с задержкой 600 мс, как в навигаторе на
  монитор) зовёт `/api/chargers?south=…&west=…&north=…&east=…&<toQuery(filters)>`
  плюс `atLat`/`atLng`, если геолокация есть. Прошлый запрос отменяется
  `AbortController`. Заголовок `X-Ours-Only` включает строку `labels.oursOnly`
  над картой.
- Смена фильтров: `window.history.replaceState` с новым адресом (как в
  `navigator-client.tsx`) и перезапрос по текущему прямоугольнику.
- Кнопка «где я» (`data-testid="locate"`): `navigator.geolocation.getCurrentPosition`,
  отказ — надпись `labels.locateDenied`, экран работает дальше.
- Кнопка «Фильтры» (`data-testid="map-filters"`) с числом включённых
  (`activeCount`) открывает `MapFilterSheet`.
- Контейнер карты `data-testid="point-map"`, число найденных —
  `data-testid="map-count"`.

- [x] **Step 3: The filter sheet**

`src/components/mobile/map-filter-sheet.tsx` — лист снизу с девятью
фильтрами: четыре `select` (тип, разъём, мощность, способ оплаты), три
переключателя (свободен сейчас, 24/7, зелёный источник), два числовых поля
(цена в деньгах, цена в токенах). Кнопки «Применить» (`data-testid="filters-apply"`)
и «Сбросить». Вокабуляры берутся из `map-filters.ts` (`POINT_TYPES`,
`CONNECTORS`, `POWER_LEVELS`, `PAYMENT_METHODS`) — второго списка в коде не
появляется. Под «зелёным источником» — подпись `labels.greenHint`
(«сеть и смешанный не считаются»).

- [x] **Step 4: The mini-card**

`src/components/mobile/point-mini-card.tsx` — лист снизу
(`data-testid="mini-card"`): название, оператор, расстояние (если есть),
чип доступности, цена в деньгах и в токенах (если есть), «свободно N из M»,
и действия:

- `<RouteSheet>` с координатами пункта;
- «Зарядиться» — `Link` на `/${locale}/app/charge/start?p=<poolwattPointId>`
  (`data-testid="mini-charge"`), показывается только у нашего пункта;
- «Подробнее» — `Link` на `/${locale}/c/<id>` (`data-testid="mini-details"`);
  на M3-б-2 адрес сменится на `/${locale}/app/c/<id>`;
- если цена посчитана по UTC (`priceZoneKnown` ложно) — подпись
  `labels.priceUtc`.

Чужой пин (без `poolwattPointId`) получает только название, адрес и маршрут:
цены и занятости у него нет, и придумывать их нельзя.

- [x] **Step 5: Build and look at it**

Run: `npm run build && pm2 restart poolwatt-web`
Then: `curl -s -o /dev/null -w '%{http_code}\n' https://poolwatt.com/ru/app/map`
Expected: `200`.

- [x] **Step 6: Commit**

```bash
git add src/app/[locale]/app/map src/components/mobile/point-map.tsx \
  src/components/mobile/map-filter-sheet.tsx src/components/mobile/point-mini-card.tsx \
  messages/en.json messages/ru.json messages/sk.json
git commit -m "feat(mobile): the §27 map — clustering, nine filters, a mini-card"
```

---

### Task 8: путь на карту с экрана зарядки

**Files:**
- Modify: `src/components/mobile/charge-entry.tsx`
- Modify: `src/app/[locale]/app/charge/page.tsx`
- Modify: `messages/en.json`, `messages/ru.json`, `messages/sk.json`

- [x] **Step 1: Add the link**

В `src/components/mobile/charge-entry.tsx` под `<QrScan>` и над
`<NearbyPoints>` добавить ссылку на карту:

```tsx
      <Link
        href={`/${locale}/app/map`}
        data-testid="open-map"
        className="mt-6 block rounded-lg border border-hairline px-4 py-3 text-center text-[14px]"
      >
        {labels.openMap}
      </Link>
```

и добавить `openMap: string` в тип `labels`, `import Link from "next/link";`.

В `src/app/[locale]/app/charge/page.tsx` в `entryLabels` добавить
`openMap: t("openMap")`, а в `messages/*.json` — ключ `app.charge.openMap`:
en `"Open the map"`, ru `"Открыть карту"`, sk `"Otvoriť mapu"`.

- [x] **Step 2: Build and check**

Run: `npm run build && pm2 restart poolwatt-web && curl -s -o /dev/null -w '%{http_code}\n' https://poolwatt.com/ru/app/charge`
Expected: `200`.

- [x] **Step 3: Commit**

```bash
git add src/components/mobile/charge-entry.tsx src/app/[locale]/app/charge/page.tsx messages
git commit -m "feat(mobile): the charge tab opens the map"
```

---

### Task 9: e2e на Pixel 7

**Files:**
- Create: `tests/e2e/mobile-navigator.mobile.spec.ts`

- [x] **Step 1: Write the test**

`tests/e2e/mobile-navigator.mobile.spec.ts` — проект `mobile` в
`playwright.config.ts` (Pixel 7), против живого домена. Случаи:

1. `/ru/app/map` отвечает, контейнер `point-map` есть, карта нарисовала
   canvas (`page.locator("canvas")` видим).
2. Кнопка «Фильтры» открывает лист; выбор «свободен сейчас» и «Применить»
   оставляет `free=1` в адресе и включает строку «только пункты Poolwatt».
3. Переход на `/ru/app/map?free=1&type=CHARGING_STATION` сохраняет выбранные
   фильтры в листе (бейдж показывает 2).
4. Тап по пину нашего пункта открывает мини-карточку, в ней есть «Маршрут» и
   «Зарядиться»; «Зарядиться» ведёт на `/ru/app/charge/start?p=…`.
5. Кнопка «Маршрут» открывает лист с четырьмя вариантами
   (`route-system`, `route-google`, `route-apple`, `route-waze`).
6. С экрана зарядки `/ru/app/charge` ссылка `open-map` ведёт на карту.

Чтобы тап по пину был воспроизводим, тест сначала переходит на адрес с
координатами известного посеянного пункта: экран принимает `?lat=&lng=&z=`
для начального вида — добавить разбор этих трёх параметров в
`src/app/[locale]/app/map/page.tsx` и `point-map.tsx`. Пин ищется не по
canvas, а через `page.evaluate` — карта кладёт на `window.__pwMap` ссылку на
себя в непродакшн… **нет**: вместо этого мини-карточка открывается
программно по адресу — экран принимает `?open=<pointId>` и открывает
мини-карточку сразу. Это и тестируемо, и полезно само: ссылка на пункт с
карты.

- [x] **Step 2: Run it**

Run: `npm run test:e2e -- --project=mobile mobile-navigator`
Expected: PASS, 6 cases. `pm2 status` перед запуском: `poolwatt-web` online.

- [x] **Step 3: Commit**

```bash
git add tests/e2e/mobile-navigator.mobile.spec.ts src/app/[locale]/app/map/page.tsx src/components/mobile/point-map.tsx
git commit -m "test(mobile): the §27 map on a Pixel 7"
```

---

### Task 10: вся проверка, сборка APK, реестр

- [x] **Step 1: The whole unit suite**

Run:
```bash
cd ~/poolwatt
NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local | tr -d '"' \
  | sed 's|/poolwatt?|/poolwatt_test?|')" npx vitest run
```
Expected: зелено, кроме двух случаев `bot/__tests__/tts-bilingual.test.ts`,
если нет `OPENAI_API_KEY`.

- [x] **Step 2: The whole e2e suite**

Run: `npm run test:e2e`
Expected: зелено.

- [x] **Step 3: APK**

Run: `/home/dv/bin/android-build`
Expected: печатает адрес `https://poolwatt.com/downloads/poolwatt-build-<N>.apk`.

- [x] **Step 4: Tick this plan and update the tracker**

Отметить шаги в этом файле. В `inbox/TZ-STATUS.md`: строка M3-б в таблице
блока M делится на M3-б-1 (готово) и M3-б-2 (не начато), доказательство
дописывается абзацем, как у M1 и M2.

- [x] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-11-26-mobile-navigator-map.md
git commit -m "docs(mobile): tick the M3-б-1 plan"
```

---

## Где работа ушла от плана

- **Сев фильтров — в своём прямоугольнике.** План просил расширить общий сев
  `point-search.test.ts`. Случаи US-23 в этом файле сравнивают выдачу
  поимённо, и новые пункты в их коробке лишили бы эти сравнения смысла.
  Девять фильтров §27 проверяются на отдельном прямоугольнике `WIDE`.
- **`tariffAt` получил второй вид.** В чеке функция принимала момент, а не
  минуту суток, поэтому рядом с `tariffAt(tariffs, minute)` появился
  `tariffAtDate(tariffs, at, country)`. Заодно чек перестал считать окно
  суток по UTC и считает его по часам страны пункта.
- **`point-detail.ts` тоже исправлен.** Карточка `/c/[id]` брала первое окно
  суток ровно так же, как поиск; раз причина одна, исправлено в обоих местах.
- **Мини-карточка открывается адресом.** Чтобы тап по пину был проверяем из
  Playwright (карта — это canvas), экран принимает `?open=<id>` и открывает
  мини-карточку сразу. Это и нужно само: так на пункт можно дать ссылку с
  карты. Начальный вид задаётся `?lat=&lng=&z=`.
- **Попутно найдено и исправлено.** Случай `resolve-user.test.ts` «никогда не
  создаёт аккаунт» сравнивал общее число пользователей базы, а соседние файлы
  набора идут рядом и заводят своих: в полном прогоне он падал через раз.
  Теперь считает только своих.
- **Фильтр мощности — это минимум, а не ступень.** Навигатор на монитор
  сравнивает ступень пункта с выбранной; водителю на телефоне полезнее
  «не меньше такой», и `/api/chargers` переводит ступень в киловатты снизу.

## Доказательство

- 1528 юнит-тестов и 135 e2e зелёные на живой сборке; из e2e шесть новых на
  Pixel 7 через настоящий домен (`tests/e2e/mobile-navigator.mobile.spec.ts`).
- `https://poolwatt.com/ru/app/map` отвечает 200, с фильтром в адресе тоже.
- `/api/chargers` без фильтров отдаёт прежнюю выдачу (`x-count: 187`,
  `x-source: live`), с `free=1` — только наши пункты и `x-ours-only: 1`.
- APK build 7: `https://poolwatt.com/downloads/poolwatt-build-7.apk`.
