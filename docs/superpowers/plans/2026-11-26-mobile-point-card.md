# M3-б-2 — полная карточка §28, отзывы, фото, история, бронь Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/{locale}/app/c/[id]` — полная карточка пункта приёма под телефон со всеми блоками §28, фотографиями, отзывами и историей доступности; и `/{locale}/app/bookings` — брони с продлением US-31 с телефона.

**Architecture:** Один читатель карточки `readPointCard` на обе карточки — мобильную и на монитор, чтобы про §28 не было двух правд. Занятость разъёмов меняют пять мест; все они переходят на единственного писателя `setConnectorStatus`, который и ведёт журнал. Отзыв имеет право оставить тот, кто там заряжался: приезд уже записан в базе. Фотографии лежат вне веб-корня, как документы листинга.

**Tech Stack:** Next.js 16, Prisma 5 (две новые таблицы), vitest, Playwright (`mobile`, Pixel 7).

Спецификация: `docs/superpowers/specs/2026-11-26-mobile-navigator-design.md`, раздел «M3-б-2».

**Как запускать тесты** (иначе они пойдут в живую базу):

```bash
cd ~/poolwatt
NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local | tr -d '"' \
  | sed 's|/poolwatt?|/poolwatt_test?|')" npx vitest run <путь>
```

После миграции накатить её и на `poolwatt_test`:

```bash
NODE_ENV=test DATABASE_URL="…poolwatt_test…" npx prisma migrate deploy
```

---

## Файлы

| Файл | За что отвечает |
| --- | --- |
| `prisma/schema.prisma` (изменить) | `ConnectorStatusLog`, `PointReview` |
| `src/lib/points/connector-status.ts` (создать) | единственный писатель занятости разъёма + журнал |
| `src/lib/points/connector-status.test.ts` (создать) | запись только при настоящей смене, пять источников, чистка |
| `src/lib/points/availability-history.ts` (создать) | доля времени «свободен» по дням за семь дней |
| `src/lib/points/availability-history.test.ts` (создать) | перенос состояния через границу суток, пустой журнал |
| `src/lib/exchange/charge-session.ts`, `src/lib/reservations/reservation-service.ts`, `src/lib/work/ticket-service.ts`, `src/lib/points/point-availability.ts` (изменить) | перейти на `setConnectorStatus` |
| `src/lib/points/point-reviews.ts` (создать) | право на отзыв, запись, средняя, последние |
| `src/lib/points/point-reviews.test.ts` (создать) | без приезда нельзя, один на человека, переписать свой, средняя |
| `src/lib/points/point-photos.ts` (создать) | хранение файлов фотографий §28 |
| `src/lib/points/point-photos.test.ts` (создать) | тип по байтам, пределы, удаление |
| `src/app/api/v1/points/[id]/photos/route.ts` (создать) | загрузка владельцем |
| `src/app/api/v1/points/[id]/photos/[photoId]/route.ts` (создать) | отдача файла, права |
| `src/lib/points/point-card.ts` (создать) | §28 одним объектом + три правила видимости |
| `src/lib/points/point-card.test.ts` (создать) | каждый блок §28, видимость, 404 |
| `src/app/[locale]/app/c/[id]/page.tsx` (создать) | мобильная карточка |
| `src/components/points/point-card-blocks.tsx` (создать) | блоки §28, общие для двух карточек |
| `src/components/points/photo-gallery.tsx` (создать) | лента фотографий |
| `src/components/points/review-form.tsx` (создать) | оценка и текст |
| `src/components/points/availability-strip.tsx` (создать) | семь дней доступности |
| `src/app/[locale]/app/c/[id]/actions.ts` (создать) | серверное действие отзыва |
| `src/app/[locale]/c/[id]/page.tsx` (изменить) | перейти на `readPointCard` для блоков, которых не было |
| `src/app/[locale]/app/bookings/page.tsx` (создать) | US-31 с телефона |
| `src/app/[locale]/c/[id]/book/actions.ts` (изменить) | добавить мобильные адреса в `revalidatePath` |
| `src/components/points/point-wizard.tsx` (изменить) | загрузка фотографий на шаге «адрес» |
| `worker/index.ts` (изменить) | чистка журнала доступности в 03:40 |
| `messages/{en,ru,sk}.json` (изменить) | ветки `app.point`, `app.bookings`, `review` |
| `tests/e2e/mobile-point-card.mobile.spec.ts` (создать) | карточка, отзыв, история, бронь на Pixel 7 |

---

### Task 1: журнал занятости разъёма

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/lib/points/connector-status.ts`, `src/lib/points/connector-status.test.ts`
- Modify: четыре файла, которые пишут `pointConnector.status`

- [x] **Step 1: Add the table**

В `prisma/schema.prisma`, рядом с `PointConnector`:

```prisma
// §27 «история доступности», §29.7 «статус обновляется автоматически».
// Занятость разъёма меняют пять мест; все они идут через
// `setConnectorStatus`, и запись появляется только когда состояние
// действительно изменилось — иначе оборудование, которое отчитывается раз в
// минуту, за сутки нарисует тысячу четыреста строк «всё так же свободно».
model ConnectorStatusLog {
  id          String          @id @default(cuid())
  connectorId String
  connector   PointConnector  @relation(fields: [connectorId], references: [id], onDelete: Cascade)
  // Денормализовано: карточка читает журнал по пункту, а не по разъёму.
  pointId     String
  status      ConnectorStatus
  at          DateTime        @default(now())
  /** equipment | booking | booking-release | session-start | session-end | ticket */
  source      String

  @@index([pointId, at])
  @@index([connectorId, at])
}
```

и в `PointConnector` — `statusLog ConnectorStatusLog[]`.

- [x] **Step 2: Migrate**

```bash
npx prisma migrate dev --name connector_status_log --create-only
npx prisma migrate deploy
NODE_ENV=test DATABASE_URL="…poolwatt_test…" npx prisma migrate deploy
npx prisma generate
```

- [x] **Step 3: Write the failing test**

`src/lib/points/connector-status.test.ts` проверяет:

1. смена `UNKNOWN → FREE` пишет строку с источником и временем;
2. повторный тот же статус строку **не** пишет и `statusAt` не трогает;
3. строка несёт `pointId` того пункта, которому разъём принадлежит;
4. `purgeConnectorStatusLog` удаляет записи старше 30 дней и возвращает число;
5. вызов внутри транзакции виден в ней же (функция принимает `Db`).

- [x] **Step 4: Implement**

`src/lib/points/connector-status.ts`:

```ts
import { ConnectorStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Db } from "@/lib/exchange/audit";

export type StatusSource =
  | "equipment"
  | "booking"
  | "booking-release"
  | "session-start"
  | "session-end"
  | "ticket";

/**
 * Единственный путь, которым меняется занятость разъёма. Запись в журнал
 * появляется только при настоящей смене состояния.
 */
export async function setConnectorStatus(
  db: Db,
  connectorId: string,
  status: ConnectorStatus,
  source: StatusSource,
  at: Date = new Date(),
): Promise<boolean> {
  const row = await db.pointConnector.findUnique({
    where: { id: connectorId },
    select: { id: true, pointId: true, status: true },
  });
  if (!row) return false;
  if (row.status === status) return false;

  await db.pointConnector.update({
    where: { id: connectorId },
    data: { status, statusAt: at },
  });
  await db.connectorStatusLog.create({
    data: { connectorId, pointId: row.pointId, status, at, source },
  });
  return true;
}

/** Журнал нужен карточке на семь дней; держим тридцать и чистим. */
export const LOG_KEEP_DAYS = 30;

export async function purgeConnectorStatusLog(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - LOG_KEEP_DAYS * 86_400_000);
  const { count } = await prisma.connectorStatusLog.deleteMany({
    where: { at: { lt: cutoff } },
  });
  return count;
}
```

- [x] **Step 5: Move the five call sites onto it**

- `src/lib/exchange/charge-session.ts:271` → `await setConnectorStatus(tx, connector.id, ConnectorStatus.BUSY, "session-start")`
- `src/lib/exchange/charge-session.ts:476` → `await setConnectorStatus(tx, session.connectorId, ConnectorStatus.FREE, "session-end", now)`
- `src/lib/reservations/reservation-service.ts:290` → `"booking"`, `BOOKED`
- `src/lib/reservations/reservation-service.ts:453` → `"booking-release"`, `FREE`
- `src/lib/work/ticket-service.ts:134` → `"ticket"`, `OUT_OF_SERVICE`
- `src/lib/points/point-availability.ts` — вместо `prisma.pointConnector.update` звать `setConnectorStatus(prisma, row.id, status, "equipment", now)`; счётчик `updated` считает только настоящие смены (функция возвращает `boolean`), и это ровно то, что должен означать «обновлено».

- [x] **Step 6: Run the touched suites**

Run: `NODE_ENV=test DATABASE_URL="…poolwatt_test…" npx vitest run src/lib/points src/lib/reservations src/lib/exchange/charge-session src/lib/work`
Expected: PASS. Случай `point-availability.test.ts`, который ждёт `updated: N` на повторный тот же статус, нужно поправить по существу: повтор ничего не обновляет.

- [x] **Step 7: Worker purge**

В `worker/index.ts` — рядом с `runIdempotencyPurge`:

```ts
export async function runConnectorLogPurge(): Promise<void> {
  const removed = await purgeConnectorStatusLog();
  if (removed > 0) log(`connector status log: purged ${removed} row(s)`);
}
```

и в задании 03:40 вызвать её после чистки идемпотентности. Строку `log(...)`
со списком расписаний дописать.

- [x] **Step 8: Commit**

```bash
git add prisma src/lib/points/connector-status.ts src/lib/points/connector-status.test.ts \
  src/lib/exchange/charge-session.ts src/lib/reservations/reservation-service.ts \
  src/lib/work/ticket-service.ts src/lib/points/point-availability.ts worker/index.ts
git commit -m "feat(points): one writer for a connector's occupancy, and a log of it"
```

---

### Task 2: доля времени «свободен» по дням

**Files:**
- Create: `src/lib/points/availability-history.ts`, `src/lib/points/availability-history.test.ts`

- [x] **Step 1: Write the failing test**

Случаи:

1. разъём был свободен сутки целиком — доля 1;
2. освободился в полдень после «занят» — доля 0.5 за этот день;
3. состояние на начало окна берётся из последней записи **до** него;
4. журнала нет вовсе — `null` за каждый день, а не ноль: «мы не знаем» это не «не был свободен»;
5. семь дней подряд, последний — сегодняшний неполный, считается до «сейчас».

- [x] **Step 2: Implement**

`src/lib/points/availability-history.ts`:

```ts
import { ConnectorStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface DayShare {
  /** Начало суток в UTC. */
  day: string;
  /** Доля времени «свободен», 0…1; null — за этот день мы ничего не знаем. */
  freeShare: number | null;
}

export interface ConnectorHistory {
  connectorId: string;
  type: string;
  days: DayShare[];
  lastChange: { status: ConnectorStatus; at: string } | null;
}

export const HISTORY_DAYS = 7;

export async function readAvailabilityHistory(
  pointId: string,
  now = new Date(),
): Promise<ConnectorHistory[]> { … }
```

Правило расчёта: окно — `HISTORY_DAYS` суток, выровненных по UTC-полуночи,
последние сутки обрезаны по `now`. Для каждого разъёма берётся последняя
запись до начала окна (состояние на входе) и все записи внутри; доля
считается перебором отрезков. Нет ни входного состояния, ни записей — день
получает `null`.

- [x] **Step 3: Run the test**

Expected: PASS, 5 cases.

- [x] **Step 4: Commit**

```bash
git add src/lib/points/availability-history.ts src/lib/points/availability-history.test.ts
git commit -m "feat(points): how much of each day a connector was actually free"
```

---

### Task 3: отзывы

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/lib/points/point-reviews.ts`, `src/lib/points/point-reviews.test.ts`

- [x] **Step 1: Add the table**

```prisma
// §27 «Полная карточка: … отзывы». Отзыв оставляет тот, кто там заряжался
// или чья бронь была исполнена: отзыв, не привязанный ни к одному приезду, —
// это способ испортить чужую карточку, а приезд у нас уже в базе. Один на
// человека и пункт, свой можно переписать.
model PointReview {
  id        String          @id @default(cuid())
  pointId   String
  point     AcceptancePoint @relation(fields: [pointId], references: [id], onDelete: Cascade)
  userId    String
  user      User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  rating    Int
  text      String?         @db.Text
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt

  @@unique([pointId, userId])
  @@index([pointId, createdAt])
}
```

и обратные связи в `AcceptancePoint` (`reviews PointReview[]`) и `User`
(`pointReviews PointReview[]`).

- [x] **Step 2: Migrate**

```bash
npx prisma migrate dev --name point_review --create-only
npx prisma migrate deploy
NODE_ENV=test DATABASE_URL="…poolwatt_test…" npx prisma migrate deploy
npx prisma generate
```

- [x] **Step 3: Write the failing test**

Случаи `point-reviews.test.ts`:

1. человек без приезда получает отказ `no_visit`;
2. завершённый сеанс (`ChargeSession.status = COMPLETED`) даёт право;
3. исполненная бронь (`Reservation.status = FULFILLED`) даёт право;
4. начатый, но не завершённый сеанс права не даёт;
5. второй отзыв того же человека переписывает первый, а не добавляется;
6. оценка вне 1…5 — отказ `bad_rating`;
7. средняя и число считаются по всем отзывам пункта;
8. у пункта без отзывов средняя `null`, а не ноль.

- [x] **Step 4: Implement**

`src/lib/points/point-reviews.ts`:

```ts
export type ReviewResult =
  | { ok: true; reviewId: string }
  | { ok: false; reason: "no_visit" | "bad_rating" | "no_point" };

export async function mayReview(userId: string, pointId: string): Promise<boolean>;
export async function saveReview(args: {
  userId: string;
  pointId: string;
  rating: number;
  text: string | null;
}): Promise<ReviewResult>;
export async function readReviews(
  pointId: string,
  take?: number,
): Promise<{
  average: number | null;
  count: number;
  rows: { id: string; author: string; rating: number; text: string | null; at: string }[];
}>;
export async function readMyReview(
  userId: string,
  pointId: string,
): Promise<{ rating: number; text: string | null } | null>;
```

`mayReview` — один запрос на каждое из двух оснований; `saveReview` —
`upsert` по `[pointId, userId]`, текст обрезается до 1000 знаков; автор в
`readReviews` — `user.name ?? user.username`.

- [x] **Step 5: Run the test**

Expected: PASS, 8 cases.

- [x] **Step 6: Commit**

```bash
git add prisma src/lib/points/point-reviews.ts src/lib/points/point-reviews.test.ts
git commit -m "feat(points): a review from the driver who actually charged there"
```

---

### Task 4: фотографии пункта

**Files:**
- Create: `src/lib/points/point-photos.ts`, `src/lib/points/point-photos.test.ts`
- Create: `src/app/api/v1/points/[id]/photos/route.ts`
- Create: `src/app/api/v1/points/[id]/photos/[photoId]/route.ts`
- Modify: `src/components/points/point-wizard.tsx`

- [x] **Step 1: Write the failing test**

Случаи `point-photos.test.ts` (по образцу `listing-docs.test.ts`):

1. JPEG, PNG и WebP узнаются по первым байтам;
2. файл, который называет себя JPEG, а внутри PDF, отвергается;
3. больше 5 МБ — отказ;
4. одиннадцатая фотография — отказ `too_many`;
5. удаление убирает и строку, и файл;
6. `photoPath` не выходит за корень при подставленном в имя `../`.

- [x] **Step 2: Implement the storage**

`src/lib/points/point-photos.ts` — тот же каркас, что `listing-docs.ts`:
корень `process.env.POINT_PHOTOS_DIR || "var/point-photos"`, имя файла из
`randomBytes`, `sniffMime` на три типа изображений, `MAX_PHOTO_BYTES = 5 МБ`,
`MAX_PHOTOS = 10`, функции `savePointPhoto`, `readPointPhoto`,
`deletePointPhoto`, `listPointPhotos`.

- [x] **Step 3: The two routes**

- `POST /api/v1/points/[id]/photos` — `multipart/form-data`, только владелец
  сети пункта или его сотрудник с правом на этот пункт (та же проверка, что
  в мастере пункта); 201 с `{ photoId }`.
- `GET /api/v1/points/[id]/photos/[photoId]` — отдаёт байты с
  `Content-Type` из строки и `Cache-Control: private, max-age=3600`.
  Опубликованный публичный пункт — всем; `COOP_MEMBERS` — члену кооператива;
  `OWN_CLIENTS` и неопубликованный — владельцу и сотрудникам. Иначе 404.
- `DELETE /api/v1/points/[id]/photos/[photoId]` — владельцу.

- [x] **Step 4: The wizard**

На шаге «адрес и карта» (§29.1 просит фото там) — `input type=file multiple
accept="image/*"`, список уже загруженных с кнопкой удаления, счётчик «N из
10». Загрузка идёт сразу при выборе файла: черновик пункта уже существует,
поэтому `id` есть.

- [x] **Step 5: Run the test and build**

Run: `NODE_ENV=test DATABASE_URL="…poolwatt_test…" npx vitest run src/lib/points/point-photos.test.ts`
Expected: PASS, 6 cases.
Run: `npm run build`
Expected: no errors.

- [x] **Step 6: Commit**

```bash
git add src/lib/points/point-photos.ts src/lib/points/point-photos.test.ts \
  src/app/api/v1/points src/components/points/point-wizard.tsx
git commit -m "feat(points): the photos §28 asks for, filled at last"
```

---

### Task 5: один читатель карточки §28

**Files:**
- Create: `src/lib/points/point-card.ts`, `src/lib/points/point-card.test.ts`
- Modify: `src/app/[locale]/c/[id]/page.tsx`

- [x] **Step 1: Write the failing test**

Случаи `point-card.test.ts`:

1. каждый блок §28 приходит: владелец с контактами, тип, адрес с «как
   найти», источник с гарантией происхождения, оборудование с ёмкостью,
   все тарифные окна с помеченным действующим, плата за простой, скидка
   кооператива, режим работы по дням, праздники, временное закрытие,
   способы оплаты, удобства, видимость, бренд;
2. неопубликованный пункт — `null`;
3. `COOP_MEMBERS`: члену кооператива — карточка, прочему — `null`;
4. `OWN_CLIENTS`: гостю — `null`;
5. фотографии приходят только как `photoId`, не как байты;
6. средняя оценка и число отзывов приходят вместе с карточкой.

- [x] **Step 2: Implement**

`readPointCard(pointId, viewerId)` → `PointCardView | null`. Один запрос с
`include` по разъёмам, тарифам, фотографиям и оператору; отзывы и история —
своими функциями, чтобы карточку можно было отрисовать и без них.

- [x] **Step 3: Switch the desktop card over**

`/{locale}/c/[id]` оставляет свой нынешний каркас и получает блоки, которых
у него не было, из `readPointCard`: часы по дням, праздники, временное
закрытие, способы оплаты, удобства, источник энергии с гарантией, все
тарифные окна, фотографии, отзывы, история. Чтобы разметку не писать дважды,
блоки живут в `src/components/points/point-card-blocks.tsx` и обе страницы
зовут их.

- [x] **Step 4: Run the test and build**

Expected: PASS, 6 cases; сборка без ошибок; `/ru/c/<id>` отвечает 200.

- [x] **Step 5: Commit**

```bash
git add src/lib/points/point-card.ts src/lib/points/point-card.test.ts \
  src/components/points/point-card-blocks.tsx src/app/[locale]/c/[id]/page.tsx
git commit -m "feat(points): §28 has one reader, and both cards use it"
```

---

### Task 6: мобильная карточка

**Files:**
- Create: `src/app/[locale]/app/c/[id]/page.tsx`, `src/app/[locale]/app/c/[id]/actions.ts`
- Create: `src/components/points/photo-gallery.tsx`, `src/components/points/review-form.tsx`, `src/components/points/availability-strip.tsx`
- Modify: `src/components/mobile/point-mini-card.tsx` (ссылка «Подробнее» ведёт на мобильную карточку)
- Modify: `messages/{en,ru,sk}.json`

- [x] **Step 1: The screen**

Одна колонка: фото-лента, заголовок с типом и доступностью, адрес и «как
найти», действия (маршрут, зарядиться, забронировать, сообщить о проблеме
§51), тарифы, оборудование, режим работы, оплата, удобства, источник,
владелец и контакты, отзывы, история доступности. Блоки — из
`point-card-blocks.tsx`, те же, что на мониторе.

- [x] **Step 2: The review form**

`review-form.tsx` — пять звёзд и текст. Видна только тому, у кого есть
право (`mayReview`); у остальных вместо формы одна строка «отзыв оставляет
тот, кто здесь заряжался». Свой отзыв подставлен в форму и переписывается.

- [x] **Step 3: The availability strip**

`availability-strip.tsx` — семь столбиков на разъём: высота = доля времени
«свободен», день без данных — пустой контур, не нулевой столбик. Подпись —
последнее изменение с временем.

- [x] **Step 4: Build and check**

Run: `npm run build && pm2 restart poolwatt-web`
Then: `curl -s -o /dev/null -w '%{http_code}\n' https://poolwatt.com/ru/app/c/<id>`
Expected: `200`; чужой `COOP_MEMBERS`-пункт — `404`.

- [x] **Step 5: Commit**

```bash
git add src/app/[locale]/app/c src/components/points messages src/components/mobile/point-mini-card.tsx
git commit -m "feat(mobile): the §28 card in one column, with photos, reviews and history"
```

---

### Task 7: брони и продление с телефона (US-31)

**Files:**
- Create: `src/app/[locale]/app/bookings/page.tsx`
- Modify: `src/app/[locale]/c/[id]/book/actions.ts`
- Modify: `src/lib/mobile/tabs.ts` (раздел «брони» в хабе)
- Modify: `messages/{en,ru,sk}.json`

- [x] **Step 1: The screen**

Список моих броней: пункт, разъём, окно, статус, штраф за неявку, если был.
Кнопки «Продлить» (когда политика пункта это разрешает и продлений не
исчерпано) и «Отменить» — те же серверные действия, что в кабинете.

- [x] **Step 2: Revalidate the mobile paths too**

В `src/app/[locale]/c/[id]/book/actions.ts` добавить к каждому
`revalidatePath` мобильный адрес: `/[locale]/app/bookings` и
`/[locale]/app/c/[id]`.

- [x] **Step 3: Add the hub entry**

`MobileSection` получает `"bookings"` первым после станции и кооператива;
`SECTION_HREF` — `/bookings`. Поправить `tabs.test.ts`.

- [x] **Step 4: Build and check**

Run: `npm run build && pm2 restart poolwatt-web`
Then: `curl -s -o /dev/null -w '%{http_code}\n' https://poolwatt.com/ru/app/bookings`
Expected: `307` (гостя уводит на вход) или `200` для вошедшего.

- [x] **Step 5: Commit**

```bash
git add src/app/[locale]/app/bookings src/app/[locale]/c/[id]/book/actions.ts \
  src/lib/mobile/tabs.ts src/lib/mobile/tabs.test.ts messages
git commit -m "feat(mobile): a driver running late extends the booking from the phone"
```

---

### Task 8: e2e, вся проверка, APK, реестр

**Files:**
- Create: `tests/e2e/mobile-point-card.mobile.spec.ts`

- [x] **Step 1: Write the e2e**

Случаи на Pixel 7 против живого домена:

1. карточка пункта показывает блоки §28: тарифное окно, часы, оплату,
   удобства, источник, контакты владельца;
2. фотография отдаётся по своему адресу (200 и `image/*`);
3. водитель с завершённым сеансом ставит четыре звезды и видит отзыв и
   среднюю;
4. человек без приезда формы не видит;
5. история доступности рисует семь дней;
6. бронь продлевается с `/ru/app/bookings`, окно сдвигается;
7. карточка пункта «только для членов кооператива» для постороннего — 404.

- [x] **Step 2: The whole unit suite**

Run:
```bash
NODE_ENV=test DATABASE_URL="…poolwatt_test…" npx vitest run
```
Expected: зелено.

- [x] **Step 3: The whole e2e suite**

Run: `npm run test:e2e`
Expected: зелено.

- [x] **Step 4: APK**

Run: `/home/dv/bin/android-build`

- [x] **Step 5: Tick this plan, update `inbox/TZ-STATUS.md`, commit**

---

## Где работа ушла от плана

- **Правило видимости стало своим модулем.** План держал его внутри
  `point-card.ts`, но маршрут отдачи фотографий нужен тому же правилу, а
  карточка на тот момент ещё не существовала. Получился
  `src/lib/points/point-visibility.ts`: три случая §28 плюс §29.3
  (неопубликованную карточку видит только её сеть) и §47 (сотрудник — только
  разрешённые пункты). Отказ выглядит как «нет такой карточки».
  6 случаев `point-visibility.test.ts`.
- **«Свой клиент» — это приезд, а не карта.** §28 называет третью видимость
  «только для своих клиентов (white label)», но карты white label у нас нет
  (§19 ждёт EMI). Признаком служит настоящий приезд в эту сеть: списанный
  платёж или исполненная бронь.
- **Подписи разделены на плоские и словари.** `Record<string, string> &
  { weekday: Record<string, string> }` TypeScript считает несовместимым, и
  правильно считает: `PointLabels` держит строки в `t`, словари рядом.
- **Карточка на монитор переведена целиком.** План обещал дописать ей
  «блоки, которых не было»; на деле у неё почти ничего из §28 и не было,
  поэтому она рисует те же компоненты, что телефонная, а прежняя разметка
  осталась только для пина OpenStreetMap, у которого §28 нет вовсе.
- **`updated` в отчёте оборудования оставлен как был.** Он считает принятые
  отчёты, а не смены состояния: оборудованию важно услышать, сколько его
  слов мы взяли в расчёт. Журнал при этом молчит, когда разъём «всё так же
  свободен», а `lastSeenAt` пункта обновляется — связь жива.
- **Фотографию в e2e кладёт `fs`, а не служба.** Playwright грузит файл теста
  как CommonJS и `await import` модуля из `src/` в нём падает; тест пишет
  байты туда, где их ищет маршрут отдачи.
- **Удобства на карточке по-прежнему чипами.** Отдельный компонент
  `photo-gallery.tsx`, `availability-strip.tsx` из плана не появился: все
  блоки §28 живут в одном `point-card-blocks.tsx`. Разносить их по файлам
  смысла нет — они всегда рисуются вместе и не используются отдельно.

## Доказательство

- 1588 юнит-тестов и 142 e2e зелёные на живой сборке; из e2e семь новых на
  Pixel 7 через настоящий домен (`tests/e2e/mobile-point-card.mobile.spec.ts`).
- `https://poolwatt.com/ru/app/c/<id>` и `https://poolwatt.com/ru/c/<id>`
  показывают одни и те же блоки §28 (`card-tariffs`, `card-equipment`,
  `card-hours`, `card-payment`, `card-amenities`, `card-source`,
  `card-history`, `card-reviews`, `card-owner`); чужая карточка — 404; пин
  OpenStreetMap (`/ru/c/g1`) по-прежнему 200.
- `/ru/app/bookings` уводит гостя на вход (307) и показывает брони вошедшему.
- APK build 8: `https://poolwatt.com/downloads/poolwatt-build-8.apk`.
