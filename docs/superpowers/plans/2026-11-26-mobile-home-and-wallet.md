# M2 — главный экран и кошелёк в телефоне: план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/{locale}/app` и `/{locale}/app/wallet` становятся работающими
экранами §22.2 и §22.3: живой баланс (US-17), покупка впрок (US-07),
история операций с фильтром, чеки §46 и подарки §43.

**Architecture:** новый сервис `wallet-history.ts` склеивает ленту из
`Trade`, `Payment`, `TokenTransfer` и `PromoGrant`; чистая функция
`history-filter.ts` разбирает чип фильтра из адреса; клиентские
компоненты `mobile-balance.tsx` (канал §15) и `buy-sheet.tsx` (то же
серверное действие `submitBuyAhead`, что у кабинета); чек в телефоне
переиспользует `buildReceiptDocument` и `ReceiptSheet`.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma, next-intl v4,
Vitest, Playwright (проект `mobile`, Pixel 7).

Спецификация: `docs/superpowers/specs/2026-11-26-mobile-home-and-wallet-design.md`.

**Как запускать тесты в этом репозитории** (из `CLAUDE.md`, иначе тесты
уйдут в живую базу и упадут на гейтах):

```bash
cd ~/poolwatt
NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local \
  | tr -d '"' | sed 's|/poolwatt?|/poolwatt_test?|')" npx vitest run <путь>
```

---

## Структура файлов

| Файл | Ответственность |
| --- | --- |
| `src/lib/exchange/wallet-history.ts` | создать: лента операций + средняя цена покупки |
| `src/lib/exchange/wallet-history.test.ts` | создать: интеграционные тесты ленты |
| `src/lib/mobile/history-filter.ts` | создать: чип фильтра ↔ виды операций |
| `src/lib/mobile/history-filter.test.ts` | создать: юнит-тесты разбора |
| `src/components/mobile/mobile-balance.tsx` | создать: живой баланс §15 на два экрана |
| `src/components/mobile/buy-sheet.tsx` | создать: покупка впрок под палец |
| `src/components/mobile/history-list.tsx` | создать: лента + чипы фильтра |
| `src/app/[locale]/app/wallet/page.tsx` | заменить заглушку на экран §22.3 |
| `src/app/[locale]/app/wallet/receipts/[id]/page.tsx` | создать: чек §46 в телефоне |
| `src/app/[locale]/app/page.tsx` | изменить: статичный баланс → `MobileBalance` |
| `src/app/[locale]/me/wallet/page.tsx` | изменить: звать `readPurchaseStats` вместо своей арифметики |
| `src/app/[locale]/exchange/actions.ts` | изменить: `submitBuyAhead` обновляет и адреса `/app` |
| `messages/{ru,en,sk}.json` | изменить: пространство `app.wallet`, `app.history` |
| `tests/e2e/mobile-wallet.mobile.spec.ts` | создать: e2e на Pixel 7 |

---

## Задача 1: сервис ленты операций

**Файлы:**
- Создать: `src/lib/exchange/wallet-history.ts`
- Создать: `src/lib/exchange/wallet-history.test.ts`

- [x] **Шаг 1: написать падающий тест**

`src/lib/exchange/wallet-history.test.ts`:

```ts
// §22.3 "история операций с фильтром" — лента склеивается из четырёх
// таблиц, и ни одна незавершённая операция в неё не попадает.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readWalletHistory, readPurchaseStats } from "./wallet-history";

const PREFIX = "test_wh_";
const ZONE_CODE = "WHZONE";

let zoneId: string;
let meId: string;
let friendId: string;
let myWalletId: string;
let friendWalletId: string;
let operatorId: string;
let campaignId: string;

async function cleanup() {
  const zone = await prisma.gridZone.findUnique({ where: { code: ZONE_CODE } });
  if (zone) {
    await prisma.receipt.deleteMany({
      where: { OR: [{ payment: { zoneId: zone.id } }, { trade: { zoneId: zone.id } }] },
    });
    await prisma.trade.deleteMany({ where: { zoneId: zone.id } });
    await prisma.payment.deleteMany({ where: { zoneId: zone.id } });
    await prisma.tokenTransfer.deleteMany({ where: { zoneId: zone.id } });
    await prisma.order.deleteMany({ where: { zoneId: zone.id } });
    await prisma.wallet.deleteMany({ where: { zoneId: zone.id } });
  }
  await prisma.promoGrant.deleteMany({ where: { user: { username: { startsWith: PREFIX } } } });
  await prisma.campaign.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  if (zone) await prisma.gridZone.delete({ where: { id: zone.id } });
}

beforeAll(async () => {
  await cleanup();

  const zone = await prisma.gridZone.create({
    data: {
      code: ZONE_CODE,
      country: "SK",
      name: "History Zone",
      currency: "EUR",
      intervalMinutes: 15,
      corridorPct: new Prisma.Decimal(50),
      aggregatorName: "test-aggregator",
    },
  });
  zoneId = zone.id;

  const me = await prisma.user.create({
    data: { username: `${PREFIX}me`, passwordHash: "x" },
  });
  const friend = await prisma.user.create({
    data: { username: `${PREFIX}friend`, passwordHash: "x" },
  });
  meId = me.id;
  friendId = friend.id;

  const myWallet = await prisma.wallet.create({
    data: { ownerUserId: meId, zoneId, currency: "EUR" },
  });
  const friendWallet = await prisma.wallet.create({
    data: { ownerUserId: friendId, zoneId, currency: "EUR" },
  });
  myWalletId = myWallet.id;
  friendWalletId = friendWallet.id;

  const operator = await prisma.chargerOperator.create({
    data: { slug: `${PREFIX}net`, displayName: "History Net" },
  });
  operatorId = operator.id;

  const campaign = await prisma.campaign.create({
    data: {
      name: `${PREFIX}campaign`,
      operatorId,
      status: "ACTIVE",
      trigger: "FIRST_CHARGE",
      grantKwh: new Prisma.Decimal(5),
      budgetKwh: new Prisma.Decimal(100),
      validDays: 30,
    },
  });
  campaignId = campaign.id;

  // Две сделки по моей заявке на покупку: 10 кВт·ч по 0.20 и 30 по 0.30.
  // Средневзвешенная цена — (10×0.2 + 30×0.3) / 40 = 0.275.
  const myBuy = await prisma.order.create({
    data: {
      walletId: myWalletId,
      zoneId,
      side: "BUY",
      type: "MARKET",
      amountKwh: new Prisma.Decimal(40),
      filledKwh: new Prisma.Decimal(40),
      status: "FILLED",
    },
  });
  const friendSell = await prisma.order.create({
    data: {
      walletId: friendWalletId,
      zoneId,
      side: "SELL",
      type: "LIMIT",
      amountKwh: new Prisma.Decimal(40),
      filledKwh: new Prisma.Decimal(40),
      limitPrice: new Prisma.Decimal(0.2),
      status: "FILLED",
    },
  });
  await prisma.trade.create({
    data: {
      zoneId,
      buyOrderId: myBuy.id,
      sellOrderId: friendSell.id,
      amountKwh: new Prisma.Decimal(10),
      price: new Prisma.Decimal(0.2),
      buyerFee: new Prisma.Decimal(0.01),
      executedAt: new Date("2026-11-01T10:00:00.000Z"),
    },
  });
  await prisma.trade.create({
    data: {
      zoneId,
      buyOrderId: myBuy.id,
      sellOrderId: friendSell.id,
      amountKwh: new Prisma.Decimal(30),
      price: new Prisma.Decimal(0.3),
      buyerFee: new Prisma.Decimal(0.02),
      executedAt: new Date("2026-11-02T10:00:00.000Z"),
    },
  });

  // Моя продажа.
  const mySell = await prisma.order.create({
    data: {
      walletId: myWalletId,
      zoneId,
      side: "SELL",
      type: "LIMIT",
      amountKwh: new Prisma.Decimal(4),
      filledKwh: new Prisma.Decimal(4),
      limitPrice: new Prisma.Decimal(0.25),
      status: "FILLED",
    },
  });
  const friendBuy = await prisma.order.create({
    data: {
      walletId: friendWalletId,
      zoneId,
      side: "BUY",
      type: "MARKET",
      amountKwh: new Prisma.Decimal(4),
      filledKwh: new Prisma.Decimal(4),
      status: "FILLED",
    },
  });
  await prisma.trade.create({
    data: {
      zoneId,
      buyOrderId: friendBuy.id,
      sellOrderId: mySell.id,
      amountKwh: new Prisma.Decimal(4),
      price: new Prisma.Decimal(0.25),
      sellerFee: new Prisma.Decimal(0.01),
      executedAt: new Date("2026-11-03T10:00:00.000Z"),
    },
  });

  // Зарядка со чеком и зарядка, которая ещё не состоялась.
  const captured = await prisma.payment.create({
    data: {
      walletId: myWalletId,
      zoneId,
      requestedKwh: new Prisma.Decimal(12),
      kwhFromBalance: new Prisma.Decimal(12),
      amountFiat: new Prisma.Decimal(3.6),
      status: "CAPTURED",
      createdAt: new Date("2026-11-04T10:00:00.000Z"),
      capturedAt: new Date("2026-11-04T10:30:00.000Z"),
    },
  });
  await prisma.receipt.create({
    data: {
      paymentId: captured.id,
      totalKwh: new Prisma.Decimal(12),
      totalFiat: new Prisma.Decimal(3.6),
      currency: "EUR",
    },
  });
  await prisma.payment.create({
    data: {
      walletId: myWalletId,
      zoneId,
      requestedKwh: new Prisma.Decimal(99),
      status: "INITIATED",
      createdAt: new Date("2026-11-05T10:00:00.000Z"),
    },
  });

  // Перевод наружу, перевод внутрь и отменённый перевод.
  await prisma.tokenTransfer.create({
    data: {
      zoneId,
      fromWalletId: myWalletId,
      toWalletId: friendWalletId,
      amountKwh: new Prisma.Decimal(2),
      status: "CONFIRMED",
      createdAt: new Date("2026-11-06T10:00:00.000Z"),
    },
  });
  await prisma.tokenTransfer.create({
    data: {
      zoneId,
      fromWalletId: friendWalletId,
      toWalletId: myWalletId,
      amountKwh: new Prisma.Decimal(3),
      status: "CONFIRMED",
      createdAt: new Date("2026-11-07T10:00:00.000Z"),
    },
  });
  await prisma.tokenTransfer.create({
    data: {
      zoneId,
      fromWalletId: myWalletId,
      toWalletId: friendWalletId,
      amountKwh: new Prisma.Decimal(50),
      status: "CANCELLED",
      createdAt: new Date("2026-11-08T10:00:00.000Z"),
    },
  });

  // Подарок §43.
  await prisma.promoGrant.create({
    data: {
      campaignId,
      userId: meId,
      operatorId,
      amountKwh: new Prisma.Decimal(5),
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      status: "ACTIVE",
      issuedAt: new Date("2026-11-09T10:00:00.000Z"),
    },
  });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("readWalletHistory", () => {
  it("merges every kind of operation, newest first", async () => {
    const rows = await readWalletHistory(meId);
    expect(rows.map((r) => r.kind)).toEqual([
      "GIFT",
      "TRANSFER_IN",
      "TRANSFER_OUT",
      "CHARGE",
      "SELL",
      "BUY",
      "BUY",
    ]);
  });

  it("signs kWh the way a person reads the operation", async () => {
    const rows = await readWalletHistory(meId);
    const byKind = (kind: string) => rows.find((r) => r.kind === kind)!;
    expect(byKind("BUY").kwh).toBeGreaterThan(0);
    expect(byKind("SELL").kwh).toBe(-4);
    expect(byKind("CHARGE").kwh).toBe(-12);
    expect(byKind("CHARGE").fiat).toBe(-3.6);
    expect(byKind("TRANSFER_OUT").kwh).toBe(-2);
    expect(byKind("TRANSFER_IN").kwh).toBe(3);
    expect(byKind("GIFT").kwh).toBe(5);
  });

  it("leaves out what has not happened", async () => {
    const rows = await readWalletHistory(meId);
    // Платёж INITIATED на 99 кВт·ч и отменённый перевод на 50.
    expect(rows.some((r) => Math.abs(r.kwh) === 99)).toBe(false);
    expect(rows.some((r) => Math.abs(r.kwh) === 50)).toBe(false);
  });

  it("filters by kind", async () => {
    const rows = await readWalletHistory(meId, { kinds: ["CHARGE", "GIFT"] });
    expect(rows.map((r) => r.kind)).toEqual(["GIFT", "CHARGE"]);
  });

  it("carries the receipt of a charge so the row can open it", async () => {
    const rows = await readWalletHistory(meId, { kinds: ["CHARGE"] });
    expect(rows[0]!.receiptId).toBeTruthy();
  });

  it("names the network of a gift", async () => {
    const rows = await readWalletHistory(meId, { kinds: ["GIFT"] });
    expect(rows[0]!.title).toBe("History Net");
  });

  it("honours the limit", async () => {
    const rows = await readWalletHistory(meId, { limit: 2 });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.kind).toBe("GIFT");
  });

  it("shows nothing to a stranger", async () => {
    const rows = await readWalletHistory(friendId, { kinds: ["GIFT"] });
    expect(rows).toHaveLength(0);
  });
});

describe("readPurchaseStats", () => {
  it("weights the average price by volume", async () => {
    const stats = await readPurchaseStats(meId);
    expect(stats.boughtKwh).toBe(40);
    expect(stats.avgPrice).toBe(0.275);
  });

  it("has no average before the first purchase", async () => {
    const stats = await readPurchaseStats(friendId);
    expect(stats.boughtKwh).toBe(0);
    expect(stats.avgPrice).toBeNull();
  });
});
```

- [x] **Шаг 2: запустить и убедиться, что падает**

```bash
cd ~/poolwatt
NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local \
  | tr -d '"' | sed 's|/poolwatt?|/poolwatt_test?|')" \
  npx vitest run src/lib/exchange/wallet-history.test.ts
```

Ожидается: FAIL, `Failed to resolve import "./wallet-history"`.

- [x] **Шаг 3: написать сервис**

`src/lib/exchange/wallet-history.ts`:

```ts
// §22.3 "история операций с фильтром" — одна лента на четыре таблицы.
//
// Знак кВт·ч здесь — «как операцию читает человек», а не проводка по
// балансу: у зарядки часть кВт·ч могла быть докуплена в тот же миг, и
// точную разбивку §16.6 даёт чек, который открывается из строки. Не
// считайте по этой ленте баланс — для этого есть `Wallet` и реестр
// партий.
//
// В ленту попадает только то, что случилось: платёж в статусе INITIATED
// или AUTHORIZED ещё не произошёл, отменённый перевод не произошёл тоже.
//
// Подарок §43 в ленте есть, но в `Wallet.kwhBalance` его нет — энергию
// под него даёт кошелёк партнёра. Поэтому `fiat` у подарка нулевой, а
// экран показывает подарки ещё и отдельным блоком.

import { prisma } from "@/lib/prisma";
import type { Db } from "./audit";
import { num } from "./decimal";
import { roundKwh, roundMoney, roundPrice } from "./precision";

export type WalletHistoryKind =
  | "BUY"
  | "SELL"
  | "CHARGE"
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "GIFT";

export const ALL_HISTORY_KINDS: WalletHistoryKind[] = [
  "BUY",
  "SELL",
  "CHARGE",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "GIFT",
];

export interface WalletHistoryEntry {
  /** `<kind>:<sourceId>` — две таблицы могут выдать один и тот же cuid. */
  id: string;
  kind: WalletHistoryKind;
  at: Date;
  kwh: number;
  fiat: number;
  currency: string | null;
  zoneCode: string | null;
  receiptId: string | null;
  /** Пункт, ник второй стороны или название сети подарка. */
  title: string | null;
}

export interface WalletHistoryQuery {
  kinds?: WalletHistoryKind[];
  limit?: number;
}

const DEFAULT_LIMIT = 50;

export async function readWalletHistory(
  userId: string,
  query: WalletHistoryQuery = {},
  db: Db = prisma,
): Promise<WalletHistoryEntry[]> {
  const kinds = new Set(query.kinds ?? ALL_HISTORY_KINDS);
  const limit = query.limit ?? DEFAULT_LIMIT;

  const wallets = await db.wallet.findMany({
    where: { ownerUserId: userId },
    select: { id: true },
  });
  const walletIds = wallets.map((w) => w.id);

  const entries: WalletHistoryEntry[] = [];

  // Каждая выборка берёт `limit` — после склейки лишнее отрезается, и ни
  // один вид не может вытеснить остальные из начала ленты.
  if (walletIds.length > 0 && (kinds.has("BUY") || kinds.has("SELL"))) {
    const trades = await db.trade.findMany({
      where: {
        OR: [
          ...(kinds.has("BUY") ? [{ buyOrder: { walletId: { in: walletIds } } }] : []),
          ...(kinds.has("SELL") ? [{ sellOrder: { walletId: { in: walletIds } } }] : []),
        ],
      },
      orderBy: { executedAt: "desc" },
      take: limit,
      select: {
        id: true,
        amountKwh: true,
        price: true,
        buyerFee: true,
        sellerFee: true,
        executedAt: true,
        buyOrder: { select: { walletId: true } },
        sellOrder: { select: { walletId: true } },
        zone: { select: { code: true, currency: true } },
        receipt: { select: { id: true } },
      },
    });

    const mine = new Set(walletIds);
    for (const trade of trades) {
      const amount = num(trade.amountKwh);
      const notional = amount * num(trade.price);
      // Сделка сама с собой невозможна: одна заявка — один кошелёк, и
      // матчинг не сводит две заявки одного кошелька.
      const isBuy = mine.has(trade.buyOrder.walletId);
      const kind: WalletHistoryKind = isBuy ? "BUY" : "SELL";
      if (!kinds.has(kind)) continue;
      entries.push({
        id: `${kind}:${trade.id}`,
        kind,
        at: trade.executedAt,
        kwh: roundKwh(isBuy ? amount : -amount),
        fiat: roundMoney(
          isBuy ? -(notional + num(trade.buyerFee)) : notional - num(trade.sellerFee),
        ),
        currency: trade.zone.currency,
        zoneCode: trade.zone.code,
        receiptId: trade.receipt?.id ?? null,
        title: null,
      });
    }
  }

  if (walletIds.length > 0 && kinds.has("CHARGE")) {
    const payments = await db.payment.findMany({
      where: { walletId: { in: walletIds }, status: "CAPTURED" },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        requestedKwh: true,
        amountFiat: true,
        createdAt: true,
        capturedAt: true,
        zone: { select: { code: true, currency: true } },
        point: { select: { name: true } },
        receipt: { select: { id: true } },
      },
    });
    for (const payment of payments) {
      entries.push({
        id: `CHARGE:${payment.id}`,
        kind: "CHARGE",
        at: payment.capturedAt ?? payment.createdAt,
        kwh: roundKwh(-num(payment.requestedKwh)),
        fiat: roundMoney(-num(payment.amountFiat)),
        currency: payment.zone.currency,
        zoneCode: payment.zone.code,
        receiptId: payment.receipt?.id ?? null,
        title: payment.point?.name ?? null,
      });
    }
  }

  if (walletIds.length > 0 && (kinds.has("TRANSFER_IN") || kinds.has("TRANSFER_OUT"))) {
    const transfers = await db.tokenTransfer.findMany({
      where: {
        status: "CONFIRMED",
        OR: [
          ...(kinds.has("TRANSFER_OUT") ? [{ fromWalletId: { in: walletIds } }] : []),
          ...(kinds.has("TRANSFER_IN") ? [{ toWalletId: { in: walletIds } }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        amountKwh: true,
        createdAt: true,
        confirmedAt: true,
        fromWalletId: true,
        toWalletId: true,
        zone: { select: { code: true, currency: true } },
        fromWallet: { select: { owner: { select: { username: true } } } },
        toWallet: { select: { owner: { select: { username: true } } } },
      },
    });

    const mine = new Set(walletIds);
    for (const transfer of transfers) {
      const outgoing = mine.has(transfer.fromWalletId);
      const kind: WalletHistoryKind = outgoing ? "TRANSFER_OUT" : "TRANSFER_IN";
      if (!kinds.has(kind)) continue;
      const amount = num(transfer.amountKwh);
      entries.push({
        id: `${kind}:${transfer.id}`,
        kind,
        at: transfer.confirmedAt ?? transfer.createdAt,
        kwh: roundKwh(outgoing ? -amount : amount),
        fiat: 0,
        currency: transfer.zone.currency,
        zoneCode: transfer.zone.code,
        receiptId: null,
        title: outgoing
          ? transfer.toWallet.owner.username
          : transfer.fromWallet.owner.username,
      });
    }
  }

  if (kinds.has("GIFT")) {
    const grants = await db.promoGrant.findMany({
      where: { userId },
      orderBy: { issuedAt: "desc" },
      take: limit,
      select: {
        id: true,
        amountKwh: true,
        issuedAt: true,
        operator: { select: { displayName: true } },
      },
    });
    for (const grant of grants) {
      entries.push({
        id: `GIFT:${grant.id}`,
        kind: "GIFT",
        at: grant.issuedAt,
        kwh: roundKwh(num(grant.amountKwh)),
        fiat: 0,
        currency: null,
        zoneCode: null,
        receiptId: null,
        title: grant.operator.displayName,
      });
    }
  }

  entries.sort((a, b) => b.at.getTime() - a.at.getTime());
  return entries.slice(0, limit);
}

export interface PurchaseStats {
  /** Средневзвешенная цена покупки, §22.3. Null до первой покупки. */
  avgPrice: number | null;
  boughtKwh: number;
}

export async function readPurchaseStats(
  userId: string,
  db: Db = prisma,
): Promise<PurchaseStats> {
  const buys = await db.trade.findMany({
    where: { buyOrder: { wallet: { ownerUserId: userId } } },
    select: { amountKwh: true, price: true },
  });
  const boughtKwh = buys.reduce((sum, b) => sum + num(b.amountKwh), 0);
  const boughtValue = buys.reduce((sum, b) => sum + num(b.amountKwh) * num(b.price), 0);
  return {
    boughtKwh: roundKwh(boughtKwh),
    avgPrice: boughtKwh > 0 ? roundPrice(boughtValue / boughtKwh) : null,
  };
}
```

- [x] **Шаг 4: запустить и убедиться, что проходит**

```bash
cd ~/poolwatt
NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local \
  | tr -d '"' | sed 's|/poolwatt?|/poolwatt_test?|')" \
  npx vitest run src/lib/exchange/wallet-history.test.ts
```

Ожидается: 10 passed.

- [x] **Шаг 5: коммит**

```bash
git add src/lib/exchange/wallet-history.ts src/lib/exchange/wallet-history.test.ts
git commit -m "feat(wallet): one operation history over trades, charges, transfers and gifts"
```

---

## Задача 2: разбор чипа фильтра

**Файлы:**
- Создать: `src/lib/mobile/history-filter.ts`
- Создать: `src/lib/mobile/history-filter.test.ts`

- [x] **Шаг 1: написать падающий тест**

`src/lib/mobile/history-filter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { HISTORY_FILTERS, kindsForFilter, parseHistoryFilter } from "./history-filter";

describe("parseHistoryFilter", () => {
  it("defaults to everything", () => {
    expect(parseHistoryFilter(undefined)).toBe("all");
    expect(parseHistoryFilter("")).toBe("all");
  });

  it("reads a known chip", () => {
    expect(parseHistoryFilter("charge")).toBe("charge");
    expect(parseHistoryFilter("gift")).toBe("gift");
  });

  it("does not break on rubbish in the address", () => {
    expect(parseHistoryFilter("../etc/passwd")).toBe("all");
    expect(parseHistoryFilter("CHARGE")).toBe("all");
  });
});

describe("kindsForFilter", () => {
  it("asks for no filter at all when everything is wanted", () => {
    expect(kindsForFilter("all")).toBeUndefined();
  });

  it("maps a chip onto the kinds of the service", () => {
    expect(kindsForFilter("buy")).toEqual(["BUY"]);
    expect(kindsForFilter("sell")).toEqual(["SELL"]);
    expect(kindsForFilter("charge")).toEqual(["CHARGE"]);
    expect(kindsForFilter("gift")).toEqual(["GIFT"]);
  });

  it("puts both directions of a transfer under one chip", () => {
    expect(kindsForFilter("transfer")).toEqual(["TRANSFER_IN", "TRANSFER_OUT"]);
  });

  it("offers every chip exactly once, 'all' first", () => {
    expect(HISTORY_FILTERS[0]).toBe("all");
    expect(new Set(HISTORY_FILTERS).size).toBe(HISTORY_FILTERS.length);
  });
});
```

- [x] **Шаг 2: запустить и убедиться, что падает**

```bash
cd ~/poolwatt && NODE_ENV=test npx vitest run src/lib/mobile/history-filter.test.ts
```

Ожидается: FAIL, `Failed to resolve import "./history-filter"`.

- [x] **Шаг 3: написать модуль**

`src/lib/mobile/history-filter.ts`:

```ts
// §22.3 — фильтр ленты живёт в адресе страницы (`?kind=charge`), как
// фильтры навигатора. «Назад» возвращает к тому же фильтру, а ссылку
// можно отдать поддержке. Мусор в адресе показывает «все», а не ошибку.

import type { WalletHistoryKind } from "@/lib/exchange/wallet-history";

export const HISTORY_FILTERS = [
  "all",
  "buy",
  "sell",
  "charge",
  "transfer",
  "gift",
] as const;

export type HistoryFilter = (typeof HISTORY_FILTERS)[number];

export function parseHistoryFilter(raw: string | undefined | null): HistoryFilter {
  return HISTORY_FILTERS.includes(raw as HistoryFilter) ? (raw as HistoryFilter) : "all";
}

/** `undefined` — не фильтровать: именно это ждёт `readWalletHistory`. */
export function kindsForFilter(filter: HistoryFilter): WalletHistoryKind[] | undefined {
  switch (filter) {
    case "all":
      return undefined;
    case "buy":
      return ["BUY"];
    case "sell":
      return ["SELL"];
    case "charge":
      return ["CHARGE"];
    case "transfer":
      return ["TRANSFER_IN", "TRANSFER_OUT"];
    case "gift":
      return ["GIFT"];
  }
}
```

- [x] **Шаг 4: запустить и убедиться, что проходит**

```bash
cd ~/poolwatt && NODE_ENV=test npx vitest run src/lib/mobile/history-filter.test.ts
```

Ожидается: 7 passed.

- [x] **Шаг 5: коммит**

```bash
git add src/lib/mobile/history-filter.ts src/lib/mobile/history-filter.test.ts
git commit -m "feat(mobile): the wallet history filter lives in the address"
```

---

## Задача 3: кабинет перестаёт считать среднюю цену сам

**Файлы:**
- Изменить: `src/app/[locale]/me/wallet/page.tsx`

- [x] **Шаг 1: заменить арифметику вызовом сервиса**

Убрать из `Promise.all` выборку `buys` (`prisma.trade.findMany({ where: { buyOrder: … } })`)
и добавить `readPurchaseStats(userId)`. Убрать три строки расчёта
(`boughtKwh`, `boughtValue`, `avgPrice`) и взять их из результата:

```ts
import { readPurchaseStats } from "@/lib/exchange/wallet-history";

// …

const [wallets, zones, account, purchases, receipts, gifts] = await Promise.all([
  readWallets(userId),
  prisma.gridZone.findMany({ orderBy: { code: "asc" } }),
  prisma.settlementAccount.findUnique({ where: { userId } }),
  // §22.3 "средняя цена покупки" — тот же сервис, что в телефоне.
  readPurchaseStats(userId),
  prisma.receipt.findMany({
    /* без изменений */
  }),
  readMyGifts(userId),
]);

const { avgPrice, boughtKwh } = purchases;
```

Удалить ставший ненужным импорт `roundPrice`, если он больше нигде в
файле не используется (`grep -n roundPrice` по файлу: остаётся только
`roundMoney`).

- [x] **Шаг 2: проверить сборку и типы**

```bash
cd ~/poolwatt && npx tsc --noEmit
```

Ожидается: без ошибок.

- [x] **Шаг 3: коммит**

```bash
git add "src/app/[locale]/me/wallet/page.tsx"
git commit -m "refactor(wallet): the cabinet reads the average purchase price from the service"
```

---

## Задача 4: строки перевода

**Файлы:**
- Изменить: `messages/ru.json`, `messages/en.json`, `messages/sk.json`

- [x] **Шаг 1: добавить пространства `app.wallet` и `app.history`**

В `messages/ru.json`, внутрь объекта `"app"`, после `"home"`:

```json
"wallet": {
  "balance": "Баланс",
  "reserved": "В резерве",
  "available": "Доступно",
  "live": "Обновляется",
  "offline": "Нет связи",
  "noWallet": "Кошелёк появится после первой покупки.",
  "buyAhead": "Купить впрок",
  "buyAheadHelp": "Киловатт-часы остаются на балансе и тратятся при зарядке.",
  "amount": "Сколько кВт·ч",
  "limitPrice": "Лимитная цена",
  "buy": "Купить",
  "otherAmount": "Другая сумма",
  "noLiquidity": "Нет в продаже",
  "avgPrice": "Средняя цена покупки",
  "boughtKwh": "Куплено всего",
  "gifts": "Подарки",
  "giftsHelp": "Тратятся в сети партнёра раньше основного баланса.",
  "giftUntil": "до",
  "giftCashback": "кэшбэк",
  "receipt": "Чек"
},
"history": {
  "title": "История операций",
  "empty": "Операций пока нет.",
  "all": "Все",
  "buy": "Покупки",
  "sell": "Продажи",
  "charge": "Зарядки",
  "transfer": "Переводы",
  "gift": "Подарки",
  "kindBUY": "Покупка",
  "kindSELL": "Продажа",
  "kindCHARGE": "Зарядка",
  "kindTRANSFER_IN": "Перевод получен",
  "kindTRANSFER_OUT": "Перевод отправлен",
  "kindGIFT": "Подарок"
}
```

В `messages/en.json`, то же место:

```json
"wallet": {
  "balance": "Balance",
  "reserved": "Reserved",
  "available": "Available",
  "live": "Live",
  "offline": "Offline",
  "noWallet": "A wallet appears with the first purchase.",
  "buyAhead": "Buy ahead",
  "buyAheadHelp": "The kWh stay on your balance and are spent when you charge.",
  "amount": "How many kWh",
  "limitPrice": "Limit price",
  "buy": "Buy",
  "otherAmount": "Another amount",
  "noLiquidity": "Not for sale",
  "avgPrice": "Average purchase price",
  "boughtKwh": "Bought in total",
  "gifts": "Gifts",
  "giftsHelp": "Spent in the partner's network before your own balance.",
  "giftUntil": "until",
  "giftCashback": "cashback",
  "receipt": "Receipt"
},
"history": {
  "title": "Operation history",
  "empty": "No operations yet.",
  "all": "All",
  "buy": "Purchases",
  "sell": "Sales",
  "charge": "Charges",
  "transfer": "Transfers",
  "gift": "Gifts",
  "kindBUY": "Purchase",
  "kindSELL": "Sale",
  "kindCHARGE": "Charge",
  "kindTRANSFER_IN": "Transfer received",
  "kindTRANSFER_OUT": "Transfer sent",
  "kindGIFT": "Gift"
}
```

В `messages/sk.json`, то же место:

```json
"wallet": {
  "balance": "Zostatok",
  "reserved": "Rezervované",
  "available": "Dostupné",
  "live": "Aktualizuje sa",
  "offline": "Bez pripojenia",
  "noWallet": "Peňaženka vznikne pri prvom nákupe.",
  "buyAhead": "Kúpiť dopredu",
  "buyAheadHelp": "Kilowatthodiny zostanú na zostatku a spotrebujú sa pri nabíjaní.",
  "amount": "Koľko kWh",
  "limitPrice": "Limitná cena",
  "buy": "Kúpiť",
  "otherAmount": "Iná suma",
  "noLiquidity": "Nie je na predaj",
  "avgPrice": "Priemerná nákupná cena",
  "boughtKwh": "Kúpené celkom",
  "gifts": "Darčeky",
  "giftsHelp": "Spotrebujú sa v sieti partnera skôr ako vlastný zostatok.",
  "giftUntil": "do",
  "giftCashback": "cashback",
  "receipt": "Účtenka"
},
"history": {
  "title": "História operácií",
  "empty": "Zatiaľ žiadne operácie.",
  "all": "Všetko",
  "buy": "Nákupy",
  "sell": "Predaje",
  "charge": "Nabíjania",
  "transfer": "Prevody",
  "gift": "Darčeky",
  "kindBUY": "Nákup",
  "kindSELL": "Predaj",
  "kindCHARGE": "Nabíjanie",
  "kindTRANSFER_IN": "Prevod prijatý",
  "kindTRANSFER_OUT": "Prevod odoslaný",
  "kindGIFT": "Darček"
}
```

- [x] **Шаг 2: проверить, что все три файла — валидный JSON**

```bash
cd ~/poolwatt && for f in ru en sk; do python3 -m json.tool "messages/$f.json" > /dev/null && echo "$f ok"; done
```

Ожидается: `ru ok`, `en ok`, `sk ok`.

- [x] **Шаг 3: коммит**

```bash
git add messages/ru.json messages/en.json messages/sk.json
git commit -m "i18n(mobile): strings for the phone wallet and the operation history"
```

---

## Задача 5: живой баланс одним компонентом

**Файлы:**
- Создать: `src/components/mobile/mobile-balance.tsx`
- Изменить: `src/app/[locale]/app/page.tsx`

- [x] **Шаг 1: написать компонент**

`src/components/mobile/mobile-balance.tsx`:

```tsx
"use client";

// US-17 "баланс обновляется в реальном времени по WebSocket", §22.2 —
// кВт·ч крупно, деньги под ним. Один компонент на главный экран и на
// кошелёк: на главном без разбивки, в кошельке с зонами и резервом.
//
// Он же пишет кэш для офлайн-страницы, и пишет его при каждом событии
// канала, а не только на серверном рендере: иначе телефон, который
// пролежал на экране кошелька час, уйдёт в офлайн с часовой цифрой.

import { useEffect, useState } from "react";
import { useChannel } from "@/hooks/use-channel";
import type { WalletRow } from "@/components/exchange/live-wallets";
import { BALANCE_CACHE_KEY, type CachedBalance } from "./balance-cache";

export type MobileBalanceLabels = {
  balance: string;
  money: string;
  reserved: string;
  available: string;
  live: string;
  offline: string;
  empty: string;
};

export function MobileBalance({
  initial,
  channel,
  labels,
  detail = false,
}: {
  initial: WalletRow[];
  channel: string;
  labels: MobileBalanceLabels;
  detail?: boolean;
}) {
  const [wallets, setWallets] = useState(initial);
  // Покупка обновляет маршрут, и сервер присылает свежие балансы как
  // `initial` — US-07 требует, чтобы цифра двигалась сразу, с каналом
  // или без него.
  const [seeded, setSeeded] = useState(initial);
  if (seeded !== initial) {
    setSeeded(initial);
    setWallets(initial);
  }

  const { connected } = useChannel(channel, (event) => {
    if (event.type !== "wallet.updated") return;
    const next = event.data.wallets;
    if (Array.isArray(next)) setWallets(next as WalletRow[]);
  });

  const totalKwh = wallets.reduce((sum, w) => sum + w.kwhBalance, 0);
  const primary = wallets.slice().sort((a, b) => b.kwhBalance - a.kwhBalance)[0] ?? null;

  useEffect(() => {
    try {
      const payload: CachedBalance = {
        kwh: totalKwh,
        fiat: primary?.fiatBalance ?? 0,
        currency: primary?.currency ?? "EUR",
        zoneCode: primary?.zoneCode ?? null,
        at: new Date().toISOString(),
      };
      window.localStorage.setItem(BALANCE_CACHE_KEY, JSON.stringify(payload));
    } catch {
      // Приватный режим, квота, старый WebView — цифра здесь удобство.
    }
  }, [totalKwh, primary?.fiatBalance, primary?.currency, primary?.zoneCode]);

  if (wallets.length === 0) {
    return <p className="text-[14px] text-muted mt-6">{labels.empty}</p>;
  }

  return (
    <div className="mt-6">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">
        <span
          aria-hidden
          className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${
            connected ? "bg-accent" : "bg-muted"
          }`}
        />
        <span data-testid="balance-live-state">
          {connected ? labels.live : labels.offline}
        </span>
      </div>

      <div
        data-testid="kwh-balance"
        className="num text-[52px] font-semibold leading-none mt-1"
      >
        {totalKwh.toFixed(2)}
        <span className="text-[18px] text-muted ml-2">kWh</span>
      </div>
      <div data-testid="fiat-balance" className="num text-[16px] text-muted-strong mt-3">
        {(primary?.fiatBalance ?? 0).toFixed(2)} {primary?.currency ?? "EUR"}
        <span className="text-[13px] text-muted ml-2">{labels.money}</span>
      </div>

      {detail && (
        <ul className="mt-5 rounded-lg border border-hairline bg-card divide-y divide-hairline">
          {wallets.map((w) => (
            <li key={w.id} className="px-4 py-3" data-zone={w.zoneCode}>
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] text-muted-strong">{w.zoneCode}</span>
                <span className="num text-[16px]" data-testid={`zone-kwh-${w.zoneCode}`}>
                  {w.kwhBalance.toFixed(3)} kWh
                </span>
              </div>
              <div className="mt-1 flex items-baseline justify-between text-[12px] text-muted">
                <span>
                  {labels.available}{" "}
                  <span className="num">{w.availableFiat.toFixed(2)}</span> {w.currency}
                </span>
                <span>
                  {labels.reserved}{" "}
                  <span className="num">{w.reservedFiat.toFixed(2)}</span> {w.currency}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [x] **Шаг 2: поставить его на главный экран**

В `src/app/[locale]/app/page.tsx` заменить блок `<BalanceCache … />` и
статичную разметку баланса (`{t("balance")}` … `{t("money")}`) на
компонент. Итоговый фрагмент после бейджа статуса:

```tsx
      <MobileBalance
        initial={ctx.wallets}
        channel={walletChannel(session.user.id)}
        labels={{
          balance: t("balance"),
          money: t("money"),
          reserved: tWallet("reserved"),
          available: tWallet("available"),
          live: tWallet("live"),
          offline: tWallet("offline"),
          empty: tWallet("noWallet"),
        }}
      />
```

Импорты в этом файле: убрать `BalanceCache`, добавить

```tsx
import { walletChannel } from "@/lib/exchange/realtime";
import { MobileBalance } from "@/components/mobile/mobile-balance";
```

и рядом с `const t = await getTranslations("app.home");` добавить

```tsx
const tWallet = await getTranslations("app.wallet");
```

- [x] **Шаг 3: проверить типы**

```bash
cd ~/poolwatt && npx tsc --noEmit
```

Ожидается: без ошибок.

- [x] **Шаг 4: коммит**

```bash
git add src/components/mobile/mobile-balance.tsx "src/app/[locale]/app/page.tsx"
git commit -m "feat(mobile): the main screen balance keeps itself current over the wallet channel"
```

---

## Задача 6: покупка впрок под палец

**Файлы:**
- Создать: `src/components/mobile/buy-sheet.tsx`
- Изменить: `src/app/[locale]/exchange/actions.ts`

- [x] **Шаг 1: расширить `revalidatePath` в серверном действии**

В `src/app/[locale]/exchange/actions.ts`, в `submitBuyAhead`, рядом с
существующей строкой:

```ts
    revalidatePath("/[locale]/me/wallet", "page");
    // Те же цифры показывает телефон (§22.2, §22.3).
    revalidatePath("/[locale]/app", "page");
    revalidatePath("/[locale]/app/wallet", "page");
```

- [x] **Шаг 2: написать компонент**

`src/components/mobile/buy-sheet.tsx`:

```tsx
"use client";

// US-07 "покупка по рыночной цене в один клик" на телефоне: три крупные
// кнопки, под ними своя сумма с необязательной лимитной ценой.
//
// Логика покупки не дублируется — это то же серверное действие
// `submitBuyAhead`, которым покупает кабинет. Разная здесь только
// вёрстка: в кабинете мишени размером с курсор, тут размером с палец.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitBuyAhead, type OrderActionResult } from "@/app/[locale]/exchange/actions";
import { newRequestKey } from "@/lib/request-key";

export type BuyQuote = { zoneId: string; amountKwh: number; estimate: number | null };

export type BuySheetLabels = {
  amount: string;
  limitPrice: string;
  buy: string;
  otherAmount: string;
  noLiquidity: string;
};

export function BuySheet({
  zones,
  defaultZoneId,
  quotes,
  labels,
}: {
  zones: { id: string; code: string; currency: string }[];
  defaultZoneId: string;
  quotes: BuyQuote[];
  labels: BuySheetLabels;
}) {
  const [zoneId, setZoneId] = useState(defaultZoneId);
  const [amount, setAmount] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<OrderActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  // §15 — один ключ на одно намерение, поэтому второе нажатие не купит
  // второй раз.
  const requestKey = useRef(newRequestKey());

  const amountNum = Number(amount.replace(",", "."));
  const limitNum = limitPrice.trim() === "" ? null : Number(limitPrice.replace(",", "."));
  const zone = zones.find((z) => z.id === zoneId);
  const zoneQuotes = quotes.filter((q) => q.zoneId === zoneId);

  function buy(amountKwh: number, limit: number | null) {
    setResult(null);
    startTransition(async () => {
      const r = await submitBuyAhead({
        zoneId,
        amountKwh,
        limitPrice: limit,
        idempotencyKey: requestKey.current,
      });
      setResult(r);
      if (r.ok) {
        requestKey.current = newRequestKey();
        setAmount("");
        router.refresh();
      }
    });
  }

  return (
    <div className="mt-4">
      {/* Зону выбирают только те, у кого кошелёк не один. */}
      {zones.length > 1 && (
        <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
          {zones.map((z) => (
            <button
              key={z.id}
              type="button"
              data-zone-chip={z.code}
              onClick={() => setZoneId(z.id)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-[13px] ${
                z.id === zoneId
                  ? "border-accent text-accent"
                  : "border-hairline text-muted"
              }`}
            >
              {z.code}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2" data-testid="quick-buy">
        {zoneQuotes.map((q) => (
          <button
            key={q.amountKwh}
            type="button"
            disabled={pending || q.estimate == null}
            onClick={() => buy(q.amountKwh, null)}
            data-testid={`quick-buy-${q.amountKwh}`}
            className="rounded-lg border border-hairline bg-card px-2 py-4
                       disabled:opacity-40"
          >
            <span className="num block text-[17px] font-semibold">{q.amountKwh}</span>
            <span className="block text-[11px] text-muted">kWh</span>
            <span className="num mt-1 block text-[11px] text-muted-strong">
              {q.estimate == null
                ? labels.noLiquidity
                : `≈ ${q.estimate.toFixed(2)} ${zone?.currency ?? ""}`}
            </span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="other-amount"
        className="mt-3 w-full rounded-lg border border-hairline py-3 text-[14px] text-muted-strong"
      >
        {labels.otherAmount}
      </button>

      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            buy(amountNum, limitNum);
          }}
          className="mt-3 space-y-3"
        >
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={labels.amount}
            aria-label={labels.amount}
            className="num w-full rounded-lg border border-hairline bg-transparent px-3 py-3"
          />
          <input
            inputMode="decimal"
            value={limitPrice}
            onChange={(e) => setLimitPrice(e.target.value)}
            placeholder={`${labels.limitPrice}${zone ? `, ${zone.currency}/kWh` : ""}`}
            aria-label={labels.limitPrice}
            className="num w-full rounded-lg border border-hairline bg-transparent px-3 py-3"
          />
          <button
            type="submit"
            disabled={pending || !(amountNum > 0)}
            className="w-full rounded-lg bg-accent py-3 font-semibold text-accent-foreground
                       disabled:opacity-40"
          >
            {pending ? "…" : labels.buy}
          </button>
        </form>
      )}

      {result && !result.ok && (
        <p className="mt-3 text-[12px] text-down">{result.formError}</p>
      )}
      {result?.ok && (
        <p
          data-testid="buy-result"
          className={`mt-3 text-[12px] ${result.rejectReason ? "text-down" : "text-up"}`}
        >
          {result.rejectReason ??
            `${result.status} · ${result.filledKwh.toFixed(3)} kWh${
              result.avgPrice != null ? ` @ ${result.avgPrice.toFixed(4)}` : ""
            }`}
        </p>
      )}
    </div>
  );
}
```

- [x] **Шаг 3: проверить типы**

```bash
cd ~/poolwatt && npx tsc --noEmit
```

Ожидается: без ошибок.

- [x] **Шаг 4: коммит**

```bash
git add src/components/mobile/buy-sheet.tsx "src/app/[locale]/exchange/actions.ts"
git commit -m "feat(mobile): buy kWh ahead with thumb-sized targets"
```

---

## Задача 7: лента операций на экране

**Файлы:**
- Создать: `src/components/mobile/history-list.tsx`

- [x] **Шаг 1: написать компонент**

`src/components/mobile/history-list.tsx`:

```tsx
// §22.3 — лента операций и ряд чипов фильтра. Серверный компонент:
// состояние фильтра держит адрес страницы, а не React.

import Link from "next/link";
import { HISTORY_FILTERS, type HistoryFilter } from "@/lib/mobile/history-filter";
import type { WalletHistoryEntry } from "@/lib/exchange/wallet-history";

export function HistoryList({
  entries,
  filter,
  basePath,
  labels,
  receiptPath,
}: {
  entries: WalletHistoryEntry[];
  filter: HistoryFilter;
  /** Куда ведут чипы: `/ru/app/wallet`. */
  basePath: string;
  labels: {
    empty: string;
    chips: Record<HistoryFilter, string>;
    kinds: Record<string, string>;
  };
  /** Как собрать адрес чека из его id. */
  receiptPath: (id: string) => string;
}) {
  return (
    <div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
        {HISTORY_FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "all" ? basePath : `${basePath}?kind=${f}`}
            prefetch={false}
            data-chip={f}
            aria-current={f === filter ? "true" : undefined}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-[13px] ${
              f === filter ? "border-accent text-accent" : "border-hairline text-muted"
            }`}
          >
            {labels.chips[f]}
          </Link>
        ))}
      </div>

      {entries.length === 0 ? (
        <p className="mt-6 text-[14px] text-muted" data-testid="history-empty">
          {labels.empty}
        </p>
      ) : (
        <ul
          className="mt-3 rounded-lg border border-hairline bg-card divide-y divide-hairline"
          data-testid="history-list"
        >
          {entries.map((e) => {
            const row = (
              <div className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <div className="text-[14px]">{labels.kinds[`kind${e.kind}`]}</div>
                  <div className="truncate text-[12px] text-muted">
                    <span className="num">
                      {e.at.toISOString().slice(0, 16).replace("T", " ")}
                    </span>
                    {e.title && ` · ${e.title}`}
                  </div>
                </div>
                <div className="pl-3 text-right">
                  <div
                    className={`num text-[15px] ${e.kwh >= 0 ? "text-up" : "text-down"}`}
                  >
                    {e.kwh >= 0 ? "+" : "−"}
                    {Math.abs(e.kwh).toFixed(3)} kWh
                  </div>
                  {e.fiat !== 0 && (
                    <div className="num text-[12px] text-muted">
                      {e.fiat >= 0 ? "+" : "−"}
                      {Math.abs(e.fiat).toFixed(2)} {e.currency ?? ""}
                    </div>
                  )}
                </div>
              </div>
            );
            return (
              <li key={e.id} data-kind={e.kind}>
                {e.receiptId ? (
                  <Link
                    href={receiptPath(e.receiptId)}
                    prefetch={false}
                    data-receipt={e.receiptId}
                    className="block"
                  >
                    {row}
                  </Link>
                ) : (
                  row
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
```

- [x] **Шаг 2: проверить типы**

```bash
cd ~/poolwatt && npx tsc --noEmit
```

Ожидается: без ошибок.

- [x] **Шаг 3: коммит**

```bash
git add src/components/mobile/history-list.tsx
git commit -m "feat(mobile): the operation history as a list with filter chips"
```

---

## Задача 8: экран кошелька

**Файлы:**
- Изменить: `src/app/[locale]/app/wallet/page.tsx`

- [x] **Шаг 1: заменить заглушку экраном §22.3**

Полное содержимое `src/app/[locale]/app/wallet/page.tsx`:

```tsx
// §22.3 "Кошелёк" — балансы кВт·ч и денег, покупка впрок (US-07), средняя
// цена покупки, подарки §43 отдельным блоком и история операций с
// фильтром. Та же логика, что в кабинете, но в одну колонку и под палец.

import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readWallets } from "@/lib/exchange/wallet-service";
import { quoteMarketOrder } from "@/lib/exchange/order-service";
import { walletChannel } from "@/lib/exchange/realtime";
import { roundMoney } from "@/lib/exchange/precision";
import { readPurchaseStats, readWalletHistory } from "@/lib/exchange/wallet-history";
import { kindsForFilter, parseHistoryFilter, type HistoryFilter } from "@/lib/mobile/history-filter";
import { readMyGifts } from "@/lib/marketing/grant-spend";
import { Screen } from "@/components/mobile/screen";
import { MobileBalance } from "@/components/mobile/mobile-balance";
import { BuySheet } from "@/components/mobile/buy-sheet";
import { HistoryList } from "@/components/mobile/history-list";

export const dynamic = "force-dynamic";

/** §22.3 — суммы, которые покупаются одним нажатием. */
const QUICK_AMOUNTS = [10, 50, 100];

export default async function WalletScreen({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ kind?: string }>;
}) {
  const { locale } = await params;
  const { kind } = await searchParams;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/app/wallet`);
  const userId = session.user.id;

  const t = await getTranslations("app.tabs");
  const tw = await getTranslations("app.wallet");
  const th = await getTranslations("app.history");
  const tHome = await getTranslations("app.home");

  const filter = parseHistoryFilter(kind);

  const [wallets, zones, purchases, gifts, history] = await Promise.all([
    readWallets(userId),
    prisma.gridZone.findMany({ orderBy: { code: "asc" } }),
    readPurchaseStats(userId),
    readMyGifts(userId),
    readWalletHistory(userId, { kinds: kindsForFilter(filter) }),
  ]);

  // Зона по умолчанию — та, где у человека больше всего кВт·ч.
  const primary = wallets.slice().sort((a, b) => b.kwhBalance - a.kwhBalance)[0] ?? null;
  const defaultZone =
    (primary ? zones.find((z) => z.id === primary.zoneId) : undefined) ?? zones[0];

  // US-07 "в один клик" — цена каждой суммы считается по живой книге до
  // того, как человек нажмёт. Зона, в книге которой объёма не хватает,
  // вместо цены говорит «нет в продаже» (§16.7).
  const quotes = defaultZone
    ? await Promise.all(
        zones.flatMap((zone) =>
          QUICK_AMOUNTS.map(async (amountKwh) => {
            const quote = await quoteMarketOrder(zone.id, "BUY", amountKwh);
            return {
              zoneId: zone.id,
              amountKwh,
              estimate: quote.unavailableKwh > 0 ? null : roundMoney(quote.notional),
            };
          }),
        ),
      )
    : [];

  const chips = Object.fromEntries(
    (["all", "buy", "sell", "charge", "transfer", "gift"] as HistoryFilter[]).map((f) => [
      f,
      th(f),
    ]),
  ) as Record<HistoryFilter, string>;

  const kinds = Object.fromEntries(
    ["BUY", "SELL", "CHARGE", "TRANSFER_IN", "TRANSFER_OUT", "GIFT"].map((k) => [
      `kind${k}`,
      th(`kind${k}` as never),
    ]),
  );

  return (
    <Screen title={t("wallet")}>
      <MobileBalance
        initial={wallets}
        channel={walletChannel(userId)}
        detail
        labels={{
          balance: tw("balance"),
          money: tHome("money"),
          reserved: tw("reserved"),
          available: tw("available"),
          live: tw("live"),
          offline: tw("offline"),
          empty: tw("noWallet"),
        }}
      />

      <section className="mt-8">
        <h2 className="text-[12px] uppercase tracking-[0.16em] text-muted">
          {tw("buyAhead")}
        </h2>
        <p className="mt-1 text-[12px] text-muted">{tw("buyAheadHelp")}</p>
        {defaultZone && (
          <BuySheet
            zones={zones.map((z) => ({ id: z.id, code: z.code, currency: z.currency }))}
            defaultZoneId={defaultZone.id}
            quotes={quotes}
            labels={{
              amount: tw("amount"),
              limitPrice: tw("limitPrice"),
              buy: tw("buy"),
              otherAmount: tw("otherAmount"),
              noLiquidity: tw("noLiquidity"),
            }}
          />
        )}
      </section>

      <section className="mt-8 rounded-lg border border-hairline bg-card px-4 py-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] text-muted">{tw("avgPrice")}</span>
          <span className="num text-[15px]" data-testid="avg-price">
            {purchases.avgPrice == null ? "—" : purchases.avgPrice.toFixed(4)}
          </span>
        </div>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-[13px] text-muted">{tw("boughtKwh")}</span>
          <span className="num text-[15px]">{purchases.boughtKwh.toFixed(3)} kWh</span>
        </div>
      </section>

      {/* §43 "в приложении показывается отдельно от основного баланса". */}
      {gifts.length > 0 && (
        <section className="mt-8" data-testid="wallet-gifts">
          <h2 className="text-[12px] uppercase tracking-[0.16em] text-muted">
            {tw("gifts")}
          </h2>
          <p className="mt-1 text-[12px] text-muted">{tw("giftsHelp")}</p>
          <ul className="mt-3 rounded-lg border border-hairline bg-card divide-y divide-hairline">
            {gifts.map((g) => (
              <li key={g.id} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-[14px]">{g.networkName}</div>
                  <div className="text-[12px] text-muted">
                    {tw("giftUntil")}{" "}
                    <span className="num">{g.expiresAt.toISOString().slice(0, 10)}</span>
                    {g.kind === "cashback" && ` · ${tw("giftCashback")}`}
                  </div>
                </div>
                <div className="num pl-3 text-[15px] text-accent">
                  {g.remainingKwh.toFixed(3)} kWh
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-[12px] uppercase tracking-[0.16em] text-muted">
          {th("title")}
        </h2>
        <HistoryList
          entries={history}
          filter={filter}
          basePath={`/${locale}/app/wallet`}
          receiptPath={(id) => `/${locale}/app/wallet/receipts/${id}`}
          labels={{ empty: th("empty"), chips, kinds }}
        />
      </section>
    </Screen>
  );
}
```

- [x] **Шаг 2: проверить типы**

```bash
cd ~/poolwatt && npx tsc --noEmit
```

Ожидается: без ошибок.

- [x] **Шаг 3: коммит**

```bash
git add "src/app/[locale]/app/wallet/page.tsx"
git commit -m "feat(mobile): the wallet screen of §22.3"
```

---

## Задача 9: чек в телефоне

**Файлы:**
- Создать: `src/app/[locale]/app/wallet/receipts/[id]/page.tsx`

- [x] **Шаг 1: написать страницу**

```tsx
// §46 — тот же документ, что в кабинете, в одну колонку. Своего
// построителя чека здесь нет сознательно: иначе через месяц в кабинете и
// в телефоне будут два разных чека на одну сделку.

import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { readReceiptForUser } from "@/lib/exchange/payment-service";
import { buildReceiptDocument } from "@/lib/receipts/receipt-document";
import { ReceiptSheet } from "@/components/receipts/receipt-sheet";
import { Screen } from "@/components/mobile/screen";

export const dynamic = "force-dynamic";

export default async function MobileReceiptScreen({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/app/wallet/receipts/${id}`);
  }

  // Доступ раньше состава: документ §46 тянет реквизиты сети, и ничего из
  // этого не должно утечь в чужой чек.
  const allowed = await readReceiptForUser(id, session.user.id, session.user.role === "ADMIN");
  if (!allowed) notFound();

  const doc = await buildReceiptDocument(id);
  if (!doc) notFound();

  const t = await getTranslations("app.wallet");

  return (
    <Screen title={t("receipt")} back={`/${locale}/app/wallet`}>
      <div data-testid="mobile-receipt" className="mt-2">
        <ReceiptSheet doc={doc} />
      </div>
    </Screen>
  );
}
```

- [x] **Шаг 2: проверить типы**

```bash
cd ~/poolwatt && npx tsc --noEmit
```

Ожидается: без ошибок.

- [x] **Шаг 3: коммит**

```bash
git add "src/app/[locale]/app/wallet/receipts/[id]/page.tsx"
git commit -m "feat(mobile): a receipt opens inside the app"
```

---

## Задача 10: e2e на Pixel 7

**Файлы:**
- Создать: `tests/e2e/mobile-wallet.mobile.spec.ts`

- [x] **Шаг 1: написать тест**

```ts
// M2 — кошелёк в телефоне так, как его встречает человек: баланс, который
// обновляется сам, покупка впрок в один клик, лента с фильтром, чек,
// который открывается, и чужой чек, которого нет.

import { test, expect } from "@playwright/test";
import { signInWithPassword } from "./login";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const USER = { username: "e2e_mobile_wallet", password: "Pass1234" };
const OTHER = { username: "e2e_mobile_wallet_other", password: "Pass1234" };

let strangerReceiptId: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await prisma.user.deleteMany({ where: { username: { in: [USER.username, OTHER.username] } } });

  const me = await prisma.user.create({
    data: { username: USER.username, passwordHash: await bcrypt.hash(USER.password, 10) },
  });
  const other = await prisma.user.create({
    data: { username: OTHER.username, passwordHash: await bcrypt.hash(OTHER.password, 10) },
  });

  const zone = await prisma.gridZone.findFirstOrThrow({ orderBy: { code: "asc" } });

  // Мой кошелёк с деньгами — чтобы покупка впрок прошла.
  await prisma.wallet.create({
    data: {
      ownerUserId: me.id,
      zoneId: zone.id,
      currency: zone.currency,
      fiatBalance: new Prisma.Decimal(500),
    },
  });

  // Чужой чек: зарядка незнакомца со своим кошельком.
  const otherWallet = await prisma.wallet.create({
    data: { ownerUserId: other.id, zoneId: zone.id, currency: zone.currency },
  });
  const payment = await prisma.payment.create({
    data: {
      walletId: otherWallet.id,
      zoneId: zone.id,
      requestedKwh: new Prisma.Decimal(7),
      kwhFromBalance: new Prisma.Decimal(7),
      amountFiat: new Prisma.Decimal(2.1),
      status: "CAPTURED",
      capturedAt: new Date(),
    },
  });
  const receipt = await prisma.receipt.create({
    data: {
      paymentId: payment.id,
      totalKwh: new Prisma.Decimal(7),
      totalFiat: new Prisma.Decimal(2.1),
      currency: zone.currency,
    },
  });
  strangerReceiptId = receipt.id;
});

test.afterAll(async () => {
  const users = await prisma.user.findMany({
    where: { username: { in: [USER.username, OTHER.username] } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  const wallets = await prisma.wallet.findMany({
    where: { ownerUserId: { in: ids } },
    select: { id: true },
  });
  const walletIds = wallets.map((w) => w.id);
  await prisma.receipt.deleteMany({
    where: {
      OR: [
        { payment: { walletId: { in: walletIds } } },
        { trade: { buyOrder: { walletId: { in: walletIds } } } },
      ],
    },
  });
  await prisma.trade.deleteMany({
    where: {
      OR: [
        { buyOrder: { walletId: { in: walletIds } } },
        { sellOrder: { walletId: { in: walletIds } } },
      ],
    },
  });
  await prisma.payment.deleteMany({ where: { walletId: { in: walletIds } } });
  await prisma.order.deleteMany({ where: { walletId: { in: walletIds } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test("the wallet screen shows a balance and says whether it is live", async ({ page }) => {
  await signInWithPassword(page, USER, "ru");
  await page.goto("/ru/app/wallet");
  await expect(page.getByTestId("kwh-balance")).toBeVisible();
  await expect(page.getByTestId("fiat-balance")).toBeVisible();
  await expect(page.getByTestId("balance-live-state")).toBeVisible();
});

test("one click buys kWh ahead and the balance moves", async ({ page }) => {
  await signInWithPassword(page, USER, "ru");
  await page.goto("/ru/app/wallet");

  const before = Number((await page.getByTestId("kwh-balance").innerText()).split(/\s+/)[0]);
  const button = page.getByTestId("quick-buy-10");
  await expect(button).toBeVisible();

  // Книга может быть пуста на тестовом стенде: тогда кнопка честно
  // недоступна, и это тоже заявленное поведение §16.7.
  if (await button.isDisabled()) {
    await expect(button).toContainText("Нет в продаже");
    return;
  }

  await button.click();
  await expect(page.getByTestId("buy-result")).toBeVisible();
  await expect
    .poll(async () =>
      Number((await page.getByTestId("kwh-balance").innerText()).split(/\s+/)[0]),
    )
    .toBeGreaterThan(before);

  // Покупка попала в ленту и её чек открывается.
  await page.goto("/ru/app/wallet?kind=buy");
  await expect(page.locator("[data-kind=BUY]").first()).toBeVisible();
});

test("the filter narrows the history to one kind", async ({ page }) => {
  await signInWithPassword(page, USER, "ru");
  await page.goto("/ru/app/wallet?kind=charge");
  await expect(page.locator("[data-chip=charge][aria-current=true]")).toBeVisible();
  await expect(page.locator("[data-kind=BUY]")).toHaveCount(0);
});

test("rubbish in the filter shows everything instead of breaking", async ({ page }) => {
  await signInWithPassword(page, USER, "ru");
  await page.goto("/ru/app/wallet?kind=../etc/passwd");
  await expect(page.locator("[data-chip=all][aria-current=true]")).toBeVisible();
});

test("somebody else's receipt does not exist here", async ({ page }) => {
  await signInWithPassword(page, USER, "ru");
  const response = await page.goto(`/ru/app/wallet/receipts/${strangerReceiptId}`);
  expect(response?.status()).toBe(404);
});
```

- [x] **Шаг 2: собрать и перезапустить веб-процесс**

Страницы Next.js подаются из собранного `.next/`, поэтому без сборки
e2e будет гонять старый код (`CLAUDE.md`, «Common ops»).

```bash
cd ~/poolwatt && npm run build && pm2 restart poolwatt-web
```

Ожидается: сборка без ошибок, процесс `online`.

- [x] **Шаг 3: запустить e2e**

```bash
cd ~/poolwatt && npx playwright test tests/e2e/mobile-wallet.mobile.spec.ts --project=mobile
```

Ожидается: 5 passed.

- [x] **Шаг 4: коммит**

```bash
git add tests/e2e/mobile-wallet.mobile.spec.ts
git commit -m "test(mobile): e2e for the phone wallet on a Pixel 7"
```

---

## Задача 11: весь набор тестов и сборка APK

- [x] **Шаг 1: весь vitest**

```bash
cd ~/poolwatt
NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local \
  | tr -d '"' | sed 's|/poolwatt?|/poolwatt_test?|')" npx vitest run
```

Ожидается: всё зелёное, кроме двух случаев `bot/__tests__/tts-bilingual.test.ts`,
если нет `OPENAI_API_KEY`.

- [x] **Шаг 2: весь playwright**

```bash
cd ~/poolwatt && npm run test:e2e
```

Ожидается: всё зелёное.

- [x] **Шаг 3: собрать APK, чтобы владелец мог посмотреть**

```bash
/home/dv/bin/android-build
```

Ожидается: адреса `poolwatt.com/downloads/poolwatt.apk` и
`poolwatt-build-<N>.apk`.

- [x] **Шаг 4: обновить реестр**

В `inbox/TZ-STATUS.md`: этап M2 — «готово 2026-11-26» с доказательством
(коммиты, адреса, номер сборки APK), US-17 переносится в раздел
«Готово», US-07 остаётся «частично (ждёт владельца)» — пополнение
денежного баланса по-прежнему ждёт EMI.

- [x] **Шаг 5: коммит**

```bash
git add docs/superpowers/specs/2026-11-26-mobile-home-and-wallet-design.md \
        docs/superpowers/plans/2026-11-26-mobile-home-and-wallet.md
git commit -m "docs(mobile): spec and plan for M2"
```

---

## Где работа отошла от плана

- **Пустое состояние баланса.** План отдавал `MobileBalance` раннее
  возвращение «кошелька нет» вместо цифры. Это сломало e2e этапа M1: человек
  без кошелька терял крупную цифру §22.2. Ноль — настоящий баланс, поэтому
  цифра осталась всегда, а пустое состояние переехало в разбивку по зонам
  (коммит 1d25a84).
- **Метки `MobileBalance`.** Поля `balance` в метках не оказалось: строку
  состояния канала компонент печатает сам, а подпись «Баланс кВт·ч» на
  главном экране стала лишней рядом с живой строкой. Ключ `app.home.balance`
  остался в переводах неиспользованным.
- **e2e завела свою зону.** В плане тест опирался на первую зону базы, и
  книга в ней оказалась пуста: кнопка честно гасла, и проверка US-07 ничего
  не проверяла. Тест теперь создаёт зону, партию энергии и стоящую заявку на
  продажу — как это делает `tests/e2e/buy-ahead.spec.ts` — и покупает
  по-настоящему. Плюс идёт через `https://poolwatt.com`, иначе канал §15 не
  поднимается (апгрейд отдаёт только nginx). Тестов стало семь вместо пяти.
- **Проверка `readPurchaseStats` без покупок.** В плане она читалась у
  «друга», но друг по сюжету купил 4 кВт·ч на другой стороне моей продажи.
  Добавлен третий человек без единой операции.
