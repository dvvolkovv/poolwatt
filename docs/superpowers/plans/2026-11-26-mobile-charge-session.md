# M3-а — зарядка по QR в телефоне: план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** US-20 закрыта: водитель сканирует QR разъёма, видит разбивку §16.6
до подтверждения, начинает зарядку, видит её ход в живом канале, завершает и
получает чек §46 в истории кошелька. Бронь §32.5 закрывается этой же зарядкой.

**Architecture:** новая таблица `ChargeSession` и её тики превращают разовое
`chargeSession()` в сеанс с двумя моментами §16.6 — авторизация с запасом Y %
в начале и расчёт по факту в конце. Оборудование отчитывается о выданных
кВт·ч ключом пункта и подписью HMAC (тот же путь, что занятость разъёмов);
команды станции по OCPP — за закрытым гейтом `ocppOpen`. События сеанса идут
в существующий канал `wallet.{userId}`.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma, next-intl v4,
`jsqr` (чтение QR в браузере, без нативного плагина), Vitest, Playwright
(проект `mobile`, Pixel 7).

Спецификация: `docs/superpowers/specs/2026-11-26-mobile-charge-session-design.md`.

**Как запускать тесты в этом репозитории** (из `CLAUDE.md`, иначе тесты
уйдут в живую базу и упадут на гейтах):

```bash
cd ~/poolwatt
NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local \
  | tr -d '"' | sed 's|/poolwatt?|/poolwatt_test?|')" npx vitest run <путь>
```

Миграции и сев той же базы:

```bash
cd ~/poolwatt
DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local | tr -d '"' \
  | sed 's|/poolwatt?|/poolwatt_test?|')" npx prisma migrate deploy
```

---

## Структура файлов

| Файл | Ответственность |
| --- | --- |
| `prisma/schema.prisma` | изменить: `ChargeSession`, `ChargeSessionTick`, `ChargeSessionStatus`, обратные связи |
| `src/lib/exchange/qr-code.ts` | создать: разбор и сборка кода разъёма (чистые функции) |
| `src/lib/exchange/qr-code.test.ts` | создать: юнит-тесты разбора |
| `src/lib/exchange/gates.ts` | изменить: `ocppOpen` / `assertOcppOpen` |
| `src/lib/exchange/charge-session.ts` | создать: авторизация, отчёт счётчика, расчёт, истечение, чтение живого сеанса |
| `src/lib/exchange/charge-session.test.ts` | создать: интеграционные тесты сеанса |
| `src/lib/exchange/charge-session-flow.test.ts` | создать: одновременность — два старта, два завершения, два водителя |
| `src/lib/exchange/realtime-notify.ts` | изменить: `notifyChargeSession` |
| `src/app/api/v1/charge-sessions/route.ts` | создать: `POST` старт с `Idempotency-Key` |
| `src/app/api/v1/charge-sessions/me/active/route.ts` | создать: `GET` живой сеанс |
| `src/app/api/v1/charge-sessions/[id]/meter/route.ts` | создать: `POST` отчёт оборудования (HMAC) |
| `src/app/api/v1/charge-sessions/[id]/stop/route.ts` | создать: `POST` завершение |
| `src/app/api/v1/points/resolve/route.ts` | создать: `GET` что зашито в QR |
| `src/app/[locale]/app/charge/page.tsx` | изменить: вкладка «Зарядка» вместо заглушки |
| `src/app/[locale]/app/charge/actions.ts` | создать: серверные действия старта и завершения |
| `src/app/[locale]/app/charge/start/page.tsx` | создать: расчёт до подтверждения |
| `src/components/mobile/qr-scan.tsx` | создать: камера + `jsqr` + ручной ввод |
| `src/components/mobile/charge-live.tsx` | создать: ход зарядки на канале §15 |
| `src/components/mobile/nearby-points.tsx` | создать: ближайшие пункты по геолокации |
| `src/app/[locale]/me/charger-operator/[id]/points/[pointId]/qr/page.tsx` | создать: печать QR по разъёмам |
| `worker/index.ts` | изменить: сметать истёкшие сеансы раз в минуту |
| `messages/{en,ru,sk}.json` | изменить: раздел `app.charge` |
| `tests/e2e/mobile-charge.mobile.spec.ts` | создать: e2e на Pixel 7 |

---

## Task 1: Схема — сеанс зарядки и его тики

**Files:**
- Modify: `prisma/schema.prisma`

- [x] **Step 1: Добавить перечисление и две модели**

В `prisma/schema.prisma`, рядом с `Payment`, добавить:

```prisma
// §16.6 — у зарядки два момента: «сумма авторизуется с запасом Y %» в начале
// и «списывается по факту» в конце. Между ними живёт сеанс, ход которого
// водитель видит на экране (§22.9, US-20).
enum ChargeSessionStatus {
  AUTHORIZED
  ACTIVE
  COMPLETED
  CANCELLED
  EXPIRED
  FAILED
}

model ChargeSession {
  id            String              @id @default(cuid())
  userId        String
  user          User                @relation("ChargeSessionDriver", fields: [userId], references: [id], onDelete: Cascade)
  walletId      String
  wallet        Wallet              @relation(fields: [walletId], references: [id], onDelete: Cascade)
  zoneId        String
  zone          GridZone            @relation(fields: [zoneId], references: [id])
  pointId       String
  point         AcceptancePoint     @relation(fields: [pointId], references: [id], onDelete: Cascade)
  connectorId   String
  connector     PointConnector      @relation(fields: [connectorId], references: [id], onDelete: Cascade)
  // §32.5 — бронь, которую закрыл этот сеанс.
  reservationId String?             @unique
  reservation   Reservation?        @relation(fields: [reservationId], references: [id], onDelete: SetNull)

  status      ChargeSessionStatus @default(AUTHORIZED)
  plannedKwh  Decimal             @db.Decimal(18, 3)
  deliveredKwh Decimal            @default(0) @db.Decimal(18, 3)
  // Резерв под сеанс: тот же механизм, что держит средства под заявкой.
  authorizedFiat Decimal          @default(0) @db.Decimal(18, 2)
  currency       String           @default("EUR")
  // Снимок ChargePlan на момент согласия водителя — чтобы спор «мне считали
  // другое» разбирался по тому, что он видел.
  quote          Json             @default("{}")
  tariffVersion  Int?

  paymentId      String?  @unique
  payment        Payment? @relation(fields: [paymentId], references: [id], onDelete: SetNull)
  idempotencyKey String?  @unique

  createdAt   DateTime  @default(now())
  startedAt   DateTime?
  lastMeterAt DateTime?
  endedAt     DateTime?
  closeReason String?

  ticks ChargeSessionTick[]

  @@index([userId, status])
  @@index([connectorId, status])
  @@index([status, lastMeterAt])
}

// Ход зарядки и доказательство в споре «списали больше, чем я взял».
model ChargeSessionTick {
  id        String        @id @default(cuid())
  sessionId String
  session   ChargeSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  at        DateTime      @default(now())
  kwhTotal  Decimal       @db.Decimal(18, 3)
  powerKw   Decimal?      @db.Decimal(8, 2)

  @@index([sessionId, at])
}
```

- [x] **Step 2: Добавить обратные связи**

В `model User` добавить строку:

```prisma
  chargeSessions ChargeSession[] @relation("ChargeSessionDriver")
```

В `model Wallet` добавить:

```prisma
  chargeSessions ChargeSession[]
```

В `model GridZone` добавить:

```prisma
  chargeSessions ChargeSession[]
```

В `model AcceptancePoint` добавить:

```prisma
  chargeSessions ChargeSession[]
```

В `model PointConnector` добавить:

```prisma
  chargeSessions ChargeSession[]
```

В `model Reservation` добавить:

```prisma
  chargeSession ChargeSession?
```

В `model Payment` добавить:

```prisma
  chargeSession ChargeSession?
```

- [x] **Step 3: Создать миграцию**

```bash
cd ~/poolwatt
DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local | tr -d '"' \
  | sed 's|/poolwatt?|/poolwatt_test?|')" \
  npx prisma migrate dev --name charge_session --create-only
```

Ожидание: появился каталог `prisma/migrations/<дата>_charge_session/`.

- [x] **Step 4: Применить к обеим базам и собрать клиент**

```bash
cd ~/poolwatt
DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local | tr -d '"' \
  | sed 's|/poolwatt?|/poolwatt_test?|')" npx prisma migrate deploy
npx prisma migrate deploy
npx prisma generate
```

Ожидание: `All migrations have been successfully applied` дважды.

- [x] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(charge): a charging session is a state, not one call"
```

---

## Task 2: Разбор кода QR

**Files:**
- Create: `src/lib/exchange/qr-code.ts`
- Test: `src/lib/exchange/qr-code.test.ts`

- [x] **Step 1: Написать падающий тест**

`src/lib/exchange/qr-code.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildConnectorCode, parseConnectorCode } from "./qr-code";

describe("parseConnectorCode", () => {
  it("reads the compact form", () => {
    expect(parseConnectorCode("PW1:point123:conn456")).toEqual({
      pointId: "point123",
      connectorId: "conn456",
    });
  });

  it("reads a point without a connector", () => {
    expect(parseConnectorCode("PW1:point123")).toEqual({
      pointId: "point123",
      connectorId: null,
    });
  });

  it("reads the address form a camera sees on a printed sticker", () => {
    expect(
      parseConnectorCode("https://poolwatt.com/ru/app/charge/start?p=point123&c=conn456"),
    ).toEqual({ pointId: "point123", connectorId: "conn456" });
  });

  it("ignores case and spaces around the code", () => {
    expect(parseConnectorCode("  pw1:point123:conn456  ")).toEqual({
      pointId: "point123",
      connectorId: "conn456",
    });
  });

  it("refuses a code of somebody else's network", () => {
    expect(parseConnectorCode("https://example.com/charge/42")).toBeNull();
    expect(parseConnectorCode("OCPI:FR*ABC*E1234")).toBeNull();
    expect(parseConnectorCode("")).toBeNull();
  });

  it("refuses identifiers that cannot be ours", () => {
    expect(parseConnectorCode("PW1:no spaces allowed")).toBeNull();
    expect(parseConnectorCode(`PW1:${"x".repeat(41)}`)).toBeNull();
  });

  it("builds what it can read", () => {
    const code = buildConnectorCode("point123", "conn456");
    expect(code).toBe("PW1:point123:conn456");
    expect(parseConnectorCode(code)).toEqual({
      pointId: "point123",
      connectorId: "conn456",
    });
  });
});
```

- [x] **Step 2: Запустить и убедиться, что падает**

```bash
cd ~/poolwatt
NODE_ENV=test npx vitest run src/lib/exchange/qr-code.test.ts
```

Ожидание: FAIL, `Failed to resolve import "./qr-code"`.

- [x] **Step 3: Реализовать**

`src/lib/exchange/qr-code.ts`:

```ts
// Что зашито в QR на разъёме — §22.9, US-20 «старт по QR».
//
// Два вида кода, потому что наклейку печатаем мы, а камеру держит кто угодно:
// компактный `PW1:<pointId>:<connectorId>` и обычный адрес с теми же `p` и
// `c`. Чужой код не угадывается: водителю честно говорят, что это не наш QR,
// а не ведут на пустой расчёт.

export interface ConnectorCode {
  pointId: string;
  connectorId: string | null;
}

/** cuid — буквы, цифры, дефис и подчёркивание; длиннее 40 у нас не бывает. */
const ID = /^[A-Za-z0-9_-]{1,40}$/;

export const CODE_PREFIX = "PW1";

export function buildConnectorCode(pointId: string, connectorId?: string | null): string {
  return connectorId
    ? `${CODE_PREFIX}:${pointId}:${connectorId}`
    : `${CODE_PREFIX}:${pointId}`;
}

export function parseConnectorCode(raw: string | null | undefined): ConnectorCode | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  if (text.toUpperCase().startsWith(`${CODE_PREFIX}:`)) {
    const [, pointId, connectorId] = text.split(":");
    return valid(pointId, connectorId ?? null);
  }

  // Адрес: берём только `p` и `c`, путь не проверяем — наклейки печатались
  // под разные локали, и ломать старую наклейку из-за `/ru/` нельзя.
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return valid(url.searchParams.get("p"), url.searchParams.get("c"));
  } catch {
    return null;
  }
}

function valid(pointId: string | null, connectorId: string | null): ConnectorCode | null {
  if (!pointId || !ID.test(pointId)) return null;
  if (connectorId && !ID.test(connectorId)) return null;
  return { pointId, connectorId: connectorId || null };
}
```

- [x] **Step 4: Запустить тесты**

```bash
cd ~/poolwatt
NODE_ENV=test npx vitest run src/lib/exchange/qr-code.test.ts
```

Ожидание: 7 passed.

- [x] **Step 5: Commit**

```bash
git add src/lib/exchange/qr-code.ts src/lib/exchange/qr-code.test.ts
git commit -m "feat(charge): read the QR on a connector, refuse a stranger's"
```

---

## Task 3: Гейт OCPP

**Files:**
- Modify: `src/lib/exchange/gates.ts`
- Test: `src/lib/exchange/gates.test.ts`

- [x] **Step 1: Написать падающий тест**

Добавить в конец `src/lib/exchange/gates.test.ts`:

```ts
describe("ocppOpen", () => {
  it("is shut without a bridge", () => {
    expect(ocppOpen({})).toBe(false);
    expect(ocppOpen({ OCPP_BRIDGE_URL: "   " })).toBe(false);
  });

  it("opens once a bridge is configured", () => {
    expect(ocppOpen({ OCPP_BRIDGE_URL: "https://ocpp.example/v1" })).toBe(true);
  });

  it("assert throws while it is shut", () => {
    expect(() => assertOcppOpen({})).toThrow(FeatureClosedError);
  });
});
```

В начале файла добавить `ocppOpen` и `assertOcppOpen` в существующий импорт
из `./gates`.

- [x] **Step 2: Запустить и убедиться, что падает**

```bash
cd ~/poolwatt
NODE_ENV=test npx vitest run src/lib/exchange/gates.test.ts
```

Ожидание: FAIL, `ocppOpen is not a function`.

- [x] **Step 3: Реализовать**

В конец `src/lib/exchange/gates.ts`:

```ts
/**
 * §34 "Станция получает бронь через OCPP (ReserveNow / CancelReservation)",
 * §51 "поддержка отправляет команду через OCPP", US-20 старт по QR.
 *
 * Командовать чужой станцией можно только через мост к сети зарядок, и его
 * нет (вопрос владельцу открыт). Закрыто означает: оборудование отчитывается
 * само — о занятости разъёмов и о выданных кВт·ч, — а мы не делаем вид, что
 * нажали кнопку на станции. Никогда не означает «зарядку нельзя оплатить».
 */
export function ocppOpen(env: Env = process.env): boolean {
  return Boolean(env.OCPP_BRIDGE_URL?.trim());
}

export function assertOcppOpen(): void {
  if (!ocppOpen()) {
    throw new FeatureClosedError("There is no bridge to a charging network yet");
  }
}
```

`assertOcppOpen` в тесте вызывается с аргументом, поэтому подпись принимает
окружение:

```ts
export function assertOcppOpen(env: Env = process.env): void {
  if (!ocppOpen(env)) {
    throw new FeatureClosedError("There is no bridge to a charging network yet");
  }
}
```

- [x] **Step 4: Запустить тесты**

```bash
cd ~/poolwatt
NODE_ENV=test npx vitest run src/lib/exchange/gates.test.ts
```

Ожидание: все passed, включая три новых.

- [x] **Step 5: Commit**

```bash
git add src/lib/exchange/gates.ts src/lib/exchange/gates.test.ts
git commit -m "feat(charge): the OCPP bridge is a gate, shut by default"
```

---

## Task 4: Авторизация сеанса

**Files:**
- Create: `src/lib/exchange/charge-session.ts`
- Test: `src/lib/exchange/charge-session.test.ts`

Образец для тестов с базой — `src/lib/exchange/charge-point.test.ts`: там уже
есть сев пункта, разъёма, кошелька и партий. Переиспользовать его помощники,
скопировав их в новый файл (фикстуры живут в
`src/lib/exchange/__fixtures__/`).

- [x] **Step 1: Написать падающий тест на авторизацию**

`src/lib/exchange/charge-session.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { ConnectorStatus, PointStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorizeSession, ChargeSessionError, readActiveSession } from "./charge-session";
import { seedChargePoint } from "./__fixtures__/charge-point";

describe("authorizeSession", () => {
  let fx: Awaited<ReturnType<typeof seedChargePoint>>;

  beforeEach(async () => {
    fx = await seedChargePoint({ kwhBalance: 30, fiatBalance: 50 });
  });

  it("holds the connector and the money, and records what the driver saw", async () => {
    const session = await authorizeSession({
      userId: fx.userId,
      pointId: fx.pointId,
      connectorId: fx.connectorId,
      plannedKwh: 10,
      idempotencyKey: `test-${Date.now()}`,
    });

    expect(session.status).toBe("AUTHORIZED");
    expect(session.plannedKwh).toBe(10);
    // 10 кВт·ч при балансе 30 полностью покрыты балансом: денег не держим.
    expect(session.authorizedFiat).toBe(0);
    expect(session.quote.kwhFromBalance).toBe(10);

    const connector = await prisma.pointConnector.findUniqueOrThrow({
      where: { id: fx.connectorId },
    });
    expect(connector.status).toBe(ConnectorStatus.BUSY);

    const active = await readActiveSession(fx.userId);
    expect(active?.id).toBe(session.id);
  });

  it("reserves money with the §16.6 buffer when the book has to be asked", async () => {
    await prisma.wallet.update({
      where: { id: fx.walletId },
      data: { kwhBalance: 0 },
    });

    const session = await authorizeSession({
      userId: fx.userId,
      pointId: fx.pointId,
      connectorId: fx.connectorId,
      plannedKwh: 5,
      idempotencyKey: `test-${Date.now()}`,
    });

    expect(session.authorizedFiat).toBeGreaterThan(0);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: fx.walletId } });
    expect(Number(wallet.reservedFiat)).toBeCloseTo(session.authorizedFiat, 2);
  });

  it("refuses a second live session for the same driver", async () => {
    await authorizeSession({
      userId: fx.userId,
      pointId: fx.pointId,
      connectorId: fx.connectorId,
      plannedKwh: 4,
      idempotencyKey: `test-a-${Date.now()}`,
    });

    await expect(
      authorizeSession({
        userId: fx.userId,
        pointId: fx.pointId,
        connectorId: fx.secondConnectorId,
        plannedKwh: 4,
        idempotencyKey: `test-b-${Date.now()}`,
      }),
    ).rejects.toThrow(ChargeSessionError);
  });

  it("refuses a connector somebody else is using", async () => {
    await prisma.pointConnector.update({
      where: { id: fx.connectorId },
      data: { status: ConnectorStatus.BUSY },
    });

    await expect(
      authorizeSession({
        userId: fx.userId,
        pointId: fx.pointId,
        connectorId: fx.connectorId,
        plannedKwh: 4,
        idempotencyKey: `test-${Date.now()}`,
      }),
    ).rejects.toThrow(/busy/i);
  });

  it("refuses a point that is not published", async () => {
    await prisma.acceptancePoint.update({
      where: { id: fx.pointId },
      data: { status: PointStatus.SUSPENDED },
    });

    await expect(
      authorizeSession({
        userId: fx.userId,
        pointId: fx.pointId,
        connectorId: fx.connectorId,
        plannedKwh: 4,
        idempotencyKey: `test-${Date.now()}`,
      }),
    ).rejects.toThrow(/not open/i);
  });

  it("returns the same session for a repeated key", async () => {
    const key = `test-same-${Date.now()}`;
    const first = await authorizeSession({
      userId: fx.userId,
      pointId: fx.pointId,
      connectorId: fx.connectorId,
      plannedKwh: 6,
      idempotencyKey: key,
    });
    const again = await authorizeSession({
      userId: fx.userId,
      pointId: fx.pointId,
      connectorId: fx.connectorId,
      plannedKwh: 6,
      idempotencyKey: key,
    });
    expect(again.id).toBe(first.id);
    expect(again.idempotentReplay).toBe(true);
  });
});
```

- [x] **Step 2: Написать фикстуру**

`src/lib/exchange/__fixtures__/charge-point.ts` — посмотреть, что уже есть в
каталоге, и дописать функцию, если её нет:

```ts
import { ConnectorStatus, EvConnectorType, PointStatus, PointType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { mintFromReading } from "../minting";

export interface ChargePointFixture {
  userId: string;
  walletId: string;
  zoneId: string;
  pointId: string;
  connectorId: string;
  secondConnectorId: string;
  operatorId: string;
  cleanup: () => Promise<void>;
}

/**
 * Пункт с двумя разъёмами, водитель с кошельком и партиями в зоне пункта.
 * Всё, что создано, удаляется в `cleanup`, чтобы прогон не оставлял мусора.
 */
export async function seedChargePoint(opts: {
  kwhBalance?: number;
  fiatBalance?: number;
}): Promise<ChargePointFixture> {
  const stamp = `cs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const zone = await prisma.gridZone.upsert({
    where: { code: "CSTEST" },
    update: {},
    create: { code: "CSTEST", name: "Charge session test", currency: "EUR", country: "SK" },
  });

  const user = await prisma.user.create({
    data: { email: `${stamp}@example.test`, nickname: stamp, name: stamp },
  });

  const wallet = await prisma.wallet.create({
    data: {
      ownerUserId: user.id,
      zoneId: zone.id,
      kwhBalance: opts.kwhBalance ?? 0,
      fiatBalance: opts.fiatBalance ?? 0,
      currency: "EUR",
    },
  });

  const operator = await prisma.chargerOperator.create({
    data: { slug: stamp, displayName: `Operator ${stamp}`, aliases: [] },
  });

  const point = await prisma.acceptancePoint.create({
    data: {
      operatorId: operator.id,
      type: PointType.CHARGING_STATION,
      name: `Point ${stamp}`,
      status: PointStatus.PUBLISHED,
      gridZoneId: zone.id,
      latitude: 48.15,
      longitude: 17.1,
      country: "SK",
      city: "Bratislava",
      open24: true,
      paymentMethods: ["TOKEN"],
      amenities: [],
      publishedAt: new Date(),
    },
  });

  const connector = await prisma.pointConnector.create({
    data: {
      pointId: point.id,
      type: EvConnectorType.CCS2,
      powerKw: 50,
      quantity: 1,
      status: ConnectorStatus.FREE,
    },
  });

  const second = await prisma.pointConnector.create({
    data: {
      pointId: point.id,
      type: EvConnectorType.Type2,
      powerKw: 22,
      quantity: 1,
      status: ConnectorStatus.FREE,
    },
  });

  await prisma.pointTariff.create({
    data: { pointId: point.id, priceFiat: 0.3, priceTokens: 1, currency: "EUR" },
  });

  return {
    userId: user.id,
    walletId: wallet.id,
    zoneId: zone.id,
    pointId: point.id,
    connectorId: connector.id,
    secondConnectorId: second.id,
    operatorId: operator.id,
    cleanup: async () => {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
      await prisma.acceptancePoint.delete({ where: { id: point.id } }).catch(() => {});
      await prisma.chargerOperator.delete({ where: { id: operator.id } }).catch(() => {});
    },
  };
}
```

Перед написанием сверить имена полей `EvConnectorType` с
`prisma/schema.prisma` (`Type2` там записан как `TYPE2` или `Type2` —
использовать то, что в файле) и наличие обязательных полей у `ChargerOperator`
и `User`.

- [x] **Step 3: Запустить и убедиться, что падает**

```bash
cd ~/poolwatt
NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local \
  | tr -d '"' | sed 's|/poolwatt?|/poolwatt_test?|')" \
  npx vitest run src/lib/exchange/charge-session.test.ts
```

Ожидание: FAIL, `Failed to resolve import "./charge-session"`.

- [x] **Step 4: Реализовать авторизацию**

`src/lib/exchange/charge-session.ts` — первая часть файла:

```ts
// Сеанс зарядки — §16.6, §22.9, US-20.
//
// Два момента §16.6 и между ними зарядка. Авторизация держит разъём и деньги
// с запасом Y %; расчёт считает водопад заново, по факту. Команд станции
// здесь нет: оборудование отчитывается само (гейт `ocppOpen`).

import { ChargeSessionStatus, ConnectorStatus, PointStatus, Prisma, ReservationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { num } from "./decimal";
import { roundKwh, roundMoney } from "./precision";
import { quoteCharge } from "./payment-service";
import { getOrCreateWallet } from "./wallet-service";
import { writeAudit } from "./audit";
import type { ChargePlan } from "./charge";

export class ChargeSessionError extends Error {}

/** §18 Y %: сколько минут сеанс без единого отчёта считается живым. */
export const SESSION_TTL_MINUTES = 15;

const LIVE: ChargeSessionStatus[] = [ChargeSessionStatus.AUTHORIZED, ChargeSessionStatus.ACTIVE];

export interface AuthorizeArgs {
  userId: string;
  pointId: string;
  connectorId: string;
  plannedKwh: number;
  idempotencyKey: string;
}

export interface SessionView {
  id: string;
  status: ChargeSessionStatus;
  pointId: string;
  pointName: string;
  connectorId: string;
  connectorType: string;
  zoneId: string;
  plannedKwh: number;
  deliveredKwh: number;
  authorizedFiat: number;
  currency: string;
  quote: ChargePlan;
  reservationId: string | null;
  paymentId: string | null;
  startedAt: Date | null;
  lastMeterAt: Date | null;
  endedAt: Date | null;
  closeReason: string | null;
  idempotentReplay: boolean;
}

function view(row: {
  id: string;
  status: ChargeSessionStatus;
  pointId: string;
  connectorId: string;
  zoneId: string;
  plannedKwh: Prisma.Decimal;
  deliveredKwh: Prisma.Decimal;
  authorizedFiat: Prisma.Decimal;
  currency: string;
  quote: Prisma.JsonValue;
  reservationId: string | null;
  paymentId: string | null;
  startedAt: Date | null;
  lastMeterAt: Date | null;
  endedAt: Date | null;
  closeReason: string | null;
  point: { name: string };
  connector: { type: string };
}, idempotentReplay = false): SessionView {
  return {
    id: row.id,
    status: row.status,
    pointId: row.pointId,
    pointName: row.point.name,
    connectorId: row.connectorId,
    connectorType: String(row.connector.type),
    zoneId: row.zoneId,
    plannedKwh: num(row.plannedKwh),
    deliveredKwh: num(row.deliveredKwh),
    authorizedFiat: num(row.authorizedFiat),
    currency: row.currency,
    quote: row.quote as unknown as ChargePlan,
    reservationId: row.reservationId,
    paymentId: row.paymentId,
    startedAt: row.startedAt,
    lastMeterAt: row.lastMeterAt,
    endedAt: row.endedAt,
    closeReason: row.closeReason,
    idempotentReplay,
  };
}

const WITH_NAMES = { point: { select: { name: true } }, connector: { select: { type: true } } };

export async function readActiveSession(userId: string): Promise<SessionView | null> {
  const row = await prisma.chargeSession.findFirst({
    where: { userId, status: { in: LIVE } },
    orderBy: { createdAt: "desc" },
    include: WITH_NAMES,
  });
  return row ? view(row) : null;
}

export async function readSession(id: string): Promise<SessionView | null> {
  const row = await prisma.chargeSession.findUnique({ where: { id }, include: WITH_NAMES });
  return row ? view(row) : null;
}

export async function authorizeSession(args: AuthorizeArgs): Promise<SessionView> {
  const plannedKwh = roundKwh(args.plannedKwh);
  if (!(plannedKwh > 0)) throw new ChargeSessionError("Planned kWh must be positive");

  const existing = await prisma.chargeSession.findUnique({
    where: { idempotencyKey: args.idempotencyKey },
    include: WITH_NAMES,
  });
  if (existing) return view(existing, true);

  const point = await prisma.acceptancePoint.findUnique({
    where: { id: args.pointId },
    select: { id: true, name: true, status: true, gridZoneId: true },
  });
  if (!point) throw new ChargeSessionError("No such point");
  if (point.status !== PointStatus.PUBLISHED) {
    throw new ChargeSessionError("This point is not open for charging");
  }
  if (!point.gridZoneId) {
    throw new ChargeSessionError("This point has no grid zone, so energy cannot be priced");
  }

  const connector = await prisma.pointConnector.findUnique({
    where: { id: args.connectorId },
    select: { id: true, pointId: true, type: true, status: true },
  });
  if (!connector || connector.pointId !== point.id) {
    throw new ChargeSessionError("That connector belongs to a different point");
  }

  const wallet = await getOrCreateWallet(args.userId, point.gridZoneId);

  // Расчёт §16.6 до всякой записи: сумма авторизации должна быть известна
  // раньше, чем мы что-то займём.
  const plan = await quoteCharge({
    userId: args.userId,
    zoneId: point.gridZoneId,
    requestedKwh: plannedKwh,
    pointId: point.id,
    connectorId: connector.id,
  });

  const authorizedFiat = roundMoney(plan.authorizedTotal ?? plan.total);

  return await prisma.$transaction(async (tx) => {
    // Разъём занимается под блокировкой: два водителя на один свободный
    // разъём должны разойтись, а не поделить его.
    const locked = await tx.$queryRaw<{ id: string; status: ConnectorStatus }[]>`
      SELECT id, status FROM "PointConnector" WHERE id = ${connector.id} FOR UPDATE`;
    const current = locked[0];
    if (!current) throw new ChargeSessionError("That connector is gone");

    // §32.5 — своя бронь на этом разъёме и есть разрешение занять его.
    const booking = await tx.reservation.findFirst({
      where: {
        userId: args.userId,
        connectorId: connector.id,
        status: { in: [ReservationStatus.CREATED, ReservationStatus.ACTIVE] },
      },
      orderBy: { windowStart: "asc" },
    });

    if (current.status === ConnectorStatus.OUT_OF_SERVICE) {
      throw new ChargeSessionError("This connector is out of service");
    }
    if (current.status === ConnectorStatus.BUSY) {
      throw new ChargeSessionError("This connector is busy right now");
    }
    if (current.status === ConnectorStatus.BOOKED && !booking) {
      throw new ChargeSessionError("This connector is booked by somebody else");
    }

    const live = await tx.chargeSession.findFirst({
      where: { userId: args.userId, status: { in: LIVE } },
      select: { id: true },
    });
    if (live) throw new ChargeSessionError("You already have a charging session running");

    if (authorizedFiat > 0) {
      const w = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      const free = roundMoney(num(w.fiatBalance) - num(w.reservedFiat));
      if (free + 0.005 < authorizedFiat) {
        throw new ChargeSessionError(
          `Money balance is ${free.toFixed(2)} ${w.currency}, the session needs ${authorizedFiat.toFixed(2)}`,
        );
      }
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { reservedFiat: { increment: new Prisma.Decimal(authorizedFiat) } },
      });
    }

    await tx.pointConnector.update({
      where: { id: connector.id },
      data: { status: ConnectorStatus.BUSY, statusAt: new Date() },
    });

    if (booking) {
      await tx.reservation.update({
        where: { id: booking.id },
        data: { status: ReservationStatus.FULFILLED, closedAt: new Date(), closeReason: "charging started" },
      });
    }

    const row = await tx.chargeSession.create({
      data: {
        userId: args.userId,
        walletId: wallet.id,
        zoneId: point.gridZoneId!,
        pointId: point.id,
        connectorId: connector.id,
        reservationId: booking?.id ?? null,
        plannedKwh: new Prisma.Decimal(plannedKwh),
        authorizedFiat: new Prisma.Decimal(authorizedFiat),
        currency: plan.currency,
        quote: plan as unknown as Prisma.InputJsonValue,
        idempotencyKey: args.idempotencyKey,
      },
      include: WITH_NAMES,
    });

    await writeAudit(tx, {
      actorUserId: args.userId,
      entity: "ChargeSession",
      entityId: row.id,
      action: "charge.session.authorized",
      payload: { plannedKwh, authorizedFiat, pointId: point.id, connectorId: connector.id },
    });

    return view(row);
  });
}
```

Перед реализацией сверить: как называется поле суммы авторизации в
`ChargePlan` (`src/lib/exchange/charge.ts`, интерфейс `ChargePlan`) — в
тексте выше `authorizedTotal`; подставить настоящее имя. Так же сверить
подпись `writeAudit` в `src/lib/exchange/audit.ts` и `getOrCreateWallet` в
`src/lib/exchange/wallet-service.ts`.

- [x] **Step 5: Запустить тесты**

```bash
cd ~/poolwatt
NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local \
  | tr -d '"' | sed 's|/poolwatt?|/poolwatt_test?|')" \
  npx vitest run src/lib/exchange/charge-session.test.ts
```

Ожидание: 6 passed.

- [x] **Step 6: Commit**

```bash
git add src/lib/exchange/charge-session.ts src/lib/exchange/charge-session.test.ts \
  src/lib/exchange/__fixtures__/charge-point.ts
git commit -m "feat(charge): authorizing a session holds the connector and the money"
```

---

## Task 5: Отчёт счётчика

**Files:**
- Modify: `src/lib/exchange/charge-session.ts`
- Modify: `src/lib/exchange/charge-session.test.ts`

- [x] **Step 1: Написать падающий тест**

Добавить в `src/lib/exchange/charge-session.test.ts`:

```ts
describe("reportMeter", () => {
  let fx: Awaited<ReturnType<typeof seedChargePoint>>;
  let session: Awaited<ReturnType<typeof authorizeSession>>;
  let key: { token: string };

  beforeEach(async () => {
    fx = await seedChargePoint({ kwhBalance: 30, fiatBalance: 50 });
    key = await issuePointKey(fx.pointId, fx.operatorUserId, "test");
    session = await authorizeSession({
      userId: fx.userId,
      pointId: fx.pointId,
      connectorId: fx.connectorId,
      plannedKwh: 10,
      idempotencyKey: `test-${Date.now()}`,
    });
  });

  it("the first report starts the session", async () => {
    const after = await reportMeter({
      sessionId: session.id,
      token: key.token,
      body: { kwhTotal: 1.25 },
      signature: null,
      timestamp: null,
      path: `/v1/charge-sessions/${session.id}/meter`,
    });

    expect(after.status).toBe("ACTIVE");
    expect(after.deliveredKwh).toBe(1.25);
    expect(after.startedAt).not.toBeNull();

    const ticks = await prisma.chargeSessionTick.findMany({ where: { sessionId: session.id } });
    expect(ticks).toHaveLength(1);
  });

  it("the meter only goes up", async () => {
    await reportMeter({
      sessionId: session.id,
      token: key.token,
      body: { kwhTotal: 4 },
      signature: null,
      timestamp: null,
      path: `/v1/charge-sessions/${session.id}/meter`,
    });

    await expect(
      reportMeter({
        sessionId: session.id,
        token: key.token,
        body: { kwhTotal: 3.5 },
        signature: null,
        timestamp: null,
        path: `/v1/charge-sessions/${session.id}/meter`,
      }),
    ).rejects.toThrow(/lower/i);
  });

  it("refuses the key of another point", async () => {
    const other = await seedChargePoint({ kwhBalance: 1, fiatBalance: 1 });
    const otherKey = await issuePointKey(other.pointId, other.operatorUserId, "test");

    await expect(
      reportMeter({
        sessionId: session.id,
        token: otherKey.token,
        body: { kwhTotal: 1 },
        signature: null,
        timestamp: null,
        path: `/v1/charge-sessions/${session.id}/meter`,
      }),
    ).rejects.toThrow(ChargeSessionError);
  });

  it("refuses a session that is already settled", async () => {
    await finishSession({ sessionId: session.id, reason: "test" });

    await expect(
      reportMeter({
        sessionId: session.id,
        token: key.token,
        body: { kwhTotal: 9 },
        signature: null,
        timestamp: null,
        path: `/v1/charge-sessions/${session.id}/meter`,
      }),
    ).rejects.toThrow(/not running/i);
  });
});
```

Фикстура должна отдавать `operatorUserId` — пользователя, от имени которого
`issuePointKey` выдаёт ключ. Дописать его в `seedChargePoint`: создать второго
пользователя и связать его с `ChargerOperator` так, как это делает
`point-availability.test.ts` (посмотреть там, кто считается владельцем пункта).

- [x] **Step 2: Запустить и убедиться, что падает**

```bash
cd ~/poolwatt
NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local \
  | tr -d '"' | sed 's|/poolwatt?|/poolwatt_test?|')" \
  npx vitest run src/lib/exchange/charge-session.test.ts
```

Ожидание: FAIL, `reportMeter is not exported`.

- [x] **Step 3: Реализовать**

Дописать в `src/lib/exchange/charge-session.ts`:

```ts
import { sha256 } from "@/lib/hash";
import { open } from "@/lib/crypto-box";
import { restCanonicalString, verifySignature } from "./equipment-signature";
import { notifyChargeSession } from "./realtime-notify";

export interface MeterReport {
  sessionId: string;
  token: string;
  body: { kwhTotal: number; powerKw?: number | null };
  signature: string | null;
  timestamp: string | null;
  /** Маршрут так, как он подписан. */
  path: string;
  now?: Date;
}

/**
 * Оборудование говорит, сколько кВт·ч уже выдало. Ключ пункта и подпись §15 —
 * тот же путь, что у занятости разъёмов: identity сеанса не в заголовке, а в
 * том, что ключ принадлежит пункту этого сеанса.
 */
export async function reportMeter(report: MeterReport): Promise<SessionView> {
  const session = await prisma.chargeSession.findUnique({
    where: { id: report.sessionId },
    include: WITH_NAMES,
  });
  if (!session) throw new ChargeSessionError("No such session");
  if (!LIVE.includes(session.status)) {
    throw new ChargeSessionError("This session is not running");
  }

  const key = await prisma.pointApiKey.findUnique({
    where: { tokenHash: sha256(report.token) },
    select: { id: true, pointId: true, revokedAt: true, signingSecretEnc: true, signingSecretIv: true },
  });
  if (!key || key.revokedAt) throw new ChargeSessionError("Unknown or revoked key");
  if (key.pointId !== session.pointId) {
    throw new ChargeSessionError("This key belongs to another point");
  }

  if (key.signingSecretEnc && key.signingSecretIv) {
    const secret = open(key.signingSecretEnc, key.signingSecretIv);
    const verdict = verifySignature({
      secret,
      signature: report.signature,
      timestamp: report.timestamp,
      canonical: restCanonicalString({
        timestamp: report.timestamp ?? "",
        method: "POST",
        path: report.path,
        body: JSON.stringify(report.body),
      }),
      now: report.now,
    });
    if (!verdict.ok) throw new ChargeSessionError(`Bad signature: ${verdict.reason}`);
  }

  const kwhTotal = roundKwh(report.body.kwhTotal);
  if (!(kwhTotal >= 0)) throw new ChargeSessionError("kwhTotal must not be negative");
  if (kwhTotal + 0.0005 < num(session.deliveredKwh)) {
    throw new ChargeSessionError(
      `The meter cannot be lower than it was: ${kwhTotal} after ${num(session.deliveredKwh)}`,
    );
  }

  const now = report.now ?? new Date();
  const updated = await prisma.$transaction(async (tx) => {
    await tx.chargeSessionTick.create({
      data: {
        sessionId: session.id,
        at: now,
        kwhTotal: new Prisma.Decimal(kwhTotal),
        powerKw: report.body.powerKw != null ? new Prisma.Decimal(report.body.powerKw) : null,
      },
    });
    await tx.pointApiKey.update({ where: { id: key.id }, data: { lastUsedAt: now } });
    return await tx.chargeSession.update({
      where: { id: session.id },
      data: {
        deliveredKwh: new Prisma.Decimal(kwhTotal),
        lastMeterAt: now,
        status: ChargeSessionStatus.ACTIVE,
        startedAt: session.startedAt ?? now,
      },
      include: WITH_NAMES,
    });
  });

  const result = view(updated);
  await notifyChargeSession(session.userId, "charge.tick", result);
  return result;
}
```

Сверить имена помощников перед написанием: `sha256` (откуда его берёт
`point-availability.ts`) и `open` из `crypto-box.ts`.

- [x] **Step 4: Заглушка уведомления, чтобы файл собрался**

Дописать в `src/lib/exchange/realtime-notify.ts`:

```ts
/** §22.9, US-20 — ход зарядки на открытом экране. */
export async function notifyChargeSession(
  userId: string,
  type: "charge.started" | "charge.tick" | "charge.completed",
  session: unknown,
): Promise<void> {
  try {
    await publish(walletChannel(userId), type, { session } as Record<string, unknown>);
  } catch {
    // Экран, пропустивший событие, покажет верное на следующей загрузке.
  }
}
```

- [x] **Step 5: Запустить тесты**

```bash
cd ~/poolwatt
NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local \
  | tr -d '"' | sed 's|/poolwatt?|/poolwatt_test?|')" \
  npx vitest run src/lib/exchange/charge-session.test.ts
```

Ожидание: 10 passed (4 новых; `finishSession` ещё не написан, поэтому
последний случай временно `it.skip` — снять skip в Task 6).

- [x] **Step 6: Commit**

```bash
git add src/lib/exchange/charge-session.ts src/lib/exchange/charge-session.test.ts \
  src/lib/exchange/realtime-notify.ts src/lib/exchange/__fixtures__/charge-point.ts
git commit -m "feat(charge): the equipment reports kWh, the meter only goes up"
```

---

## Task 6: Расчёт по факту

**Files:**
- Modify: `src/lib/exchange/charge-session.ts`
- Modify: `src/lib/exchange/charge-session.test.ts`

- [x] **Step 1: Написать падающий тест**

Добавить в `src/lib/exchange/charge-session.test.ts`:

```ts
describe("finishSession", () => {
  let fx: Awaited<ReturnType<typeof seedChargePoint>>;

  beforeEach(async () => {
    fx = await seedChargePoint({ kwhBalance: 30, fiatBalance: 50 });
  });

  it("settles on what was delivered, not on what was planned", async () => {
    const key = await issuePointKey(fx.pointId, fx.operatorUserId, "test");
    const session = await authorizeSession({
      userId: fx.userId,
      pointId: fx.pointId,
      connectorId: fx.connectorId,
      plannedKwh: 20,
      idempotencyKey: `test-${Date.now()}`,
    });
    await reportMeter({
      sessionId: session.id,
      token: key.token,
      body: { kwhTotal: 7.5 },
      signature: null,
      timestamp: null,
      path: `/v1/charge-sessions/${session.id}/meter`,
    });

    const done = await finishSession({ sessionId: session.id, reason: "equipment reported the end" });

    expect(done.status).toBe("COMPLETED");
    expect(done.deliveredKwh).toBe(7.5);
    expect(done.paymentId).not.toBeNull();

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: done.paymentId! },
      include: { receipt: true },
    });
    expect(Number(payment.requestedKwh)).toBe(7.5);
    expect(payment.receipt).not.toBeNull();

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: fx.walletId } });
    expect(Number(wallet.reservedFiat)).toBe(0);
    expect(Number(wallet.kwhBalance)).toBeCloseTo(22.5, 3);

    const connector = await prisma.pointConnector.findUniqueOrThrow({
      where: { id: fx.connectorId },
    });
    expect(connector.status).toBe(ConnectorStatus.FREE);
  });

  it("a session nobody charged costs nothing", async () => {
    const session = await authorizeSession({
      userId: fx.userId,
      pointId: fx.pointId,
      connectorId: fx.connectorId,
      plannedKwh: 10,
      idempotencyKey: `test-${Date.now()}`,
    });

    const done = await finishSession({ sessionId: session.id, reason: "driver cancelled" });

    expect(done.status).toBe("CANCELLED");
    expect(done.paymentId).toBeNull();
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: fx.walletId } });
    expect(Number(wallet.kwhBalance)).toBe(30);
  });

  it("settling twice settles once", async () => {
    const key = await issuePointKey(fx.pointId, fx.operatorUserId, "test");
    const session = await authorizeSession({
      userId: fx.userId,
      pointId: fx.pointId,
      connectorId: fx.connectorId,
      plannedKwh: 10,
      idempotencyKey: `test-${Date.now()}`,
    });
    await reportMeter({
      sessionId: session.id,
      token: key.token,
      body: { kwhTotal: 3 },
      signature: null,
      timestamp: null,
      path: `/v1/charge-sessions/${session.id}/meter`,
    });

    const first = await finishSession({ sessionId: session.id, reason: "a" });
    const again = await finishSession({ sessionId: session.id, reason: "b" });

    expect(again.paymentId).toBe(first.paymentId);
    const payments = await prisma.payment.count({
      where: { walletId: fx.walletId, pointId: fx.pointId },
    });
    expect(payments).toBe(1);
  });

  it("expires a session the equipment never reported", async () => {
    const session = await authorizeSession({
      userId: fx.userId,
      pointId: fx.pointId,
      connectorId: fx.connectorId,
      plannedKwh: 10,
      idempotencyKey: `test-${Date.now()}`,
    });
    await prisma.chargeSession.update({
      where: { id: session.id },
      data: { createdAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const swept = await expireStaleSessions(new Date());
    expect(swept).toBeGreaterThanOrEqual(1);

    const after = await prisma.chargeSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.status).toBe("EXPIRED");
    const connector = await prisma.pointConnector.findUniqueOrThrow({
      where: { id: fx.connectorId },
    });
    expect(connector.status).toBe(ConnectorStatus.FREE);
  });
});
```

- [x] **Step 2: Запустить и убедиться, что падает**

```bash
cd ~/poolwatt
NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local \
  | tr -d '"' | sed 's|/poolwatt?|/poolwatt_test?|')" \
  npx vitest run src/lib/exchange/charge-session.test.ts
```

Ожидание: FAIL, `finishSession is not exported`.

- [x] **Step 3: Реализовать**

Дописать в `src/lib/exchange/charge-session.ts`:

```ts
import { chargeSession as settleCharge } from "./payment-service";

export interface FinishArgs {
  sessionId: string;
  reason: string;
  now?: Date;
}

/**
 * Расчёт §16.6 «списывается по факту»: водопад считается заново против
 * настоящего баланса, настоящей книги и настоящей цены. Резерв снимается,
 * разъём освобождается. Сеанс, в котором не выдали ни одного кВт·ч, стоит
 * ноль и не оставляет чека.
 */
export async function finishSession(args: FinishArgs): Promise<SessionView> {
  const now = args.now ?? new Date();
  const session = await prisma.chargeSession.findUnique({
    where: { id: args.sessionId },
    include: WITH_NAMES,
  });
  if (!session) throw new ChargeSessionError("No such session");
  if (!LIVE.includes(session.status)) return view(session, true);

  const delivered = roundKwh(num(session.deliveredKwh));

  // Снять резерв и освободить разъём до расчёта: сам расчёт проверяет, хватает
  // ли денег, и зарезервированные им же деньги считаются занятыми.
  await releaseHold(session.id, now);

  if (delivered <= 0) {
    const row = await prisma.chargeSession.update({
      where: { id: session.id },
      data: {
        status: ChargeSessionStatus.CANCELLED,
        endedAt: now,
        closeReason: args.reason,
      },
      include: WITH_NAMES,
    });
    const result = view(row);
    await notifyChargeSession(session.userId, "charge.completed", result);
    return result;
  }

  const payment = await settleCharge({
    userId: session.userId,
    zoneId: session.zoneId,
    requestedKwh: delivered,
    pointId: session.pointId,
    connectorId: session.connectorId,
    startedAt: session.startedAt,
    endedAt: now,
    idempotencyKey: `charge-session:${session.id}`,
  });

  const row = await prisma.chargeSession.update({
    where: { id: session.id },
    data: {
      status:
        payment.status === "FAILED" ? ChargeSessionStatus.FAILED : ChargeSessionStatus.COMPLETED,
      paymentId: payment.paymentId,
      endedAt: now,
      closeReason: args.reason,
    },
    include: WITH_NAMES,
  });

  await writeAudit(prisma, {
    actorUserId: session.userId,
    entity: "ChargeSession",
    entityId: session.id,
    action: "charge.session.settled",
    payload: { deliveredKwh: delivered, paymentId: payment.paymentId, reason: args.reason },
  });

  const result = view(row);
  await notifyChargeSession(session.userId, "charge.completed", result);
  return result;
}

/** Резерв снят, разъём свободен. Идемпотентно: второй раз ничего не делает. */
async function releaseHold(sessionId: string, now: Date): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.chargeSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { authorizedFiat: true, walletId: true, connectorId: true, status: true },
    });
    if (!LIVE.includes(row.status)) return;

    const hold = num(row.authorizedFiat);
    if (hold > 0) {
      await tx.wallet.update({
        where: { id: row.walletId },
        data: { reservedFiat: { decrement: new Prisma.Decimal(hold) } },
      });
    }
    await tx.chargeSession.update({
      where: { id: sessionId },
      data: { authorizedFiat: new Prisma.Decimal(0) },
    });
    await tx.pointConnector.update({
      where: { id: row.connectorId },
      data: { status: ConnectorStatus.FREE, statusAt: now },
    });
  });
}

/**
 * Сеанс, о котором оборудование не отчиталось ни разу за TTL, снимается:
 * иначе разъём остаётся занятым навсегда и деньги водителя — в резерве.
 */
export async function expireStaleSessions(now = new Date()): Promise<number> {
  const deadline = new Date(now.getTime() - SESSION_TTL_MINUTES * 60_000);
  const stale = await prisma.chargeSession.findMany({
    where: {
      status: ChargeSessionStatus.AUTHORIZED,
      lastMeterAt: null,
      createdAt: { lt: deadline },
    },
    select: { id: true, userId: true },
  });

  let swept = 0;
  for (const row of stale) {
    try {
      await releaseHold(row.id, now);
      await prisma.chargeSession.update({
        where: { id: row.id },
        data: {
          status: ChargeSessionStatus.EXPIRED,
          endedAt: now,
          closeReason: `no meter report within ${SESSION_TTL_MINUTES} minutes`,
        },
      });
      swept += 1;
    } catch (err) {
      console.error("[charge-session] could not expire", row.id, err);
    }
  }
  return swept;
}
```

- [x] **Step 4: Снять `it.skip` из Task 5**

Вернуть случай «refuses a session that is already settled» в обычный `it`.

- [x] **Step 5: Запустить тесты**

```bash
cd ~/poolwatt
NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local \
  | tr -d '"' | sed 's|/poolwatt?|/poolwatt_test?|')" \
  npx vitest run src/lib/exchange/charge-session.test.ts
```

Ожидание: 14 passed.

- [x] **Step 6: Commit**

```bash
git add src/lib/exchange/charge-session.ts src/lib/exchange/charge-session.test.ts
git commit -m "feat(charge): a session settles on the facts and frees what it held"
```

---

## Task 7: Одновременность

**Files:**
- Create: `src/lib/exchange/charge-session-flow.test.ts`

- [x] **Step 1: Написать тест**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { ConnectorStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  authorizeSession,
  finishSession,
  reportMeter,
} from "./charge-session";
import { seedChargePoint } from "./__fixtures__/charge-point";
import { issuePointKey } from "@/lib/points/point-availability";

describe("charge sessions under concurrency", () => {
  let fx: Awaited<ReturnType<typeof seedChargePoint>>;

  beforeEach(async () => {
    fx = await seedChargePoint({ kwhBalance: 40, fiatBalance: 100 });
  });

  it("two drivers racing for one free connector: one wins", async () => {
    const second = await seedChargePoint({ kwhBalance: 40, fiatBalance: 100 });

    const results = await Promise.allSettled([
      authorizeSession({
        userId: fx.userId,
        pointId: fx.pointId,
        connectorId: fx.connectorId,
        plannedKwh: 5,
        idempotencyKey: `race-a-${Date.now()}`,
      }),
      authorizeSession({
        userId: second.userId,
        pointId: fx.pointId,
        connectorId: fx.connectorId,
        plannedKwh: 5,
        idempotencyKey: `race-b-${Date.now()}`,
      }),
    ]);

    const won = results.filter((r) => r.status === "fulfilled");
    expect(won).toHaveLength(1);

    const sessions = await prisma.chargeSession.count({
      where: { connectorId: fx.connectorId, status: { in: ["AUTHORIZED", "ACTIVE"] } },
    });
    expect(sessions).toBe(1);
  });

  it("the same key twice gives one session", async () => {
    const key = `same-${Date.now()}`;
    const results = await Promise.allSettled([
      authorizeSession({
        userId: fx.userId,
        pointId: fx.pointId,
        connectorId: fx.connectorId,
        plannedKwh: 5,
        idempotencyKey: key,
      }),
      authorizeSession({
        userId: fx.userId,
        pointId: fx.pointId,
        connectorId: fx.connectorId,
        plannedKwh: 5,
        idempotencyKey: key,
      }),
    ]);

    const ids = results
      .filter((r): r is PromiseFulfilledResult<{ id: string }> => r.status === "fulfilled")
      .map((r) => r.value.id);
    expect(new Set(ids).size).toBe(1);
    expect(await prisma.chargeSession.count({ where: { idempotencyKey: key } })).toBe(1);
  });

  it("two simultaneous endings pay once", async () => {
    const pointKey = await issuePointKey(fx.pointId, fx.operatorUserId, "test");
    const session = await authorizeSession({
      userId: fx.userId,
      pointId: fx.pointId,
      connectorId: fx.connectorId,
      plannedKwh: 10,
      idempotencyKey: `finish-${Date.now()}`,
    });
    await reportMeter({
      sessionId: session.id,
      token: pointKey.token,
      body: { kwhTotal: 6 },
      signature: null,
      timestamp: null,
      path: `/v1/charge-sessions/${session.id}/meter`,
    });

    await Promise.allSettled([
      finishSession({ sessionId: session.id, reason: "driver" }),
      finishSession({ sessionId: session.id, reason: "equipment" }),
    ]);

    expect(
      await prisma.payment.count({ where: { walletId: fx.walletId, pointId: fx.pointId } }),
    ).toBe(1);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: fx.walletId } });
    expect(Number(wallet.reservedFiat)).toBe(0);

    const connector = await prisma.pointConnector.findUniqueOrThrow({
      where: { id: fx.connectorId },
    });
    expect(connector.status).toBe(ConnectorStatus.FREE);
  });
});
```

- [x] **Step 2: Запустить**

```bash
cd ~/poolwatt
NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local \
  | tr -d '"' | sed 's|/poolwatt?|/poolwatt_test?|')" \
  npx vitest run src/lib/exchange/charge-session-flow.test.ts
```

Ожидание: 3 passed. Если «two simultaneous endings» даёт два платежа —
`finishSession` должен брать блокировку сеанса: добавить в начало
`releaseHold`-транзакции `SELECT … FOR UPDATE` по `ChargeSession` и
перепроверять статус. Правка идёт в `charge-session.ts`, тест не меняется.

- [x] **Step 3: Commit**

```bash
git add src/lib/exchange/charge-session-flow.test.ts src/lib/exchange/charge-session.ts
git commit -m "test(charge): a connector, a key and an ending are each used once"
```

---

## Task 8: Методы API

**Files:**
- Create: `src/app/api/v1/charge-sessions/route.ts`
- Create: `src/app/api/v1/charge-sessions/me/active/route.ts`
- Create: `src/app/api/v1/charge-sessions/[id]/meter/route.ts`
- Create: `src/app/api/v1/charge-sessions/[id]/stop/route.ts`
- Create: `src/app/api/v1/points/resolve/route.ts`

- [x] **Step 1: Старт сеанса**

`src/app/api/v1/charge-sessions/route.ts`:

```ts
// POST /v1/charge-sessions — ТЗ §22.9, US-20. Старт по QR.
import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  domainError,
  idempotencyKey,
  idempotent,
  parseBody,
  sessionUser,
  unauthorized,
} from "@/lib/exchange/api";
import { authorizeSession } from "@/lib/exchange/charge-session";

const bodySchema = z.object({
  pointId: z.string().min(1).max(40),
  connectorId: z.string().min(1).max(40),
  plannedKwh: z.number().positive().max(1000),
});

export async function POST(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const parsed = await parseBody(req, bodySchema);
  if ("response" in parsed) return parsed.response;

  const key = idempotencyKey(req);
  try {
    return await idempotent({
      endpoint: "POST /v1/charge-sessions",
      key,
      userKey: user.id,
      body: parsed.data,
      run: async () => {
        const session = await authorizeSession({
          userId: user.id,
          pointId: parsed.data.pointId,
          connectorId: parsed.data.connectorId,
          plannedKwh: parsed.data.plannedKwh,
          idempotencyKey: key ?? `session-${user.id}-${Date.now()}`,
        });
        return { status: 201, data: { session } };
      },
    });
  } catch (err) {
    return domainError(err);
  }
}
```

Сверить с `src/lib/exchange/api.ts`: обязателен ли `Idempotency-Key` (у
`payments/charge` он необязателен, но §15 требует его для всего, что двигает
деньги) — если `idempotent` сам отвечает 400 на отсутствующий ключ, оставить
как есть; если нет, вернуть 400 до вызова.

- [x] **Step 2: Живой сеанс**

`src/app/api/v1/charge-sessions/me/active/route.ts`:

```ts
// GET /v1/charge-sessions/me/active — что показать на экране зарядки.
import { sessionUser, unauthorized } from "@/lib/exchange/api";
import { NextResponse } from "next/server";
import { readActiveSession } from "@/lib/exchange/charge-session";

export async function GET() {
  const user = await sessionUser();
  if (!user) return unauthorized();
  return NextResponse.json({ session: await readActiveSession(user.id) });
}
```

- [x] **Step 3: Отчёт счётчика**

`src/app/api/v1/charge-sessions/[id]/meter/route.ts`:

```ts
// POST /v1/charge-sessions/{id}/meter — ТЗ §15, US-20.
//
// Оборудование говорит, сколько кВт·ч выдало. Ключ пункта плюс подпись HMAC,
// как у занятости разъёмов; что это за сеанс, решает не заголовок, а то, что
// ключ принадлежит пункту сеанса.
import { NextResponse } from "next/server";
import { ChargeSessionError, reportMeter } from "@/lib/exchange/charge-session";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

  let body: { kwhTotal?: unknown; powerKw?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body is not JSON" }, { status: 400 });
  }
  if (typeof body?.kwhTotal !== "number") {
    return NextResponse.json({ error: "kwhTotal must be a number" }, { status: 422 });
  }

  try {
    const session = await reportMeter({
      token,
      sessionId: id,
      body: {
        kwhTotal: body.kwhTotal,
        powerKw: typeof body.powerKw === "number" ? body.powerKw : null,
      },
      signature: req.headers.get("x-poolwatt-signature"),
      timestamp: req.headers.get("x-poolwatt-timestamp"),
      path: `/v1/charge-sessions/${id}/meter`,
    });
    return NextResponse.json({ session }, { status: 202 });
  } catch (err) {
    if (err instanceof ChargeSessionError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[charge-sessions/meter]", err);
    return NextResponse.json({ error: "Could not record the meter report" }, { status: 500 });
  }
}
```

- [x] **Step 4: Завершение**

`src/app/api/v1/charge-sessions/[id]/stop/route.ts`:

```ts
// POST /v1/charge-sessions/{id}/stop — водитель или оборудование.
import { NextResponse } from "next/server";
import { domainError, sessionUser, unauthorized } from "@/lib/exchange/api";
import { finishSession, readSession } from "@/lib/exchange/charge-session";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await sessionUser();
  if (!user) return unauthorized();

  const session = await readSession(id);
  if (!session) return NextResponse.json({ error: "No such session" }, { status: 404 });

  try {
    const done = await finishSession({ sessionId: id, reason: "the driver stopped it" });
    return NextResponse.json({ session: done });
  } catch (err) {
    return domainError(err);
  }
}
```

Сеанс чужого водителя завершать нельзя: `readSession` вернуть с `userId` и
отвечать 404, если он не совпадает с `user.id` (404, не 403: чужой сеанс для
этого водителя не существует).

- [x] **Step 5: Разбор QR**

`src/app/api/v1/points/resolve/route.ts`:

```ts
// GET /v1/points/resolve?code= — что зашито в QR на разъёме (US-20).
import { NextRequest, NextResponse } from "next/server";
import { ConnectorStatus, PointStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseConnectorCode } from "@/lib/exchange/qr-code";
import { num } from "@/lib/exchange/decimal";

export async function GET(req: NextRequest) {
  const parsed = parseConnectorCode(req.nextUrl.searchParams.get("code"));
  if (!parsed) {
    return NextResponse.json({ error: "This is not a Poolwatt code" }, { status: 422 });
  }

  const point = await prisma.acceptancePoint.findFirst({
    where: { id: parsed.pointId, status: PointStatus.PUBLISHED },
    select: {
      id: true,
      name: true,
      addressLine: true,
      city: true,
      gridZoneId: true,
      connectors: { select: { id: true, type: true, powerKw: true, status: true } },
      tariffs: { orderBy: { fromMinute: "asc" }, take: 1 },
    },
  });
  if (!point) return NextResponse.json({ error: "No such point" }, { status: 404 });

  const connectors = point.connectors.map((c) => ({
    id: c.id,
    type: String(c.type),
    powerKw: num(c.powerKw),
    status: c.status,
  }));
  const chosen = parsed.connectorId
    ? connectors.find((c) => c.id === parsed.connectorId) ?? null
    : connectors.find((c) => c.status === ConnectorStatus.FREE) ?? null;

  return NextResponse.json({
    point: {
      id: point.id,
      name: point.name,
      address: [point.addressLine, point.city].filter(Boolean).join(", "),
      zoneId: point.gridZoneId,
      priceFiat: point.tariffs[0]?.priceFiat ? num(point.tariffs[0].priceFiat) : null,
      currency: point.tariffs[0]?.currency ?? "EUR",
    },
    connectors,
    connectorId: chosen?.id ?? null,
  });
}
```

- [x] **Step 6: Проверить, что собирается**

```bash
cd ~/poolwatt
npx tsc --noEmit
```

Ожидание: без ошибок.

- [x] **Step 7: Commit**

```bash
git add src/app/api/v1/charge-sessions src/app/api/v1/points/resolve
git commit -m "feat(charge): the five methods a session needs"
```

---

## Task 9: Воркер сметает истёкшие сеансы

**Files:**
- Modify: `worker/index.ts`

- [x] **Step 1: Посмотреть, как устроены существующие задачи**

```bash
cd ~/poolwatt
grep -n 'cron\|schedule\|closeExpiredReservations' worker/index.ts | head -30
```

- [x] **Step 2: Добавить задачу рядом с той, что закрывает брони**

```ts
import { expireStaleSessions } from "@/lib/exchange/charge-session";

// Сеанс, о котором оборудование не отчиталось ни разу, держит разъём и деньги
// водителя. Минута — то же окно, в котором работает закрытие броней.
cron.schedule("* * * * *", async () => {
  try {
    const swept = await expireStaleSessions();
    if (swept > 0) console.log(`[worker] expired ${swept} charging session(s)`);
  } catch (err) {
    console.error("[worker] expireStaleSessions failed", err);
  }
});
```

Имя переменной `cron` и форму вызова взять из того, как это уже написано в
файле — не вводить второй стиль.

- [x] **Step 3: Проверить сборку и перезапустить воркер**

```bash
cd ~/poolwatt
npx tsc --noEmit
pm2 restart poolwatt-worker
pm2 logs poolwatt-worker --lines 20 --nostream
```

Ожидание: воркер поднялся без ошибок.

- [x] **Step 4: Commit**

```bash
git add worker/index.ts
git commit -m "feat(charge): the worker releases a session nobody charged"
```

---

## Task 10: Чтение QR в браузере

**Files:**
- Create: `src/components/mobile/qr-scan.tsx`
- Modify: `package.json`

- [x] **Step 1: Поставить зависимость**

```bash
cd ~/poolwatt
NODE_ENV=development npm install jsqr
```

Ожидание: `jsqr` в `dependencies`, devDependencies целы (`npx vitest --version`
отвечает).

- [x] **Step 2: Написать компонент**

`src/components/mobile/qr-scan.tsx`:

```tsx
"use client";

// §22.9, US-20 «старт по QR». Камера через getUserMedia и разбор кадра
// `jsqr` — без нативного плагина, поэтому работает и в обеих оболочках
// Capacitor, и в обычном браузере. Ручной ввод кода — не костыль: на станции
// бывает темно, стекло в наклейке мутное, а код под ней напечатан словами.

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { parseConnectorCode } from "@/lib/exchange/qr-code";

export type QrScanLabels = {
  scan: string;
  manual: string;
  manualHint: string;
  submit: string;
  denied: string;
  notOurs: string;
};

export function QrScan({
  labels,
  onCode,
}: {
  labels: QrScanLabels;
  onCode: (code: { pointId: string; connectorId: string | null }) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null;
    let frame: number | null = null;
    let stopped = false;
    const canvas = document.createElement("canvas");

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (stopped) return;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        tick();
      } catch {
        setError(labels.denied);
        setScanning(false);
      }
    }

    function tick() {
      const video = videoRef.current;
      if (stopped || !video || video.readyState !== video.HAVE_ENOUGH_DATA) {
        frame = requestAnimationFrame(tick);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const found = jsQR(image.data, image.width, image.height);
      if (found) {
        const parsed = parseConnectorCode(found.data);
        if (parsed) {
          setScanning(false);
          onCode(parsed);
          return;
        }
        setError(labels.notOurs);
      }
      frame = requestAnimationFrame(tick);
    }

    start();
    return () => {
      stopped = true;
      if (frame != null) cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [scanning, labels.denied, labels.notOurs, onCode]);

  function submitManual() {
    const parsed = parseConnectorCode(manual);
    if (!parsed) {
      setError(labels.notOurs);
      return;
    }
    setError(null);
    onCode(parsed);
  }

  return (
    <div data-testid="qr-scan">
      {scanning ? (
        <video
          ref={videoRef}
          playsInline
          muted
          className="aspect-square w-full rounded-lg bg-black object-cover"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setScanning(true);
          }}
          className="w-full rounded-lg bg-accent px-4 py-4 text-[16px] font-medium text-black"
          data-testid="qr-start"
        >
          {labels.scan}
        </button>
      )}

      <div className="mt-4">
        <label className="text-[12px] uppercase tracking-[0.16em] text-muted" htmlFor="qr-manual">
          {labels.manual}
        </label>
        <p className="mt-1 text-[12px] text-muted">{labels.manualHint}</p>
        <div className="mt-2 flex gap-2">
          <input
            id="qr-manual"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-hairline bg-card px-3 py-3 text-[15px]"
            data-testid="qr-manual"
          />
          <button
            type="button"
            onClick={submitManual}
            className="rounded-lg border border-hairline px-4 py-3 text-[15px]"
            data-testid="qr-manual-submit"
          >
            {labels.submit}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 text-[13px] text-danger" data-testid="qr-error">
          {error}
        </p>
      )}
    </div>
  );
}
```

Сверить имя пакета: если `npm install jsqr` ставит не тот пакет, использовать
`jsqr` с официальным именем из npm (`jsqr` — порт `jsQR`; проверить
`node -e "console.log(require('jsqr'))"`). Имя цветового класса `text-danger`
сверить с `globals.css`; если его нет, взять тот, которым в проекте уже
печатают ошибку.

- [x] **Step 3: Проверить сборку**

```bash
cd ~/poolwatt
npx tsc --noEmit
```

- [x] **Step 4: Commit**

```bash
git add package.json package-lock.json src/components/mobile/qr-scan.tsx
git commit -m "feat(charge): read a QR with the camera, or type the code"
```

---

## Task 11: Экран расчёта до подтверждения

**Files:**
- Create: `src/app/[locale]/app/charge/actions.ts`
- Create: `src/app/[locale]/app/charge/start/page.tsx`
- Modify: `messages/en.json`, `messages/ru.json`, `messages/sk.json`

- [x] **Step 1: Добавить раздел сообщений**

В `messages/ru.json`, в объект `app`, добавить:

```json
"charge": {
  "title": "Зарядка",
  "scan": "Сканировать QR",
  "manual": "Код разъёма",
  "manualHint": "Код напечатан под наклейкой с QR",
  "submit": "Дальше",
  "denied": "Камера недоступна — введите код",
  "notOurs": "Это не код Poolwatt",
  "nearby": "Ближайшие пункты",
  "nearbyHelp": "Разрешите геолокацию, чтобы увидеть расстояние",
  "point": "Пункт",
  "connector": "Разъём",
  "amount": "Сколько взять",
  "breakdown": "Из чего складывается",
  "fromGift": "Подарок сети",
  "fromBalance": "Свой баланс",
  "fromRoaming": "Роуминг",
  "fromMarket": "Покупка на бирже",
  "fromAggregator": "Через агрегатора",
  "fee": "Комиссия",
  "total": "Итого",
  "authorized": "Резерв на сеанс",
  "bookingCredit": "Зачёт платы за бронь",
  "start": "Начать зарядку",
  "live": "Идёт зарядка",
  "delivered": "Выдано",
  "power": "Мощность",
  "elapsed": "Время",
  "cost": "Стоимость",
  "stop": "Завершить",
  "stopHint": "Отсоедините кабель — станция сообщит об окончании",
  "report": "Сообщить о проблеме",
  "receipt": "Чек",
  "done": "Зарядка закончена",
  "noLiquidity": "Столько кВт·ч сейчас не из чего дать",
  "needMoney": "Не хватает денег на балансе под резерв сеанса"
}
```

В `messages/en.json` и `messages/sk.json` — те же ключи с переводом. Остальные
26 локалей не трогать: они падают на английский по `src/i18n.ts`.

- [x] **Step 2: Серверные действия**

`src/app/[locale]/app/charge/actions.ts`:

```ts
"use server";

// §22.9, US-20. Старт и завершение сеанса из телефона. Ключ идемпотентности
// рождается здесь: одно нажатие — один сеанс, даже если палец дрогнул.

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  authorizeSession,
  ChargeSessionError,
  finishSession,
  readSession,
} from "@/lib/exchange/charge-session";

export async function startCharge(form: FormData): Promise<{ error?: string; id?: string }> {
  const session = await auth();
  if (!session?.user) return { error: "unauthorized" };

  const pointId = String(form.get("pointId") ?? "");
  const connectorId = String(form.get("connectorId") ?? "");
  const plannedKwh = Number(form.get("plannedKwh") ?? 0);
  const key = String(form.get("idempotencyKey") ?? "") || randomUUID();

  try {
    const started = await authorizeSession({
      userId: session.user.id,
      pointId,
      connectorId,
      plannedKwh,
      idempotencyKey: key,
    });
    revalidatePath("/[locale]/app/charge", "page");
    return { id: started.id };
  } catch (err) {
    if (err instanceof ChargeSessionError) return { error: err.message };
    throw err;
  }
}

export async function stopCharge(sessionId: string): Promise<{ error?: string }> {
  const session = await auth();
  if (!session?.user) return { error: "unauthorized" };

  const row = await readSession(sessionId);
  if (!row) return { error: "not found" };

  try {
    await finishSession({ sessionId, reason: "the driver stopped it in the app" });
    revalidatePath("/[locale]/app/charge", "page");
    return {};
  } catch (err) {
    if (err instanceof ChargeSessionError) return { error: err.message };
    throw err;
  }
}
```

`readSession` должна возвращать `userId`, чтобы здесь можно было отказать в
завершении чужого сеанса — дописать поле в `SessionView` и в `view()`
(Task 4), и проверить `row.userId !== session.user.id → { error: "not found" }`.

- [x] **Step 3: Экран расчёта**

`src/app/[locale]/app/charge/start/page.tsx`:

```tsx
// §54 «клиент видит итоговую цену и все платы до подтверждения», §16.6 —
// построчно, из чего складывается сеанс, и сколько держим в резерве.

import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ConnectorStatus, PointStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/exchange/decimal";
import { quoteCharge } from "@/lib/exchange/payment-service";
import { Screen } from "@/components/mobile/screen";
import { ChargeStartForm } from "@/components/mobile/charge-start-form";

export const dynamic = "force-dynamic";

const AMOUNTS = [10, 20, 50];

export default async function ChargeStartScreen({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ p?: string; c?: string; kwh?: string }>;
}) {
  const { locale } = await params;
  const { p, c, kwh } = await searchParams;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/app/charge`);
  }

  if (!p) notFound();

  const point = await prisma.acceptancePoint.findFirst({
    where: { id: p, status: PointStatus.PUBLISHED },
    select: {
      id: true,
      name: true,
      addressLine: true,
      city: true,
      gridZoneId: true,
      connectors: { select: { id: true, type: true, powerKw: true, status: true } },
    },
  });
  if (!point || !point.gridZoneId) notFound();

  const connector =
    point.connectors.find((x) => x.id === c) ??
    point.connectors.find((x) => x.status === ConnectorStatus.FREE) ??
    point.connectors[0];
  if (!connector) notFound();

  const planned = Number(kwh) > 0 ? Number(kwh) : AMOUNTS[0];

  const plan = await quoteCharge({
    userId: session.user.id,
    zoneId: point.gridZoneId,
    requestedKwh: planned,
    pointId: point.id,
    connectorId: connector.id,
  });

  const t = await getTranslations("app.charge");

  return (
    <Screen title={t("title")}>
      <ChargeStartForm
        locale={locale}
        point={{
          id: point.id,
          name: point.name,
          address: [point.addressLine, point.city].filter(Boolean).join(", "),
        }}
        connector={{
          id: connector.id,
          type: String(connector.type),
          powerKw: num(connector.powerKw),
        }}
        amounts={AMOUNTS}
        planned={planned}
        plan={{
          kwhFromGift: plan.kwhFromGift,
          kwhFromBalance: plan.kwhFromBalance,
          kwhFromRoaming: plan.kwhFromRoaming,
          kwhFromMarket: plan.kwhFromMarket,
          kwhFromAggregator: plan.kwhFromAggregator,
          unservedKwh: plan.unservedKwh,
          fee: plan.fee,
          total: plan.total,
          currency: plan.currency,
        }}
        labels={{
          point: t("point"),
          connector: t("connector"),
          amount: t("amount"),
          breakdown: t("breakdown"),
          fromGift: t("fromGift"),
          fromBalance: t("fromBalance"),
          fromRoaming: t("fromRoaming"),
          fromMarket: t("fromMarket"),
          fromAggregator: t("fromAggregator"),
          fee: t("fee"),
          total: t("total"),
          authorized: t("authorized"),
          start: t("start"),
          noLiquidity: t("noLiquidity"),
        }}
      />
    </Screen>
  );
}
```

Поле суммы авторизации в `ChargePlan` подставить настоящее (см. Task 4,
Step 4) и прокинуть его в `plan` отдельным числом.

- [x] **Step 4: Форма подтверждения**

`src/components/mobile/charge-start-form.tsx` — клиентский компонент: чипы
сумм (перезагружают страницу с `?kwh=`), таблица разбивки, кнопка «Начать
зарядку», вызывающая `startCharge` с `idempotencyKey`, созданным
`crypto.randomUUID()` один раз на монтирование (`useRef`). Строка разбивки с
нулём не печатается. При `unservedKwh > 0` вместо кнопки — `noLiquidity`.
После успеха — `router.push(\`/${locale}/app/charge\`)`.

- [x] **Step 5: Проверить сборку**

```bash
cd ~/poolwatt
npx tsc --noEmit && npm run build
```

- [x] **Step 6: Commit**

```bash
git add src/app/[locale]/app/charge src/components/mobile/charge-start-form.tsx messages
git commit -m "feat(charge): the driver sees the whole §16.6 bill before agreeing"
```

---

## Task 12: Вкладка «Зарядка»

**Files:**
- Modify: `src/app/[locale]/app/charge/page.tsx`
- Create: `src/components/mobile/charge-live.tsx`
- Create: `src/components/mobile/nearby-points.tsx`

- [x] **Step 1: Живой ход зарядки**

`src/components/mobile/charge-live.tsx` — клиентский компонент: крупная цифра
`deliveredKwh`, мощность последнего тика, время с `startedAt`, стоимость,
кнопки «Завершить» (вызывает `stopCharge`) и «Сообщить о проблеме» (ссылка на
`/{locale}/c/{pointId}/report`). Подписка — тем же `useChannel` на
`walletChannel(userId)`; обрабатываются типы `charge.tick` и
`charge.completed`, `charge.completed` ведёт на чек. Пока `ocppOpen` закрыт,
под кнопкой «Завершить» печатается `stopHint`.

- [x] **Step 2: Ближайшие пункты**

`src/components/mobile/nearby-points.tsx` — клиентский компонент: просит
`navigator.geolocation.getCurrentPosition`, дёргает `/api/chargers?south=…`
по рамке вокруг себя, показывает до пяти наших пунктов (`poolwattPointId`
непустой) с расстоянием, ценой и ссылкой на `/app/charge/start?p=…`. Отказ в
геолокации — печатается `nearbyHelp`, экран не ломается.

- [x] **Step 3: Переписать вкладку**

`src/app/[locale]/app/charge/page.tsx`:

```tsx
// §22.9 «Зарядка и навигатор» — вкладка, с которой водитель начинает
// зарядку: живой сеанс, если он есть, иначе QR, код руками и ближайшие
// пункты.

import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { readActiveSession } from "@/lib/exchange/charge-session";
import { walletChannel } from "@/lib/exchange/realtime";
import { Screen } from "@/components/mobile/screen";
import { ChargeLive } from "@/components/mobile/charge-live";
import { ChargeEntry } from "@/components/mobile/charge-entry";

export const dynamic = "force-dynamic";

export default async function ChargeScreen({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("app.charge");

  const session = await auth();
  const active = session?.user ? await readActiveSession(session.user.id) : null;

  return (
    <Screen title={t("title")}>
      {active ? (
        <ChargeLive
          locale={locale}
          initial={active}
          channel={walletChannel(session!.user.id)}
          labels={{
            live: t("live"),
            delivered: t("delivered"),
            power: t("power"),
            elapsed: t("elapsed"),
            cost: t("cost"),
            stop: t("stop"),
            stopHint: t("stopHint"),
            report: t("report"),
            receipt: t("receipt"),
            done: t("done"),
          }}
        />
      ) : (
        <ChargeEntry
          locale={locale}
          labels={{
            scan: t("scan"),
            manual: t("manual"),
            manualHint: t("manualHint"),
            submit: t("submit"),
            denied: t("denied"),
            notOurs: t("notOurs"),
            nearby: t("nearby"),
            nearbyHelp: t("nearbyHelp"),
          }}
        />
      )}
    </Screen>
  );
}
```

`src/components/mobile/charge-entry.tsx` — клиентская обёртка: `QrScan` плюс
`NearbyPoints`; найденный код ведёт на
`/{locale}/app/charge/start?p=<pointId>&c=<connectorId>`.

- [x] **Step 4: Собрать и посмотреть глазами**

```bash
cd ~/poolwatt
npm run build && pm2 restart poolwatt-web
curl -s -o /dev/null -w '%{http_code}\n' https://poolwatt.com/ru/app/charge
```

Ожидание: 200.

- [x] **Step 5: Commit**

```bash
git add src/app/[locale]/app/charge src/components/mobile
git commit -m "feat(charge): the charge tab is a session, a QR and what is near"
```

---

## Task 13: QR для печати в кабинете оператора

**Files:**
- Create: `src/app/[locale]/me/charger-operator/[id]/points/[pointId]/qr/page.tsx`

- [x] **Step 1: Страница**

Серверная страница: проверяет, что подписанный пользователь — владелец этой
сети (так же, как это делает соседняя
`src/app/[locale]/me/charger-operator/[id]/points/[pointId]/page.tsx`), и для
каждого разъёма печатает тип, мощность, код `buildConnectorCode(pointId,
connectorId)` и его QR. QR рисуется на сервере через `qrcode`:

```ts
import QRCode from "qrcode";

const svg = await QRCode.toString(buildConnectorCode(point.id, connector.id), {
  type: "svg",
  margin: 1,
});
```

и вставляется через `dangerouslySetInnerHTML` — то же, что уже делает чек
§46 (посмотреть, как это написано там, и повторить).

Класс печати: `@media print` скрывает навигацию, каждый разъём — на своём
листе.

- [x] **Step 2: Проверить**

```bash
cd ~/poolwatt
npm run build && pm2 restart poolwatt-web
```

- [x] **Step 3: Commit**

```bash
git add "src/app/[locale]/me/charger-operator/[id]/points/[pointId]/qr"
git commit -m "feat(charge): an operator prints a QR for every connector"
```

---

## Task 14: e2e на Pixel 7

**Files:**
- Create: `tests/e2e/mobile-charge.mobile.spec.ts`

Образец — `tests/e2e/mobile-wallet.mobile.spec.ts`: там уже есть вход в
аккаунт, подготовка данных и уборка за собой.

- [x] **Step 1: Написать тест**

Сценарий одного случая (остальные — по образцу файла кошелька):

1. Подготовка через Prisma: сеть, опубликованный пункт в зоне с ликвидной
   книгой, разъём `FREE`, ключ пункта с секретом подписи, у водителя кошелёк
   с 30 кВт·ч.
2. Вход, переход на `/ru/app/charge`.
3. Ввод кода разъёма в `qr-manual`, нажатие `qr-manual-submit`.
4. На экране расчёта видно «Свой баланс 10.000» и «Итого».
5. Нажатие «Начать зарядку» — экран зарядки показывает `delivered` 0.000.
6. Подписанный `POST /v1/charge-sessions/{id}/meter` с `kwhTotal: 4.5`
   (подпись собрать `signCanonical` + `restCanonicalString`, как это делает
   e2e телеметрии).
7. На экране без перезагрузки появляется 4.500.
8. Нажатие «Завершить» — виден чек, в нём 4.500 кВт·ч.
9. Уборка: удалить сеанс, платёж, чек, пункт, сеть, кошелёк.

- [x] **Step 2: Запустить**

```bash
cd ~/poolwatt
npx playwright test tests/e2e/mobile-charge.mobile.spec.ts --project=mobile
```

Ожидание: все passed. `poolwatt-web` должен быть online (`pm2 status`).

- [x] **Step 3: Commit**

```bash
git add tests/e2e/mobile-charge.mobile.spec.ts
git commit -m "test(charge): a session from the code to the receipt on a Pixel 7"
```

---

## Task 15: Разрешение камеры в оболочках и сборка

**Files:**
- Modify: `~/poolwatt-android/android/app/src/main/AndroidManifest.xml` (другой репозиторий)

- [x] **Step 1: Камера в манифесте Android**

```bash
grep -n 'CAMERA' ~/poolwatt-android/android/app/src/main/AndroidManifest.xml
```

Если нет — добавить рядом с остальными `uses-permission`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-feature android:name="android.hardware.camera" android:required="false" />
```

Закоммитить в репозитории `~/poolwatt-android`.

- [x] **Step 2: Собрать APK**

```bash
/home/dv/bin/android-build
```

Ожидание: печатает адреса загрузки; номер сборки на единицу больше прежнего.

- [x] **Step 3: iOS — строка о камере**

`NSCameraUsageDescription` в `Info.plist` репозитория на Маке. Проверить
сборку симулятора:

```bash
/home/dv/bin/mac-ios --lane build_sim
```

Если тоннель до Мака лежит — записать это в отчёт и в трекер как
незакрытый хвост, остальное не блокируется: оболочка открывает живой сайт,
и экран зарядки на TestFlight-сборке уже работает, только камера без
строки в plist не включится.

- [x] **Step 4: Весь набор тестов перед выкладкой**

```bash
cd ~/poolwatt
NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local \
  | tr -d '"' | sed 's|/poolwatt?|/poolwatt_test?|')" npx vitest run
npm run test:e2e
```

Ожидание: всё зелёное. Числа записать в отчёт.

- [x] **Step 5: Обновить трекер и доложить**

В `inbox/TZ-STATUS.md`: US-20 переносится в «Готово» с доказательствами
(коммиты, тесты, адреса страниц, номер APK); этап M3 отмечается как «M3-а
готово, M3-б не начато»; в «Вопросы владельцу» добавляются TTL сеанса,
потолок сеанса и формат чужих QR.

---

## Самопроверка плана

**Покрытие спецификации.** Сеанс как состояние — Task 1, 4, 5, 6. Расчёт по
факту — Task 6. Резерв денег с запасом Y % — Task 4. Бронь §32.5 — Task 4
(закрытие) и Task 11 (зачёт платы печатается в разбивке; сам зачёт делает
`settleCharge`, который уже умеет это по политике пункта — проверить в
Task 6, и если не умеет, дописать строку в разбивку чека там же). Отчёт
оборудования с HMAC — Task 5, метод — Task 8. Истечение — Task 6, воркер —
Task 9. Разбор QR — Task 2, камера — Task 10, печать кода — Task 13. Экраны —
Task 11, 12. Гейт OCPP — Task 3. Живой канал — Task 5 (`notifyChargeSession`).
Одновременность — Task 7. e2e — Task 14. Оболочки — Task 15.

**Чего в плане нет намеренно:** карта §27, фильтры §27, карточка §28 под
телефон, отзывы, история доступности, продление брони с телефона — это
этап M3-б, отдельный план.

---

## Где работа разошлась с планом

- **Task 5/6 писались не строго тестом вперёд.** Сервис сеанса получился одним
  файлом целиком, а тесты на отчёт счётчика и расчёт пришли следом. Тесты
  авторизации (Task 4) и гонок (Task 7) — по порядку.
- **Ступень агрегатора §16.7 оказалась ложной.** В плане её не было: расчёт её
  считал, а списание не исполняло. Появился гейт `aggregatorOpen`, и один
  случай в `roaming-flow.test.ts`, который на этой ступени держался, получил
  настоящую книгу. Это не доделка плана, а исправление существующей ошибки.
- **Монотонность счётчика пришлось переносить под блокировку строки.** План
  проверял её до транзакции; тест на два одновременных отчёта показал, что так
  больший результат затирается меньшим.
- **`SETTLING` в перечислении не появился.** Гонку двух завершений решает
  блокировка строки сеанса: проигравший видит статус вне живых и возвращает
  готовое.
- **Ключ пункта в e2e создаётся прямой записью в базу, без секрета подписи.**
  Playwright запускается не как модуль приложения, и `issuePointKey` в него не
  импортируется. Ветка с подписью HMAC закрыта юнит-тестами.
- **`jsqr` вместо нативного плагина.** Как и в спецификации; плагина не
  потребовалось, но Android-манифесту нужно разрешение камеры, а iOS —
  `NSCameraUsageDescription`. Оба добавлены в своих репозиториях.
- **Экран `/app/charge/[id]` не понадобился.** Законченный сеанс показывается
  карточкой на самой вкладке со ссылкой на чек; отдельный адрес был бы
  страницей, на которую никто не заходит.
