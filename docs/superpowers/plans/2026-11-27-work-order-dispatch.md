# Наряд: ручное создание, подбор по региону и загрузке, бригада — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** закрыть часть N-3-б — наряд §48 создаётся вручную диспетчером,
подбирается инженеру или бригаде с учётом региона и загрузки, и доходит до
человека сам, когда родился из аварии.

**Architecture:** регион — список городов на `Employee` и на новой `Crew`
(пусто = вся сеть); загрузка — число открытых нарядов, для бригады максимум по
её людям; подбор — отдельный модуль `assignment.ts`, который ничего не пишет;
назначение исключающее (человек **или** бригада) и остаётся в
`work-order-service.ts`; рабочее место диспетчера — новая страница кабинета
сети.

**Tech Stack:** Next.js 16 (App Router, server actions), Prisma, Postgres,
vitest, Playwright, next-intl.

Спецификация: `docs/superpowers/specs/2026-11-27-work-order-dispatch-design.md`.

Тесты всегда против выбрасываемой базы:

```bash
cd ~/poolwatt
NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local \
  | tr -d '"' | sed 's|/poolwatt?|/poolwatt_test?|')" npx vitest run <файл>
```

---

## Файлы

| Файл | Ответственность |
| --- | --- |
| `prisma/schema.prisma` | `Employee.regions`, `Crew`, `CrewMember`, `WorkOrder.crewId` |
| `src/lib/work/assignment.ts` (создать) | загрузка и порядок подбора; только чтение |
| `src/lib/work/assignment.test.ts` (создать) | загрузка, три ступени, права, область пунктов |
| `src/lib/work/crew-service.ts` (создать) | бригада: создать, состав, регионы, старший |
| `src/lib/work/crew-service.test.ts` (создать) | чужая сеть, чужой сотрудник, две бригады |
| `src/lib/work/work-order-service.ts` | назначение бригаде, `autoAssign`, письмо бригаде |
| `src/lib/work/work-order-access.ts` | участник назначенной бригады работает в наряде |
| `src/lib/warehouse/engineer-view.ts` | наряды бригады в списке телефона |
| `src/app/[locale]/me/work-orders/page.tsx` | наряды бригады в списке кабинета |
| `src/app/api/v1/work-orders/route.ts` (создать) | `GET`/`POST` §50 |
| `src/app/api/v1/work-orders/[id]/assign/route.ts` (создать) | `POST` назначение |
| `src/app/api/v1/work-orders/[id]/candidates/route.ts` (создать) | `GET` подбор |
| `src/app/[locale]/me/charger-operator/[id]/dispatch/page.tsx` (создать) | рабочее место диспетчера |
| `src/app/[locale]/me/charger-operator/[id]/dispatch/actions.ts` (создать) | создать наряд, назначить |
| `src/components/work/dispatch-board.tsx` (создать) | очередь, подбор, форма создания |
| `src/components/work/crew-editor.tsx` (создать) | бригады и регионы на `/staff` |
| `src/app/[locale]/me/charger-operator/[id]/staff/page.tsx` | врезка бригад и регионов |
| `messages/{en,ru,sk,de,uk}.json` | ключи `dispatch.*`, `crews.*` |
| `tests/e2e/dispatch.spec.ts` (создать) | путь диспетчера на живой сборке |

---

### Задача 1: схема и миграция

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_work_order_dispatch/migration.sql` (генерируется)

- [x] **Шаг 1: поля и таблицы**

В `model Employee` добавить рядом с `pointIds`:

```prisma
  /// §48 «с учётом региона» — города, которые закрывает этот инженер.
  /// Пусто значит вся сеть, как у `pointIds` выше.
  regions    String[]
  crews      CrewMember[]
```

В `model WorkOrder` рядом с `assignee`:

```prisma
  /// §48 «назначение инженеру **или** бригаде»: заполнено ровно одно из двух.
  crewId     String?
  crew       Crew?   @relation(fields: [crewId], references: [id], onDelete: SetNull)
```

и индекс `@@index([crewId, status])`.

Новые модели после `WorkOrderSignature`:

```prisma
/// §48 «Назначение инженеру или бригаде». Бригада принадлежит сети: §47 —
/// это сеть зарядных пунктов, у компании-производителя сотрудников нет.
model Crew {
  id         String          @id @default(cuid())
  operatorId String
  operator   ChargerOperator @relation(fields: [operatorId], references: [id], onDelete: Cascade)
  name       String
  /// Города бригады; пусто — вся сеть.
  regions    String[]
  createdAt  DateTime        @default(now())
  updatedAt  DateTime        @updatedAt

  members    CrewMember[]
  workOrders WorkOrder[]

  @@unique([operatorId, name])
  @@index([operatorId])
}

/// Инженер может быть в нескольких бригадах: утром монтаж с бригадой, днём
/// жалоба в одиночку.
model CrewMember {
  id         String   @id @default(cuid())
  crewId     String
  crew       Crew     @relation(fields: [crewId], references: [id], onDelete: Cascade)
  employeeId String
  employee   Employee @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  /// Старший: письмо адресовано ему, остальным — то же письмо.
  lead       Boolean  @default(false)
  createdAt  DateTime @default(now())

  @@unique([crewId, employeeId])
  @@index([employeeId])
}
```

В `model ChargerOperator` добавить `crews Crew[]`.

- [x] **Шаг 2: миграция на выбрасываемой базе**

```bash
cd ~/poolwatt
NODE_ENV=development DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local \
  | tr -d '"' | sed 's|/poolwatt?|/poolwatt_test?|')" \
  npx prisma migrate dev --name work_order_dispatch
```

Ожидание: миграция создана, клиент сгенерирован.

- [x] **Шаг 3: та же миграция на живой базе**

```bash
cd ~/poolwatt && npx prisma migrate deploy
```

- [x] **Шаг 4: коммит**

```bash
git add prisma && git commit -m "feat(work): crews, engineer regions and a crew assignee on the order"
```

---

### Задача 2: загрузка и подбор — `assignment.ts`

**Files:**
- Create: `src/lib/work/assignment.ts`
- Test: `src/lib/work/assignment.test.ts`

- [x] **Шаг 1: падающий тест загрузки**

`src/lib/work/assignment.test.ts` — сеть, два инженера, бригада из обоих,
пункт в городе `Košice`. Случаи:

```ts
it("counts a crew order as load for every member", async () => {
  // наряд назначен бригаде из Ани и Бори
  await expect(openLoad(ania.id)).resolves.toBe(1);
  await expect(openLoad(boris.id)).resolves.toBe(1);
});

it("a crew is as busy as its busiest member", async () => {
  // у Ани ещё два личных наряда
  const crews = await suggestAssignees(order.id);
  const crew = crews.find((c) => c.kind === "crew");
  expect(crew?.openOrders).toBe(3); // максимум, не сумма и не среднее
});

it("ranks an exact city first, the whole network next, another region last", async () => {
  const list = await suggestAssignees(order.id);
  expect(list.map((c) => c.reason)).toEqual(["city", "network", "region"]);
});

it("is not a candidate without workorders.write", async () => { … });
it("is not a candidate outside its point scope", async () => { … });
it("has no candidates for a generation asset order", async () => {
  await expect(suggestAssignees(assetOrder.id)).resolves.toEqual([]);
});
```

- [x] **Шаг 2: прогон — падает**

```bash
NODE_ENV=test DATABASE_URL=… npx vitest run src/lib/work/assignment.test.ts
```

Ожидание: `Cannot find module './assignment'`.

- [x] **Шаг 3: модуль**

```ts
// Кому отдать наряд — §48 «с учётом региона и загрузки».
//
// Модуль только считает и сортирует: назначает `assignWorkOrder`. Регион —
// город пункта против списка городов кандидата, и пустой список значит всю
// сеть (то же соглашение, что у `Employee.pointIds`).

export type CandidateKind = "employee" | "crew";
export type CandidateReason = "city" | "network" | "region";

export interface Candidate {
  kind: CandidateKind;
  id: string;            // employeeId или crewId
  name: string;          // @username или имя бригады
  regions: string[];
  openOrders: number;
  reason: CandidateReason;
}

const OPEN: WorkOrderStatus[] = [NEW, ASSIGNED, EN_ROUTE, IN_PROGRESS, WAITING_PART, DONE];

export async function openLoad(employeeId: string): Promise<number>;
export async function suggestAssignees(workOrderId: string): Promise<Candidate[]>;
export async function autoAssign(workOrderId: string): Promise<string | null>;
```

`openLoad` — один `count` с `OR: [{ assigneeId }, { crew: { members: { some: { employeeId } } } }]`.

`suggestAssignees`: наряд без `operatorId` или без `pointId` с городом — город
`null`; кандидаты-инженеры = сотрудники сети с `workorders.write` и областью,
допускающей пункт (через `can()` из `staff-service`); кандидаты-бригады = все
бригады сети, у которых есть хотя бы один такой участник. Причина:
`city` — город наряда есть в `regions`; `network` — `regions` пуст;
`region` — иначе. Порядок: причина (`city` < `network` < `region`), затем
`openOrders` возрастанию, затем имя.

`autoAssign` — первый кандидат через `assignWorkOrder(..., "system")`;
кандидатов нет — `null`.

- [x] **Шаг 4: прогон — зелено**

- [x] **Шаг 5: коммит**

```bash
git add src/lib/work/assignment.ts src/lib/work/assignment.test.ts
git commit -m "feat(work): pick an assignee by region and open load"
```

---

### Задача 3: бригады — `crew-service.ts`

**Files:**
- Create: `src/lib/work/crew-service.ts`, `src/lib/work/crew-service.test.ts`

- [x] **Шаг 1: падающий тест**

```ts
it("refuses a crew in somebody else's network", …);        // CrewError
it("refuses a member from another network", …);            // CrewError
it("keeps a person in two crews", …);                      // обе бригады видят
it("removes the last member and keeps the crew", …);       // бригада пустая, не удалена
it("moves the lead flag instead of keeping two leads", …);
it("writes an audit entry for every change", …);
```

- [x] **Шаг 2: прогон — падает**

- [x] **Шаг 3: модуль**

```ts
export class CrewError extends Error {}

export async function createCrew(operatorId: string, actorUserId: string,
  input: { name: string; regions: string[] }): Promise<Crew>;
export async function setCrewRegions(crewId: string, actorUserId: string, regions: string[]): Promise<Crew>;
export async function addCrewMember(crewId: string, employeeId: string, actorUserId: string,
  opts?: { lead?: boolean }): Promise<void>;
export async function removeCrewMember(crewId: string, employeeId: string, actorUserId: string): Promise<void>;
export async function setEmployeeRegions(employeeId: string, actorUserId: string, regions: string[]): Promise<void>;
export async function readCrews(operatorId: string, userId: string): Promise<CrewRow[] | null>;
```

Право на запись — владелец сети или `staff.write` (та же проверка, что в
`staff-service.ts`; переиспользовать её, не писать вторую). Города
нормализуются: `trim`, пустые выброшены, без повторов.

- [x] **Шаг 4: прогон — зелено**
- [x] **Шаг 5: коммит**

```bash
git commit -am "feat(work): crews and the regions an engineer covers"
```

---

### Задача 4: назначение бригаде, исключающее

**Files:**
- Modify: `src/lib/work/work-order-service.ts`
- Test: `src/lib/work/work-order-service.test.ts`

- [x] **Шаг 1: падающий тест**

```ts
it("assigning a crew clears the person", async () => {
  await assignWorkOrder(order.id, { employeeId: ania.id }, owner.id);
  const after = await assignWorkOrder(order.id, { crewId: crew.id }, owner.id);
  expect(after.assigneeId).toBeNull();
  expect(after.crewId).toBe(crew.id);
});
it("assigning a person clears the crew", …);
it("refuses a crew of another network", …);
it("refuses a crew without a single engineer who may work", …);
```

- [x] **Шаг 2: прогон — падает (сигнатура другая)**

- [x] **Шаг 3: правка**

`assignWorkOrder(workOrderId, target: { employeeId: string } | { crewId: string }, actorUserId)`.
Обновление ставит одно поле и `null` второму. Вызовы поправить в
`src/app/[locale]/me/work-orders/actions.ts` и везде, где компилятор укажет.

- [x] **Шаг 4: прогон — зелено**
- [x] **Шаг 5: коммит**

```bash
git commit -am "feat(work): an order goes to a person or to a crew, never both"
```

---

### Задача 5: наряд по аварии назначает себя сам

**Files:**
- Modify: `src/lib/work/work-order-service.ts`
- Test: `src/lib/work/work-order-service.test.ts`

- [x] **Шаг 1: падающий тест**

```ts
it("assigns an alert-born order to the best candidate", async () => {
  await openWorkOrdersForAlerts({ companyId });   // объект генерации — кандидатов нет
  …
  const order = await createWorkOrder({ operatorId, pointId, …, autoAssign: true });
  const fresh = await prisma.workOrder.findUnique({ where: { id: order.id } });
  expect(fresh?.assigneeId).toBe(nearest.id);
  expect(fresh?.status).toBe("ASSIGNED");
});
it("leaves the order NEW when the network has no engineer", async () => { … });
it("records the automatic assignment as the system's", async () => {
  const entry = await prisma.auditLog.findFirst({ where: { entityId: order.id, action: "workorder.assigned" } });
  expect(entry?.actor).toBe("system");
});
```

- [x] **Шаг 2: прогон — падает**

- [x] **Шаг 3: правка**

`CreateWorkOrderArgs.autoAssign?: boolean`. После `writeAudit` создания — если
включено, `await autoAssign(order.id)` в `try/catch` (подбор не должен уронить
создание) и вернуть перечитанный наряд. Включить в двух автоматических
ветках: `openWorkOrdersForAlerts` и перевод заявки §51 в наряд
(`ticket-service.ts`, найти вызов `createWorkOrder`).

- [x] **Шаг 4: прогон — зелено**
- [x] **Шаг 5: коммит**

```bash
git commit -am "feat(work): an alarm finds the engineer by itself"
```

---

### Задача 6: право и списки участника бригады

**Files:**
- Modify: `src/lib/work/work-order-access.ts`, `src/lib/warehouse/engineer-view.ts`,
  `src/app/[locale]/me/work-orders/page.tsx`
- Test: `src/lib/work/work-order-access.test.ts`

- [x] **Шаг 1: падающий тест**

```ts
it("lets a member of the assigned crew work the order", async () => {
  const seen = await readWorkOrderForUser(order.id, boris.user.id, "USER");
  expect(seen?.canWork).toBe(true);
  expect(seen?.employeeId).toBe(boris.id);
});
it("hides the order from a member of another crew", async () => {
  await expect(readWorkOrderForUser(order.id, outsider.user.id, "USER")).resolves.toBeNull();
});
```

- [x] **Шаг 2: прогон — падает**

- [x] **Шаг 3: правка**

В `readWorkOrderForUser` рядом с веткой исполнителя добавить `crew: { select:
{ members: { select: { employeeId: true, employee: { select: { userId: true } } } } } }`
и ветку: участник найден по `userId` — `canWork: true`, `employeeId` его.
Ветка стоит **до** проверки `can(...)`, как и личная: наряд ему уже назначили.

В `engineer-view.ts` и в странице кабинета добавить в `OR` условие
`{ crew: { members: { some: { employee: { userId } } } } }`.

- [x] **Шаг 4: прогон — зелено**
- [x] **Шаг 5: коммит**

```bash
git commit -am "feat(work): a crew order is every member's order"
```

---

### Задача 7: письмо бригаде

**Files:**
- Modify: `src/lib/work/work-order-service.ts`
- Test: `src/lib/work/work-order-service.test.ts`

- [x] **Шаг 1: падающий тест**

```ts
it("mails every member of the assigned crew", async () => {
  const sent: string[] = [];
  await notifyPendingWorkOrders({ sendTo: async (to) => { sent.push(to); }, scope: { operatorId } });
  expect(sent.sort()).toEqual([ania.email, boris.email]);
});
it("falls back to the owner when no member confirmed an address", async () => { … });
```

- [x] **Шаг 2: прогон — падает**

- [x] **Шаг 3: правка**

В `include` добавить
`crew: { select: { name: true, members: { select: { employee: { select: { user: { select: { email: true, emailVerified: true } } } } } } } }`
и между веткой исполнителя и веткой владельца — ветку бригады.

- [x] **Шаг 4: прогон — зелено**
- [x] **Шаг 5: коммит**

```bash
git commit -am "feat(work): the crew hears about its order"
```

---

### Задача 8: методы §50

**Files:**
- Create: `src/app/api/v1/work-orders/route.ts`,
  `src/app/api/v1/work-orders/[id]/assign/route.ts`,
  `src/app/api/v1/work-orders/[id]/candidates/route.ts`

- [x] **Шаг 1: `GET`/`POST /v1/work-orders`**

По образцу `src/app/api/v1/pipeline/route.ts`: `sessionUser()`, `parseBody`,
`ok`/`fail`. `GET` требует `operatorId`, отдаёт очередь (та же выборка, что у
страницы диспетчера — вынести в `readDispatchQueue` в `assignment.ts`, чтобы
страница и метод не расходились). `POST` — создание через `createWorkOrder`
после проверки права `workorders.write` на пункт. Чужая сеть — 404.

- [x] **Шаг 2: `POST /v1/work-orders/[id]/assign`**

Тело `{ employeeId }` **или** `{ crewId }`; оба или ни одного — 400.
Право — `readWorkOrderForUser(...).canWork`, иначе 404.

- [x] **Шаг 3: `GET /v1/work-orders/[id]/candidates`**

`suggestAssignees`, 404 на чужой наряд.

- [x] **Шаг 4: проверка**

```bash
npx tsc --noEmit
```

- [x] **Шаг 5: коммит**

```bash
git add src/app/api/v1/work-orders && git commit -m "feat(work): §50 routes for the queue, creation and assignment"
```

---

### Задача 9: рабочее место диспетчера

**Files:**
- Create: `src/app/[locale]/me/charger-operator/[id]/dispatch/page.tsx`,
  `src/app/[locale]/me/charger-operator/[id]/dispatch/actions.ts`,
  `src/components/work/dispatch-board.tsx`
- Modify: `messages/{en,ru,sk,de,uk}.json`

- [x] **Шаг 1: серверные действия**

`actions.ts` по образцу `src/app/[locale]/me/work-orders/actions.ts`:
`createOrder(input)` (zod: `operatorId`, `type`, `priority`, `pointId`,
`title`, `description`, `partsNeeded` строкой через запятую) и
`assignFromQueue(input)` (`workOrderId` + `employeeId` | `crewId`).
Право — владелец сети или `workorders.write`; иначе `{ ok: false, formError }`.
`revalidatePath("/[locale]/me/charger-operator/[id]/dispatch", "page")`.

- [x] **Шаг 2: страница**

Серверный компонент: `auth()`, доступ к сети той же проверкой, что соседние
страницы кабинета сети (посмотреть `tickets/page.tsx`), `readDispatchQueue`,
`readCrews`, список пунктов сети, загрузка по людям. Передать в
`<DispatchBoard …/>`. `export const dynamic = "force-dynamic"`.

- [x] **Шаг 3: клиентская доска**

`dispatch-board.tsx`: очередь строками (`data-testid="dispatch-queue"`),
неназначенные первыми и помечены; на строке кнопка «Назначить» раскрывает
кандидатов с причиной и числом открытых нарядов
(`data-testid="dispatch-candidates"`); форма создания
(`data-testid="dispatch-create"`); таблица загрузки
(`data-testid="dispatch-load"`). Все числа — класс `.num`.

- [x] **Шаг 4: ключи перевода**

`dispatch.title`, `dispatch.eyebrow`, `dispatch.unassigned`,
`dispatch.assign`, `dispatch.reason.city|network|region`, `dispatch.load`,
`dispatch.create.*`, `crews.*` — во все пять файлов `messages/`.

- [x] **Шаг 5: ссылка из кабинета сети**

Добавить `dispatch` в навигацию кабинета сети рядом с `tickets` и `warehouse`
(найти, где перечислены разделы).

- [x] **Шаг 6: сборка**

```bash
cd ~/poolwatt && npm run build && pm2 restart poolwatt-web
```

- [x] **Шаг 7: коммит**

```bash
git add -A src/app src/components messages && git commit -m "feat(work): a dispatcher's workplace — queue, creation, assignment"
```

---

### Задача 10: бригады и регионы на странице сотрудников

**Files:**
- Create: `src/components/work/crew-editor.tsx`
- Modify: `src/app/[locale]/me/charger-operator/[id]/staff/page.tsx`,
  `src/app/[locale]/me/charger-operator/[id]/staff/actions.ts`

- [ ] **Шаг 1: действия**

В существующий `staff/actions.ts` добавить `saveEmployeeRegions`,
`addCrew`, `saveCrewRegions`, `addMember`, `dropMember` — тонкие обёртки над
`crew-service.ts`, право проверяет сервис.

- [ ] **Шаг 2: врезка**

`crew-editor.tsx`: у каждого сотрудника поле городов (через запятую), ниже
список бригад с составом, старшим и городами; добавление бригады и участника.
`data-testid="crew-editor"`.

- [ ] **Шаг 3: сборка и проверка глазами**

```bash
npm run build && pm2 restart poolwatt-web
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/ru/me/charger-operator
```

- [ ] **Шаг 4: коммит**

```bash
git commit -am "feat(work): crews and regions where the staff of §47 lives"
```

---

### Задача 11: e2e на живой сборке

**Files:**
- Create: `tests/e2e/dispatch.spec.ts`

- [ ] **Шаг 1: сценарий**

По образцу `tests/e2e/pipeline.spec.ts`: создать сеть, пункт в городе, двух
сотрудников-инженеров, войти владельцем. Проверить:
очередь открывается; наряд создаётся формой и появляется в очереди
неназначенным; кандидаты показывают причину и загрузку; назначение бригаде
переводит наряд в «назначен»; участник бригады видит наряд на
`/{locale}/me/work-orders` и на `/{locale}/app/work-orders`. Свои строки
удалить в конце.

- [ ] **Шаг 2: прогон**

```bash
cd ~/poolwatt && npx playwright test tests/e2e/dispatch.spec.ts
```

- [ ] **Шаг 3: коммит**

```bash
git add tests/e2e/dispatch.spec.ts && git commit -m "test(work): a dispatcher creates and assigns on the live build"
```

---

### Задача 12: весь набор и реестр

- [ ] **Шаг 1: юнит-тесты целиком**

```bash
cd ~/poolwatt
NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local \
  | tr -d '"' | sed 's|/poolwatt?|/poolwatt_test?|')" npx vitest run
```

Ожидание: всё зелено, кроме известной флаки `resolve-user.test.ts`.

- [ ] **Шаг 2: e2e целиком**

```bash
cd ~/poolwatt && npm run test:e2e
```

- [ ] **Шаг 3: сборка и перезапуск**

```bash
cd ~/poolwatt && npm run build && pm2 restart poolwatt-web poolwatt-worker
```

- [ ] **Шаг 4: реестр**

`inbox/TZ-STATUS.md`: часть N-3-б — «готово 2026-11-27» с коммитами и
тестами; строка итога сверху; запись в журнал с тем, что нашлось до начала
работы. В git не попадает (`inbox/` в `.gitignore`).

- [ ] **Шаг 5: коммит и отчёт**

```bash
git add -A && git commit -m "docs(work): tick the N-3-b plan" && git push
```

Отчёт владельцу по-русски плюс два MP3 (RU + SK).

---

## Самопроверка плана

- Ручное создание — задачи 8 (метод) и 9 (страница). ✔
- Назначение с учётом региона и загрузки — задачи 1, 2, 9. ✔
- Бригада — задачи 1, 3, 4, 6, 7. ✔
- «Наряд приходит в течение минуты» — задачи 5 и 7. ✔
- Маршрут к объекту — уже есть (`MapsDeepLink`), в плане нет намеренно. ✔
- Статусы §48 — цепочка уже полная, `NEW → ASSIGNED` ставит назначение. ✔
- Имена сходятся: `suggestAssignees`, `openLoad`, `autoAssign`,
  `readDispatchQueue`, `Candidate.reason` — одни и те же в задачах 2, 5, 8, 9.
