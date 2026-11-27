# Наряд в телефоне и офлайн-списание запчасти — план (US-49)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** инженер списывает запчасть на наряд с телефона без связи, запись
ждёт в очереди на устройстве и уходит на сервер ровно один раз, когда связь
вернулась.

**Architecture:** право на склад переезжает с «только владелец сети» на
`can(employee, "warehouse.write", pointId)`; `POST /v1/stock-movements`
становится идемпотентным и пишет `AuditLog`; на устройстве появляется чистая
очередь над `localStorage`, которую досылает экран наряда; в оболочке §22
появляются два экрана и раздел хаба.

**Tech Stack:** Next.js 16 (App Router), Prisma, vitest, Playwright
(проект `mobile`, Pixel 7), next-intl v4.

Спецификация: `docs/superpowers/specs/2026-11-27-offline-work-order-parts-design.md`.

Запуск юнит-тестов — всегда против выбрасываемой базы:

```bash
cd ~/poolwatt
NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local \
  | tr -d '"' | sed 's|/poolwatt?|/poolwatt_test?|')" npx vitest run <путь>
```

Ниже эта строка сокращена до `TESTENV npx vitest run <путь>`.

---

## Файлы

| Файл | За что отвечает |
| --- | --- |
| `src/lib/warehouse/stock-access.ts` | новый: кто имеет право тронуть склад (§47 + §49) |
| `src/lib/warehouse/stock-access.test.ts` | новый: пять случаев права |
| `src/lib/warehouse/stock-service.ts` | правка: вместо `requireNetwork` зовёт `stock-access`, пишет `AuditLog`, проверяет чужую машину |
| `src/lib/warehouse/stock-service.test.ts` | правка: инженер, чужая машина, гонка за последней платой |
| `src/app/api/v1/stock-movements/route.ts` | правка: под `idempotent()` |
| `src/app/api/v1/stock-movements/idempotency.test.ts` | новый: тот же ключ дважды |
| `src/lib/mobile/offline-queue.ts` | новый: чистая очередь над внедряемым хранилищем |
| `src/lib/mobile/offline-queue.test.ts` | новый |
| `src/lib/warehouse/engineer-view.ts` | новый: наряды инженера и снимок «что у меня в машине» |
| `src/lib/warehouse/engineer-view.test.ts` | новый |
| `src/lib/mobile/tabs.ts` | правка: раздел `work` в хабе |
| `src/lib/mobile/shell-context.ts` | правка: флаг `isStaff` |
| `src/app/[locale]/app/work-orders/page.tsx` | новый: мои наряды |
| `src/app/[locale]/app/work-orders/[id]/page.tsx` | новый: один наряд |
| `src/components/mobile/work-order-screen.tsx` | новый: клиентский экран наряда с очередью |
| `messages/{en,ru,sk}.json` | правка: `app.work.*` и `app.sections.work` |
| `tests/e2e/mobile-work-order.mobile.spec.ts` | новый: офлайн-списание на Pixel 7 |

---

### Task 1: кто имеет право тронуть склад

**Files:**
- Create: `src/lib/warehouse/stock-access.ts`
- Create: `src/lib/warehouse/stock-access.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/warehouse/stock-access.test.ts`:

```ts
// §47 + §49 — «инженер … бронирует и списывает их по факту»: право на склад
// есть у владельца сети и у сотрудника с `warehouse.write`, и ни у кого ещё.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ensureBuiltInRoles } from "@/lib/staff/staff-service";
import { StockAccessError, requireStockActor } from "./stock-access";

const PREFIX = "test_stockacc_";

let operatorId: string;
let ownerUserId: string;
let engineerUserId: string;
let scopedUserId: string;
let accountantUserId: string;
let strangerUserId: string;
let pointA: string;
let pointB: string;

async function wipe() {
  await prisma.employee.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.staffRole.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await wipe();
  const user = async (name: string) =>
    (
      await prisma.user.create({
        data: { username: `${PREFIX}${name}`, passwordHash: "x" },
      })
    ).id;
  ownerUserId = await user("owner");
  engineerUserId = await user("engineer");
  scopedUserId = await user("scoped");
  accountantUserId = await user("accountant");
  strangerUserId = await user("stranger");

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: `${PREFIX}net`,
        displayName: "Access network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  pointA = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "A" },
    })
  ).id;
  pointB = (
    await prisma.acceptancePoint.create({
      data: { operatorId, type: "CHARGING_STATION", name: "B" },
    })
  ).id;

  const roles = await ensureBuiltInRoles(operatorId);
  const role = (name: string) => roles.find((r) => r.name === name)!.id;
  await prisma.employee.create({
    data: { operatorId, userId: engineerUserId, roleId: role("ENGINEER"), pointIds: [] },
  });
  await prisma.employee.create({
    data: { operatorId, userId: scopedUserId, roleId: role("ENGINEER"), pointIds: [pointA] },
  });
  await prisma.employee.create({
    data: {
      operatorId,
      userId: accountantUserId,
      roleId: role("ACCOUNTANT"),
      pointIds: [],
    },
  });
});

afterAll(async () => {
  await wipe();
});

describe("requireStockActor", () => {
  it("lets the owner of the network through", async () => {
    const actor = await requireStockActor(operatorId, ownerUserId);
    expect(actor.isOwner).toBe(true);
    expect(actor.employee).toBeNull();
  });

  it("lets an engineer with warehouse.write through", async () => {
    const actor = await requireStockActor(operatorId, engineerUserId);
    expect(actor.isOwner).toBe(false);
    expect(actor.employee?.userId).toBe(engineerUserId);
  });

  it("refuses an accountant, who has no warehouse.write", async () => {
    await expect(requireStockActor(operatorId, accountantUserId)).rejects.toThrow(
      StockAccessError,
    );
  });

  it("refuses somebody who is not on this network at all", async () => {
    await expect(requireStockActor(operatorId, strangerUserId)).rejects.toThrow(
      StockAccessError,
    );
  });

  it("keeps an engineer to the points they were given", async () => {
    await expect(
      requireStockActor(operatorId, scopedUserId, { pointId: pointA }),
    ).resolves.toMatchObject({ isOwner: false });
    await expect(
      requireStockActor(operatorId, scopedUserId, { pointId: pointB }),
    ).rejects.toThrow(StockAccessError);
  });

  it("does not scope the owner by point", async () => {
    await expect(
      requireStockActor(operatorId, ownerUserId, { pointId: pointB }),
    ).resolves.toMatchObject({ isOwner: true });
  });

  it("refuses an unknown network", async () => {
    await expect(requireStockActor("nope", ownerUserId)).rejects.toThrow(StockAccessError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TESTENV npx vitest run src/lib/warehouse/stock-access.test.ts`
Expected: FAIL — `Failed to resolve import "./stock-access"`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/warehouse/stock-access.ts`:

```ts
// Кто имеет право тронуть склад — §47 и §49.
//
// §49 поручает списание инженеру («бронирует и списывает их по факту»), а
// §47 выдаёт право `warehouse.write` ролям ENGINEER и STOREKEEPER. До этого
// модуля склад пускал только владельца сети, то есть US-49 была невыполнима
// по праву доступа, а не по офлайну.
//
// Решение одно на все операции склада, потому что право, проверенное в двух
// местах, расходится — и расходится в сторону «да».

import { prisma } from "@/lib/prisma";
import { can, readEmployee, type EmployeeWithRole } from "@/lib/staff/staff-service";

export class StockAccessError extends Error {}

export interface StockActor {
  operatorId: string;
  userId: string;
  isOwner: boolean;
  /** Null for the owner, who is not an employee row. */
  employee: EmployeeWithRole | null;
}

export interface StockActorOptions {
  /** §47's scope: an engineer given two points has no business at a third. */
  pointId?: string | null;
}

export async function requireStockActor(
  operatorId: string,
  userId: string,
  options: StockActorOptions = {},
): Promise<StockActor> {
  const operator = await prisma.chargerOperator.findUnique({
    where: { id: operatorId },
    select: { id: true, claimedById: true },
  });
  if (!operator) throw new StockAccessError("No such network");

  if (operator.claimedById && operator.claimedById === userId) {
    return { operatorId, userId, isOwner: true, employee: null };
  }

  const employee = await readEmployee(operatorId, userId);
  if (!employee || !can(employee, "warehouse.write", options.pointId ?? undefined)) {
    throw new StockAccessError("You have no business with this network's stores");
  }
  return { operatorId, userId, isOwner: false, employee };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TESTENV npx vitest run src/lib/warehouse/stock-access.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/warehouse/stock-access.ts src/lib/warehouse/stock-access.test.ts
git commit -m "feat(warehouse): an engineer with warehouse.write may touch the stores"
```

---

### Task 2: склад зовёт новое право, пишет журнал и не пускает в чужую машину

**Files:**
- Modify: `src/lib/warehouse/stock-service.ts`
- Modify: `src/lib/warehouse/stock-service.test.ts`

- [ ] **Step 1: Write the failing tests**

Добавить в `src/lib/warehouse/stock-service.test.ts`. В `beforeAll`, после
создания `van`, добавить ещё инженера, его машину и чужую машину:

```ts
  engineerUserId = await user("engineer");
  const roles = await ensureBuiltInRoles(operatorId);
  engineerEmployeeId = (
    await prisma.employee.create({
      data: {
        operatorId,
        userId: engineerUserId,
        roleId: roles.find((r) => r.name === "ENGINEER")!.id,
        pointIds: [],
      },
    })
  ).id;
  await prisma.warehouse.update({
    where: { id: van },
    data: { keeperEmployeeId: engineerEmployeeId },
  });
  otherVan = (
    await prisma.warehouse.create({
      data: { operatorId, name: "Van 2", kind: "VAN" },
    })
  ).id;
```

Объявить рядом с остальными: `let engineerUserId: string;`,
`let engineerEmployeeId: string;`, `let otherVan: string;` и добавить импорт
`import { ensureBuiltInRoles } from "@/lib/staff/staff-service";`.
В `wipe()` добавить перед удалением складов:

```ts
  await prisma.employee.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.staffRole.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
```

Новый блок в конце файла:

```ts
describe("US-49 — the engineer's own hands on the stores", () => {
  it("lets an engineer issue a part to a work order", async () => {
    await receiveStock({ partId: cableId, warehouseId: van, qty: 2, actorId: ownerUserId });

    const movement = await issueToWorkOrder({
      partId: cableId,
      warehouseId: van,
      qty: 1,
      workOrderId,
      actorId: engineerUserId,
    });

    expect(movement.kind).toBe("ISSUE");
    expect(movement.actorId).toBe(engineerUserId);
    const item = await prisma.stockItem.findUniqueOrThrow({
      where: { warehouseId_partId: { warehouseId: van, partId: cableId } },
    });
    expect(item.qty).toBe(1);
  });

  it("writes an audit entry for the movement", async () => {
    await receiveStock({ partId: cableId, warehouseId: van, qty: 1, actorId: ownerUserId });
    const movement = await issueToWorkOrder({
      partId: cableId,
      warehouseId: van,
      qty: 1,
      workOrderId,
      actorId: engineerUserId,
    });

    const entry = await prisma.auditLog.findFirst({
      where: { entity: "StockMovement", entityId: movement.id },
    });
    expect(entry?.action).toBe("stock.movement.ISSUE");
    expect(entry?.actor).toBe(engineerUserId);
  });

  it("refuses a van that belongs to another engineer", async () => {
    await receiveStock({
      partId: cableId,
      warehouseId: otherVan,
      qty: 2,
      actorId: ownerUserId,
    });

    await expect(
      issueToWorkOrder({
        partId: cableId,
        warehouseId: otherVan,
        qty: 1,
        workOrderId,
        actorId: engineerUserId,
      }),
    ).rejects.toThrow(StockError);
  });

  it("still lets the owner issue from any van", async () => {
    await receiveStock({
      partId: cableId,
      warehouseId: otherVan,
      qty: 1,
      actorId: ownerUserId,
    });
    await expect(
      issueToWorkOrder({
        partId: cableId,
        warehouseId: otherVan,
        qty: 1,
        workOrderId,
        actorId: ownerUserId,
      }),
    ).resolves.toMatchObject({ kind: "ISSUE" });
  });

  it("gives the last part on the shelf to exactly one of two concurrent issues", async () => {
    await receiveStock({ partId: cableId, warehouseId: van, qty: 1, actorId: ownerUserId });

    const results = await Promise.allSettled([
      issueToWorkOrder({
        partId: cableId,
        warehouseId: van,
        qty: 1,
        workOrderId,
        actorId: engineerUserId,
      }),
      issueToWorkOrder({
        partId: cableId,
        warehouseId: van,
        qty: 1,
        workOrderId,
        actorId: engineerUserId,
      }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const item = await prisma.stockItem.findUniqueOrThrow({
      where: { warehouseId_partId: { warehouseId: van, partId: cableId } },
    });
    expect(item.qty).toBe(0);
    const issues = await prisma.stockMovement.count({
      where: { partId: cableId, kind: "ISSUE" },
    });
    expect(issues).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `TESTENV npx vitest run src/lib/warehouse/stock-service.test.ts`
Expected: FAIL — выдача инженером отбивается «This network belongs to
somebody else», записи в журнале нет, чужая машина проходит.

- [ ] **Step 3: Implement**

В `src/lib/warehouse/stock-service.ts`:

1. Заменить `requireNetwork` на обёртку над новым модулем и снести старое
   тело:

```ts
import { StockAccessError, requireStockActor } from "./stock-access";

async function requireNetwork(operatorId: string, userId: string, pointId?: string | null) {
  try {
    return await requireStockActor(operatorId, userId, { pointId });
  } catch (err) {
    // Один тип ошибки на весь склад: маршрут и страницы ловят StockError.
    if (err instanceof StockAccessError) throw new StockError(err.message);
    throw err;
  }
}
```

2. `requireSameNetwork` получает необязательный `pointId` и передаёт его
   дальше:

```ts
async function requireSameNetwork(args: {
  partId: string;
  warehouseIds: (string | null | undefined)[];
  actorId: string;
  pointId?: string | null;
}) {
  const part = await prisma.sparePart.findUnique({
    where: { id: args.partId },
    select: { id: true, operatorId: true, unitCostFiat: true },
  });
  if (!part) throw new StockError("No such part");
  const actor = await requireNetwork(part.operatorId, args.actorId, args.pointId);
  // … проверка складов без изменений …
  return { part, actor };
}
```

Все вызовы `requireSameNetwork` в файле возвращали `part`; теперь они
возвращают пару, поэтому `const part = await requireSameNetwork(...)`
становится `const { part } = await requireSameNetwork(...)` в
`receiveStock`, `issueToWorkOrder` и `writeOffStock`, а в `moveStock`,
`returnFaulty`, `recordStocktake` и `setMinQty` — просто `await`.

3. `writeMovement` пишет журнал той же транзакцией:

```ts
async function writeMovement(tx: Prisma.TransactionClient, args: MovementArgs) {
  const movement = await tx.stockMovement.create({ /* как было */ });
  // §49 — движение склада двигает себестоимость пункта, значит у него есть
  // след. До US-49 журнал вела только заявка US-50.
  await writeAudit(tx, {
    actor: args.actorId,
    entity: "StockMovement",
    entityId: movement.id,
    action: `stock.movement.${args.kind}`,
    after: {
      partId: args.partId,
      qty: args.qty,
      fromWarehouseId: args.fromWarehouseId ?? null,
      toWarehouseId: args.toWarehouseId ?? null,
      workOrderId: args.workOrderId ?? null,
      serialNo: args.serialNo?.trim() || null,
    },
  });
  return movement;
}
```

4. `issueToWorkOrder` читает наряд раньше права — право зависит от пункта
   наряда — и отказывает в чужой машине:

```ts
export async function issueToWorkOrder(args: {
  partId: string;
  warehouseId: string;
  qty: number;
  workOrderId: string;
  serialNo?: string | null;
  actorId: string;
}) {
  requirePositive(args.qty);

  const order = await prisma.workOrder.findUnique({
    where: { id: args.workOrderId },
    select: { operatorId: true, pointId: true },
  });
  if (!order) throw new StockError("That work order is not in the same network as the part");

  const { part, actor } = await requireSameNetwork({
    partId: args.partId,
    warehouseIds: [args.warehouseId],
    actorId: args.actorId,
    pointId: order.pointId,
  });
  if (order.operatorId !== part.operatorId) {
    throw new StockError("That work order is not in the same network as the part");
  }

  // §49 — «наличие у себя в машине»: чужой фургон инженеру не склад.
  if (!actor.isOwner) {
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: args.warehouseId },
      select: { kind: true, keeperEmployeeId: true },
    });
    if (
      warehouse?.kind === "VAN" &&
      warehouse.keeperEmployeeId !== actor.employee?.id
    ) {
      throw new StockError("That van is somebody else's");
    }
  }

  return prisma.$transaction(async (tx) => { /* как было */ });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `TESTENV npx vitest run src/lib/warehouse src/lib/staff`
Expected: PASS, весь файл склада плюс пять новых случаев.

- [ ] **Step 5: Commit**

```bash
git add src/lib/warehouse
git commit -m "feat(warehouse): the engineer's own van, and an audit entry per movement"
```

---

### Task 3: идемпотентность у POST /v1/stock-movements

**Files:**
- Modify: `src/app/api/v1/stock-movements/route.ts`
- Create: `src/lib/warehouse/stock-idempotency.test.ts`

- [ ] **Step 1: Write the failing test**

Маршруты в этом проекте тестируются через вызов экспортированного `POST` с
подделанным `NextRequest`; образец — `src/lib/exchange/idempotency-flow.test.ts`.
Прочитать его перед написанием и повторить способ подмены сессии.

`src/lib/warehouse/stock-idempotency.test.ts`:

```ts
// §15 — «Все POST-запросы с ключом идемпотентности». Очередь US-49 досылает
// запись повторно по определению: оборвалась связь на ответе, и без ключа
// инженер списал бы плату дважды.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const sessionUser = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => sessionUser() }));

const PREFIX = "test_stockidem_";

let ownerUserId: string;
let operatorId: string;
let partId: string;
let warehouseId: string;
let workOrderId: string;
let POST: typeof import("@/app/api/v1/stock-movements/route").POST;

function request(body: unknown, key: string | null) {
  return new NextRequest("http://localhost/api/v1/stock-movements", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { "idempotency-key": key } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function wipe() {
  await prisma.idempotencyRecord.deleteMany({
    where: { endpoint: "POST /v1/stock-movements" },
  });
  await prisma.stockMovement.deleteMany({
    where: { part: { operator: { slug: { startsWith: PREFIX } } } },
  });
  await prisma.stockItem.deleteMany({
    where: { part: { operator: { slug: { startsWith: PREFIX } } } },
  });
  await prisma.warehouse.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.sparePart.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.workOrder.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await wipe();
  POST = (await import("@/app/api/v1/stock-movements/route")).POST;

  ownerUserId = (
    await prisma.user.create({
      data: { username: `${PREFIX}owner`, passwordHash: "x" },
    })
  ).id;
  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: `${PREFIX}net`,
        displayName: "Idem network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  warehouseId = (
    await prisma.warehouse.create({ data: { operatorId, name: "Van", kind: "VAN" } })
  ).id;
  partId = (
    await prisma.sparePart.create({ data: { operatorId, sku: "P1", name: "Plate" } })
  ).id;
  const point = await prisma.acceptancePoint.create({
    data: { operatorId, type: "CHARGING_STATION", name: "P" },
  });
  workOrderId = (
    await prisma.workOrder.create({
      data: {
        operatorId,
        pointId: point.id,
        type: "REPAIR",
        title: "Fix",
        description: "Broken",
      },
    })
  ).id;
});

beforeEach(async () => {
  sessionUser.mockResolvedValue({
    user: { id: ownerUserId, username: `${PREFIX}owner`, role: "USER" },
  });
  await prisma.idempotencyRecord.deleteMany({
    where: { endpoint: "POST /v1/stock-movements" },
  });
  await prisma.stockMovement.deleteMany({ where: { partId } });
  await prisma.stockItem.deleteMany({ where: { partId } });
  await prisma.stockItem.create({ data: { warehouseId, partId, qty: 5 } });
});

afterAll(async () => {
  await wipe();
});

const issue = {
  kind: "ISSUE",
  partId: "",
  warehouseId: "",
  qty: 1,
  workOrderId: "",
};

describe("POST /v1/stock-movements under §15", () => {
  it("refuses a POST with no key", async () => {
    const res = await POST(
      request({ ...issue, partId, warehouseId, workOrderId }, null),
    );
    expect(res.status).toBe(400);
  });

  it("writes one movement for two requests with the same key", async () => {
    const body = { ...issue, partId, warehouseId, workOrderId };
    const first = await POST(request(body, "k-1"));
    const second = await POST(request(body, "k-1"));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");

    const firstJson = await first.json();
    const secondJson = await second.json();
    expect(secondJson.movement.id).toBe(firstJson.movement.id);

    expect(await prisma.stockMovement.count({ where: { partId } })).toBe(1);
    const item = await prisma.stockItem.findUniqueOrThrow({
      where: { warehouseId_partId: { warehouseId, partId } },
    });
    expect(item.qty).toBe(4);
  });

  it("refuses the same key with a different body", async () => {
    const body = { ...issue, partId, warehouseId, workOrderId };
    await POST(request(body, "k-2"));
    const res = await POST(request({ ...body, qty: 2 }, "k-2"));
    expect(res.status).toBe(409);
  });

  it("lets a refused request be retried with the same key", async () => {
    const body = { ...issue, partId, warehouseId, workOrderId, qty: 99 };
    const first = await POST(request(body, "k-3"));
    expect(first.status).toBe(400);

    await prisma.stockItem.update({
      where: { warehouseId_partId: { warehouseId, partId } },
      data: { qty: 200 },
    });
    const second = await POST(request(body, "k-3"));
    expect(second.status).toBe(201);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TESTENV npx vitest run src/lib/warehouse/stock-idempotency.test.ts`
Expected: FAIL — ключ не требуется, второй запрос пишет второе движение.

- [ ] **Step 3: Implement**

`src/app/api/v1/stock-movements/route.ts`: тело `switch` целиком уезжает
внутрь `idempotent()`. Шапка файла получает абзац про §15, импорт
дополняется `idempotencyKey` и `idempotent`:

```ts
import {
  fail,
  idempotencyKey,
  idempotent,
  ok,
  parseBody,
  sessionUser,
  unauthorized,
} from "@/lib/exchange/api";
```

и `POST` становится:

```ts
export async function POST(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const parsed = await parseBody(req, bodySchema);
  if ("response" in parsed) return parsed.response;
  const b = parsed.data;

  const need = (value: unknown, what: string): never | void => {
    if (value == null) throw new StockError(`${what} is required for a ${b.kind}`);
  };

  try {
    return await idempotent({
      endpoint: "POST /v1/stock-movements",
      key: idempotencyKey(req),
      userKey: user.id,
      body: b,
      run: async () => {
        let movementId: string | null = null;
        switch (b.kind) {
          /* шесть веток без изменений */
        }
        return { status: 201, data: { movement: { id: movementId, kind: b.kind } } };
      },
    });
  } catch (err) {
    if (err instanceof StockError) {
      return fail(err.message, /somebody else|No such/.test(err.message) ? 404 : 400);
    }
    throw err;
  }
}
```

`idempotent()` сам отпускает заявку на ключ, когда `run` бросил, поэтому
отказ «на полке только два» можно повторить тем же ключом — это четвёртый
случай теста.

- [ ] **Step 4: Run test to verify it passes**

Run: `TESTENV npx vitest run src/lib/warehouse`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/stock-movements/route.ts src/lib/warehouse/stock-idempotency.test.ts
git commit -m "feat(warehouse): a stock movement needs an Idempotency-Key"
```

---

### Task 4: очередь на устройстве

**Files:**
- Create: `src/lib/mobile/offline-queue.ts`
- Create: `src/lib/mobile/offline-queue.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/mobile/offline-queue.test.ts`:

```ts
// §48 — «Офлайн-режим: наряд закрывается без связи и синхронизируется
// позже». Очередь чистая: хранилище и отправщик внедряются, поэтому браузер
// тестам не нужен.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  QUEUE_KEY,
  type QueuedOp,
  type SendResult,
  enqueue,
  flush,
  forget,
  list,
  pendingCount,
} from "./offline-queue";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

let storage: Storage;

const issueOp = {
  kind: "stock.issue" as const,
  body: { kind: "ISSUE", partId: "p1", warehouseId: "w1", qty: 1, workOrderId: "o1" },
  workOrderId: "o1",
  label: "CCS2 cable, 5 m × 1",
};

beforeEach(() => {
  storage = memoryStorage();
});

describe("enqueue", () => {
  it("gives each operation its own idempotency key and keeps the order", () => {
    const a = enqueue(storage, issueOp);
    const b = enqueue(storage, issueOp);

    expect(a.id).not.toBe(b.id);
    expect(list(storage).map((op) => op.id)).toEqual([a.id, b.id]);
    expect(a.state).toBe("pending");
  });

  it("survives junk in the storage slot", () => {
    storage.setItem(QUEUE_KEY, "{not json");
    expect(list(storage)).toEqual([]);
    expect(enqueue(storage, issueOp).state).toBe("pending");
    expect(list(storage)).toHaveLength(1);
  });
});

describe("flush", () => {
  it("sends each pending operation under its own key and drops what went through", async () => {
    const a = enqueue(storage, issueOp);
    const b = enqueue(storage, issueOp);
    const seen: QueuedOp[] = [];
    const send = vi.fn(async (op: QueuedOp): Promise<SendResult> => {
      seen.push(op);
      return { outcome: "done" };
    });

    const report = await flush(storage, send);

    expect(report).toEqual({ sent: 2, pending: 0, rejected: 0 });
    expect(seen.map((op) => op.id)).toEqual([a.id, b.id]);
    expect(list(storage)).toEqual([]);
  });

  it("keeps the same key across a retry", async () => {
    const a = enqueue(storage, issueOp);
    const keys: string[] = [];
    const flaky = async (op: QueuedOp): Promise<SendResult> => {
      keys.push(op.id);
      return keys.length === 1 ? { outcome: "offline" } : { outcome: "done" };
    };

    await flush(storage, flaky);
    expect(list(storage)).toHaveLength(1);
    await flush(storage, flaky);

    expect(keys).toEqual([a.id, a.id]);
    expect(list(storage)).toEqual([]);
  });

  it("stops at the first operation the network could not take", async () => {
    enqueue(storage, issueOp);
    enqueue(storage, issueOp);
    const send = vi.fn(async (): Promise<SendResult> => ({ outcome: "offline" }));

    const report = await flush(storage, send);

    // Порядок нажатий — порядок отправки: второе списание не должно
    // обогнать первое, иначе остаток падает в чужом порядке.
    expect(send).toHaveBeenCalledTimes(1);
    expect(report).toEqual({ sent: 0, pending: 2, rejected: 0 });
  });

  it("keeps an in-flight conflict pending", async () => {
    enqueue(storage, issueOp);
    const report = await flush(storage, async () => ({ outcome: "busy" }));
    expect(report.pending).toBe(1);
    expect(list(storage)[0].state).toBe("pending");
  });

  it("marks a refusal with the server's own words and carries on", async () => {
    enqueue(storage, issueOp);
    const good = enqueue(storage, issueOp);
    let call = 0;
    const send = async (): Promise<SendResult> => {
      call += 1;
      return call === 1
        ? { outcome: "rejected", reason: "Not enough on the shelf: only 0 there" }
        : { outcome: "done" };
    };

    const report = await flush(storage, send);

    expect(report).toEqual({ sent: 1, pending: 0, rejected: 1 });
    const left = list(storage);
    expect(left).toHaveLength(1);
    expect(left[0].state).toBe("rejected");
    expect(left[0].reason).toContain("only 0 there");
    expect(left[0].id).not.toBe(good.id);
  });

  it("does not try a rejected operation again", async () => {
    enqueue(storage, issueOp);
    await flush(storage, async () => ({ outcome: "rejected", reason: "no" }));
    const send = vi.fn(async (): Promise<SendResult> => ({ outcome: "done" }));

    const report = await flush(storage, send);

    expect(send).not.toHaveBeenCalled();
    expect(report).toEqual({ sent: 0, pending: 0, rejected: 1 });
  });
});

describe("forget and pendingCount", () => {
  it("lets the engineer dismiss a refusal", async () => {
    const op = enqueue(storage, issueOp);
    await flush(storage, async () => ({ outcome: "rejected", reason: "no" }));
    forget(storage, op.id);
    expect(list(storage)).toEqual([]);
  });

  it("counts only what is still waiting to go", async () => {
    enqueue(storage, issueOp);
    enqueue(storage, issueOp);
    await flush(storage, async () => ({ outcome: "rejected", reason: "no" }));
    expect(pendingCount(storage)).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TESTENV npx vitest run src/lib/mobile/offline-queue.test.ts`
Expected: FAIL — `Failed to resolve import "./offline-queue"`.

- [ ] **Step 3: Write the implementation**

`src/lib/mobile/offline-queue.ts`:

```ts
// Очередь записей, сделанных без связи — §48 («наряд закрывается без связи и
// синхронизируется позже») и US-49.
//
// Три решения, которые стоит знать, прежде чем править этот файл.
//
// Первое: ключ идемпотентности придумывается в момент нажатия, а не в момент
// отправки. Иначе два досыла одной записи — два разных ключа, и инженер
// списал запчасть дважды (§15).
//
// Второе: отправка идёт строго по порядку нажатий и останавливается на первой
// записи, которую сеть не взяла. Остаток склада зависит от порядка: две
// выдачи последней платы, пущенные вразнобой, дадут разный ответ.
//
// Третье: запись не исчезает молча никогда. Отказ по существу («на полке
// только два») остаётся на экране со словами сервера, пока инженер его не
// уберёт. Человек, списавший плату в подвале, должен увидеть, что она
// списана — или почему нет.
//
// Background Sync здесь не годится: `SyncManager` в WKWebView нет, а
// оболочка iOS — это WKWebView. Одна механика на обе платформы.

export const QUEUE_KEY = "poolwatt.offlineQueue";

/** Две операции §48, которые инженер делает на месте работ. */
export type QueuedKind = "stock.issue" | "workorder.status";

export interface QueuedOp {
  /** Он же `Idempotency-Key`: придуман при нажатии, неизменен при досылах. */
  id: string;
  kind: QueuedKind;
  /** Тело запроса как есть — очередь в него не смотрит. */
  body: Record<string, unknown>;
  /** Наряд, к которому относится запись: экран показывает только свои. */
  workOrderId: string;
  /** Что человек увидит в списке неотправленного. */
  label: string;
  at: string;
  state: "pending" | "rejected";
  reason?: string;
}

export type NewOp = Pick<QueuedOp, "kind" | "body" | "workOrderId" | "label">;

/**
 * Что сказал сервер, в терминах очереди, а не HTTP:
 *   done     — 2xx, в том числе повтор по тому же ключу;
 *   offline  — запрос не дошёл или 5xx: попробуем позже;
 *   busy     — 409 «ещё выполняется»: ответ будет, просто не сейчас;
 *   rejected — отказ по существу: 4xx, который не изменится от повтора.
 */
export type SendResult =
  | { outcome: "done" }
  | { outcome: "offline" }
  | { outcome: "busy" }
  | { outcome: "rejected"; reason: string };

export interface FlushReport {
  sent: number;
  pending: number;
  rejected: number;
}

function newId(): string {
  // crypto.randomUUID есть и в WebView обеих оболочек, и в Node 22.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function list(storage: Storage): QueuedOp[] {
  try {
    const raw = storage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (op): op is QueuedOp =>
        typeof op === "object" && op !== null && typeof (op as QueuedOp).id === "string",
    );
  } catch {
    // Приватный режим, переполнение, мусор от старой версии — очередь
    // пустая, но запись дальше работает.
    return [];
  }
}

function save(storage: Storage, ops: QueuedOp[]): void {
  try {
    storage.setItem(QUEUE_KEY, JSON.stringify(ops));
  } catch {
    // Квота. Потерять запись молча нельзя, но и бросить здесь нечего:
    // вызывающий экран сам покажет, что список не изменился.
  }
}

export function enqueue(storage: Storage, op: NewOp): QueuedOp {
  const queued: QueuedOp = {
    ...op,
    id: newId(),
    at: new Date().toISOString(),
    state: "pending",
  };
  save(storage, [...list(storage), queued]);
  return queued;
}

export function forget(storage: Storage, id: string): void {
  save(
    storage,
    list(storage).filter((op) => op.id !== id),
  );
}

export function pendingCount(storage: Storage): number {
  return list(storage).filter((op) => op.state === "pending").length;
}

export async function flush(
  storage: Storage,
  send: (op: QueuedOp) => Promise<SendResult>,
): Promise<FlushReport> {
  let sent = 0;
  for (const op of list(storage)) {
    if (op.state !== "pending") continue;

    const result = await send(op);
    if (result.outcome === "done") {
      forget(storage, op.id);
      sent += 1;
      continue;
    }
    if (result.outcome === "rejected") {
      save(
        storage,
        list(storage).map((row) =>
          row.id === op.id ? { ...row, state: "rejected", reason: result.reason } : row,
        ),
      );
      continue;
    }
    // offline или busy: связь есть не у нас, порядок дороже прогресса.
    break;
  }

  const left = list(storage);
  return {
    sent,
    pending: left.filter((op) => op.state === "pending").length,
    rejected: left.filter((op) => op.state === "rejected").length,
  };
}

/** Разбор настоящего ответа `fetch` в термины очереди. */
export async function classify(response: Response): Promise<SendResult> {
  if (response.ok) return { outcome: "done" };
  if (response.status === 409) return { outcome: "busy" };
  if (response.status >= 500) return { outcome: "offline" };
  let reason = `HTTP ${response.status}`;
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
      reason = (body as { error: string }).error;
    }
  } catch {
    // Ответ без JSON — остаётся код.
  }
  return { outcome: "rejected", reason };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TESTENV npx vitest run src/lib/mobile/offline-queue.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mobile/offline-queue.ts src/lib/mobile/offline-queue.test.ts
git commit -m "feat(mobile): a queue for the writes an engineer makes with no signal"
```

---

### Task 5: что инженер видит — наряды и его собственная машина

**Files:**
- Create: `src/lib/warehouse/engineer-view.ts`
- Create: `src/lib/warehouse/engineer-view.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/warehouse/engineer-view.test.ts`:

```ts
// §49 — «В наряде инженер видит нужные запчасти, их наличие у себя в машине
// и на ближайшем складе».

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ensureBuiltInRoles } from "@/lib/staff/staff-service";
import { readEngineerOrders, readEngineerStock } from "./engineer-view";

const PREFIX = "test_engview_";

let operatorId: string;
let ownerUserId: string;
let engineerUserId: string;
let strangerUserId: string;
let employeeId: string;
let vanId: string;
let centralId: string;
let partId: string;
let orderId: string;
let otherOrderId: string;

async function wipe() {
  await prisma.stockMovement.deleteMany({
    where: { part: { operator: { slug: { startsWith: PREFIX } } } },
  });
  await prisma.stockItem.deleteMany({
    where: { part: { operator: { slug: { startsWith: PREFIX } } } },
  });
  await prisma.warehouse.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.sparePart.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.workOrder.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.employee.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.staffRole.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.acceptancePoint.deleteMany({
    where: { operator: { slug: { startsWith: PREFIX } } },
  });
  await prisma.chargerOperator.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await wipe();
  const user = async (name: string) =>
    (
      await prisma.user.create({
        data: { username: `${PREFIX}${name}`, passwordHash: "x" },
      })
    ).id;
  ownerUserId = await user("owner");
  engineerUserId = await user("engineer");
  strangerUserId = await user("stranger");

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: `${PREFIX}net`,
        displayName: "View network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  const roles = await ensureBuiltInRoles(operatorId);
  employeeId = (
    await prisma.employee.create({
      data: {
        operatorId,
        userId: engineerUserId,
        roleId: roles.find((r) => r.name === "ENGINEER")!.id,
        pointIds: [],
      },
    })
  ).id;

  vanId = (
    await prisma.warehouse.create({
      data: { operatorId, name: "Van 1", kind: "VAN", keeperEmployeeId: employeeId },
    })
  ).id;
  centralId = (
    await prisma.warehouse.create({
      data: { operatorId, name: "Central", kind: "CENTRAL", city: "Košice" },
    })
  ).id;
  partId = (
    await prisma.sparePart.create({
      data: { operatorId, sku: "CBL-1", name: "CCS2 cable", serialTracked: true },
    })
  ).id;
  await prisma.stockItem.create({ data: { warehouseId: vanId, partId, qty: 2 } });
  await prisma.stockItem.create({ data: { warehouseId: centralId, partId, qty: 9 } });

  const point = await prisma.acceptancePoint.create({
    data: { operatorId, type: "CHARGING_STATION", name: "Point", city: "Košice" },
  });
  orderId = (
    await prisma.workOrder.create({
      data: {
        operatorId,
        pointId: point.id,
        type: "REPAIR",
        title: "Mine",
        description: "Cable cut",
        assigneeId: employeeId,
        status: "ASSIGNED",
      },
    })
  ).id;
  otherOrderId = (
    await prisma.workOrder.create({
      data: {
        operatorId,
        pointId: point.id,
        type: "REPAIR",
        title: "Not mine",
        description: "Other",
      },
    })
  ).id;
});

afterAll(async () => {
  await wipe();
});

describe("readEngineerOrders", () => {
  it("gives the engineer the orders assigned to them", async () => {
    const orders = await readEngineerOrders(engineerUserId);
    expect(orders.map((o) => o.id)).toEqual([orderId]);
    expect(orders[0].where).toContain("Point");
  });

  it("gives a stranger nothing", async () => {
    expect(await readEngineerOrders(strangerUserId)).toEqual([]);
  });

  it("gives the owner of the network every open order", async () => {
    const orders = await readEngineerOrders(ownerUserId);
    expect(orders.map((o) => o.id).sort()).toEqual([orderId, otherOrderId].sort());
  });
});

describe("readEngineerStock", () => {
  it("shows the van first and the network's stores after it", async () => {
    const view = await readEngineerStock(orderId, engineerUserId);
    expect(view).not.toBeNull();
    expect(view!.warehouses[0]).toMatchObject({ id: vanId, mine: true });
    expect(view!.warehouses[1]).toMatchObject({ id: centralId, mine: false });
    const inVan = view!.warehouses[0].items.find((i) => i.partId === partId);
    expect(inVan).toMatchObject({ qty: 2, serialTracked: true });
  });

  it("refuses an order that is not this person's", async () => {
    expect(await readEngineerStock(otherOrderId, engineerUserId)).toBeNull();
  });

  it("refuses a stranger", async () => {
    expect(await readEngineerStock(orderId, strangerUserId)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TESTENV npx vitest run src/lib/warehouse/engineer-view.test.ts`
Expected: FAIL — `Failed to resolve import "./engineer-view"`.

- [ ] **Step 3: Write the implementation**

`src/lib/warehouse/engineer-view.ts`:

```ts
// Что инженер видит на телефоне — §48 (наряд) и §49 («наличие у себя в
// машине и на ближайшем складе»).
//
// Один модуль на оба экрана, потому что список нарядов и снимок склада
// задают один и тот же вопрос — «что из этого моё» — и ответ на него не
// должен быть в двух местах.

import { WorkOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readEmployee } from "@/lib/staff/staff-service";

const OPEN: WorkOrderStatus[] = [
  WorkOrderStatus.NEW,
  WorkOrderStatus.ASSIGNED,
  WorkOrderStatus.EN_ROUTE,
  WorkOrderStatus.IN_PROGRESS,
  WorkOrderStatus.WAITING_PART,
  WorkOrderStatus.DONE,
];

export interface EngineerOrderRow {
  id: string;
  title: string;
  type: string;
  priority: string;
  status: WorkOrderStatus;
  where: string;
}

/** Мои наряды: назначенные мне, плюс все, если сеть или компания моя. */
export async function readEngineerOrders(userId: string): Promise<EngineerOrderRow[]> {
  const orders = await prisma.workOrder.findMany({
    where: {
      status: { in: OPEN },
      OR: [
        { assignee: { userId } },
        { operator: { claimedById: userId } },
        { company: { ownerUserId: userId } },
      ],
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: 50,
    include: {
      point: { select: { name: true, addressLine: true, city: true } },
      asset: { select: { name: true, address: true } },
    },
  });

  return orders.map((o) => ({
    id: o.id,
    title: o.title,
    type: o.type,
    priority: o.priority,
    status: o.status,
    where: [
      o.point?.name ?? o.asset?.name,
      o.point?.addressLine ?? o.asset?.address,
      o.point?.city,
    ]
      .filter(Boolean)
      .join(" · "),
  }));
}

export interface EngineerStockItem {
  partId: string;
  sku: string;
  name: string;
  qty: number;
  serialTracked: boolean;
}

export interface EngineerWarehouse {
  id: string;
  name: string;
  kind: string;
  city: string | null;
  /** Моя машина идёт первой: с неё списывают в девяти случаях из десяти. */
  mine: boolean;
  items: EngineerStockItem[];
}

export interface EngineerStockView {
  workOrderId: string;
  partsNeeded: string[];
  warehouses: EngineerWarehouse[];
  /** Время снимка: экран печатает его рядом, как офлайн-баланс §25. */
  at: string;
}

/**
 * Снимок «что я могу списать на этот наряд». Null, если наряд не мой: это
 * же решение потом повторит сервер при досыле, и повторит строже.
 */
export async function readEngineerStock(
  workOrderId: string,
  userId: string,
): Promise<EngineerStockView | null> {
  const order = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      operatorId: true,
      partsNeeded: true,
      assignee: { select: { id: true, userId: true } },
      operator: { select: { claimedById: true } },
    },
  });
  if (!order?.operatorId) return null;

  const isOwner = order.operator?.claimedById === userId;
  const employee = isOwner ? null : await readEmployee(order.operatorId, userId);
  if (!isOwner) {
    if (!employee) return null;
    const assignedToMe = order.assignee?.userId === userId;
    const mayWarehouse = employee.role.permissions.includes("warehouse.write");
    if (!assignedToMe || !mayWarehouse) return null;
  }

  const myEmployeeId = employee?.id ?? null;
  const warehouses = await prisma.warehouse.findMany({
    where: { operatorId: order.operatorId },
    include: {
      stock: { include: { part: true }, orderBy: { part: { name: "asc" } } },
    },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });

  const rows: EngineerWarehouse[] = warehouses
    // Чужой фургон инженеру не склад — его и не показываем.
    .filter(
      (w) =>
        isOwner ||
        w.kind !== "VAN" ||
        (myEmployeeId !== null && w.keeperEmployeeId === myEmployeeId),
    )
    .map((w) => ({
      id: w.id,
      name: w.name,
      kind: w.kind,
      city: w.city,
      mine: myEmployeeId !== null && w.keeperEmployeeId === myEmployeeId,
      items: w.stock.map((s) => ({
        partId: s.partId,
        sku: s.part.sku,
        name: s.part.name,
        qty: s.qty,
        serialTracked: s.part.serialTracked,
      })),
    }));

  rows.sort((a, b) => Number(b.mine) - Number(a.mine));

  return {
    workOrderId: order.id,
    partsNeeded: order.partsNeeded,
    warehouses: rows,
    at: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TESTENV npx vitest run src/lib/warehouse`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/warehouse/engineer-view.ts src/lib/warehouse/engineer-view.test.ts
git commit -m "feat(warehouse): the orders and the van an engineer sees on a phone"
```

---

### Task 6: раздел «наряды» в хабе телефона

**Files:**
- Modify: `src/lib/mobile/tabs.ts`
- Modify: `src/lib/mobile/shell-context.ts`
- Modify: `src/lib/mobile/tabs.test.ts` (создать, если его нет)
- Modify: `messages/en.json`, `messages/ru.json`, `messages/sk.json`

- [ ] **Step 1: Write the failing test**

Проверить `ls src/lib/mobile/`. Если `tabs.test.ts` есть — дописать блок,
если нет — создать файл с шапкой по образцу `offline-queue.test.ts`.

```ts
describe("moreSections — §22 hub", () => {
  it("offers work orders to staff and to nobody else", () => {
    const base = { signedIn: true, hasAsset: false, isCoopMember: false };
    expect(moreSections({ ...base, isStaff: true })).toContain("work");
    expect(moreSections({ ...base, isStaff: false })).not.toContain("work");
  });

  it("puts work orders first for staff: it is their job, not a setting", () => {
    expect(
      moreSections({ signedIn: true, hasAsset: false, isCoopMember: false, isStaff: true })[0],
    ).toBe("work");
  });

  it("shows a visitor nothing at all", () => {
    expect(
      moreSections({ signedIn: false, hasAsset: true, isCoopMember: true, isStaff: true }),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TESTENV npx vitest run src/lib/mobile/tabs.test.ts`
Expected: FAIL — тип `ShellCapabilities` не знает `isStaff`, раздела `work`
нет.

- [ ] **Step 3: Implement**

`src/lib/mobile/tabs.ts`:

```ts
export type MobileSection =
  | "work"
  | "station"
  | "coop"
  | "bookings"
  | "account"
  | "card"
  | "contacts"
  | "roaming";

export interface ShellCapabilities {
  signedIn: boolean;
  hasAsset: boolean;
  isCoopMember: boolean;
  /** Сотрудник сети с правом видеть наряды (§47). */
  isStaff: boolean;
}

export function moreSections(caps: ShellCapabilities): MobileSection[] {
  if (!caps.signedIn) return [];
  const sections: MobileSection[] = [];
  // Наряды впереди всего: для инженера это работа, а не настройка.
  if (caps.isStaff) sections.push("work");
  if (caps.hasAsset) sections.push("station");
  if (caps.isCoopMember) sections.push("coop");
  sections.push("bookings", "account", "card", "contacts", "roaming");
  return sections;
}

export const SECTION_HREF: Record<MobileSection, string> = {
  work: "/work-orders",
  station: "/station",
  coop: "/coop",
  bookings: "/bookings",
  account: "/account",
  card: "/card",
  contacts: "/contacts",
  roaming: "/roaming",
};
```

`src/lib/mobile/shell-context.ts`: добавить в интерфейс `isStaff: boolean;`,
в `Promise.all` — четвёртый запрос:

```ts
    prisma.employee.findFirst({
      where: { userId, role: { permissions: { has: "workorders.read" } } },
      select: { id: true },
    }),
```

(переменная `staff`), и в возвращаемый объект `isStaff: Boolean(staff)`.

Переводы — `app.sections.work` в трёх полных локалях: `"Work orders"`,
`"Наряды"`, `"Zákazky"`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `TESTENV npx vitest run src/lib/mobile`
Expected: PASS. `npx tsc --noEmit` — тоже без ошибок (остальные вызовы
`moreSections` получают `isStaff` из контекста).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mobile messages/en.json messages/ru.json messages/sk.json
git commit -m "feat(mobile): work orders in the §22 hub for staff"
```

---

### Task 7: экраны наряда

**Files:**
- Create: `src/app/[locale]/app/work-orders/page.tsx`
- Create: `src/app/[locale]/app/work-orders/[id]/page.tsx`
- Create: `src/components/mobile/work-order-screen.tsx`
- Modify: `messages/en.json`, `messages/ru.json`, `messages/sk.json`

Эта задача — экраны, и её доказательство — e2e из задачи 8, а не юнит-тест:
страница на сервере в этом проекте не покрывается vitest нигде (см. любой
экран этапа M2–M5). Поэтому TDD здесь идёт через Playwright: сперва
задача 8, прогон, падение, потом эта задача. Порядок коммитов — тот же.

- [ ] **Step 1: список нарядов**

`src/app/[locale]/app/work-orders/page.tsx` — серверный компонент по
образцу `src/app/[locale]/app/bookings/page.tsx`: `setRequestLocale`,
`auth()`, редирект на логин с `callbackUrl`, `readEngineerOrders`,
`Screen` из `@/components/mobile/screen`, список ссылок с
`data-testid="mobile-work-order-list"`, пустое состояние из
`app.work.empty`.

- [ ] **Step 2: один наряд**

`src/app/[locale]/app/work-orders/[id]/page.tsx`: `readEngineerStock(id,
userId)`; `null` → `notFound()`. Читает сам наряд (`prisma.workOrder`
с `point` и фотографиями) и отдаёт всё в `WorkOrderScreen` вместе с
переводами, как это делает `src/app/[locale]/app/station/page.tsx` с
`StationPanel`.

- [ ] **Step 3: клиентский экран**

`src/components/mobile/work-order-screen.tsx` — `"use client"`. Что он
делает:

- рисует адрес, «как найти», описание поломки, нужные запчасти, фотографии,
  кнопки следующих статусов;
- форма «списать запчасть»: склад (по умолчанию моя машина), запчасть,
  количество, серийный номер, если `serialTracked`, примечание;
- отправка: `navigator.onLine` ложно или `fetch` упал → `enqueue`;
  иначе `fetch` и `classify`, и `enqueue` только если вышло не `done`.
  Проще и честнее: **всегда** `enqueue`, потом сразу `flush`. Одна дорога
  для онлайна и офлайна, поэтому дорога для офлайна не бывает непроверенной;
- `flush` на монтировании, на событии `online` и по кнопке «отправить
  сейчас»;
- блок неотправленного с `data-testid="offline-queue"`: по строке на запись,
  метка, время, для отказа — слова сервера и кнопка «убрать»;
- `router.refresh()` после успешного досыла, иначе остаток на экране
  останется прежним.

Отправщик:

```tsx
const send = useCallback(
  async (op: QueuedOp): Promise<SendResult> => {
    const url =
      op.kind === "stock.issue" ? "/api/v1/stock-movements" : `/api/v1/work-orders/${op.workOrderId}/status`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": op.id },
        body: JSON.stringify(op.body),
      });
      return await classify(res);
    } catch {
      // fetch бросает только когда запрос не ушёл: это и есть офлайн.
      return { outcome: "offline" };
    }
  },
  [],
);
```

Перевод статуса наряда через очередь в этой задаче **не делается**:
маршрута `POST /v1/work-orders/{id}/status` в проекте нет, статус меняет
серверное действие `advanceOrder`. Кнопки статуса на телефоне зовут то же
действие напрямую и в офлайне просто не работают — очередь принимает только
`stock.issue`. Строка `workorder.status` в типе очереди остаётся для §48,
её закрывает отдельная работа вместе с чек-листом и подписью; `send`
выше бросает `new Error` на этом виде, чтобы отсутствие маршрута не выглядело
как офлайн.

- [ ] **Step 4: переводы**

`app.work.*` в en/ru/sk: `title`, `empty`, `where`, `howToFind`, `fault`,
`parts`, `photos`, `issue`, `warehouse`, `part`, `qty`, `serial`, `note`,
`send`, `queued`, `queuedHint`, `sendNow`, `rejected`, `dismiss`,
`snapshotAt`, `mine`, `onShelf`, `nothingHere`.

- [ ] **Step 5: сборка и прогон**

```bash
npx tsc --noEmit
npm run build
```

Expected: без ошибок.

- [ ] **Step 6: Commit**

```bash
git add src/app/\[locale\]/app/work-orders src/components/mobile/work-order-screen.tsx messages
git commit -m "feat(mobile): the §48 work order on a phone, with the §49 write-off"
```

---

### Task 8: e2e — списание без связи на живой сборке

**Files:**
- Create: `tests/e2e/mobile-work-order.mobile.spec.ts`

- [ ] **Step 1: Write the failing test**

По образцу `tests/e2e/mobile-transfer.mobile.spec.ts` (вход, фикстуры
через `PrismaClient`, `test.describe.configure({ mode: "serial" })`,
`test.use({ baseURL: process.env.PUBLIC_BASE_URL ?? "https://poolwatt.com" })`).
Фикстуры: сеть с владельцем, инженер-сотрудник с ролью ENGINEER, его машина
с двумя платами, наряд, назначенный на инженера.

Случаи:

1. **Списание без связи доходит.** Инженер открывает
   `/{locale}/app/work-orders/<id>`, `context.setOffline(true)`, списывает
   одну плату, видит её в `[data-testid="offline-queue"]`,
   `context.setOffline(false)`, нажимает «отправить сейчас», очередь
   пустеет, остаток на экране — одна плата. Проверка в базе:
   `stockMovement.count({ where: { workOrderId, kind: "ISSUE" } })` равен 1.
2. **Отказ по существу виден словами сервера.** В офлайне списывается
   девять плат из двух, после возврата связи запись становится отказом, её
   текст содержит `only 2`, и она остаётся на экране, пока её не убрали.
3. **Чужой наряд недоступен.** Посторонний аккаунт открывает тот же адрес и
   получает 404.

- [ ] **Step 2: Run to verify it fails**

```bash
npx playwright test tests/e2e/mobile-work-order.mobile.spec.ts --project=mobile
```

Expected: FAIL — страницы нет (404 на всех трёх случаях), пока задача 7 не
сделана.

- [ ] **Step 3: сделать задачу 7, если она ещё не сделана, и прогнать снова**

Run: тот же.
Expected: PASS, 3 случая.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/mobile-work-order.mobile.spec.ts
git commit -m "test(mobile): a part written off with no signal, on the live build"
```

---

### Task 9: проверка целиком и сборка APK

- [ ] **Step 1: вся батарея юнит-тестов**

```bash
cd ~/poolwatt
NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local \
  | tr -d '"' | sed 's|/poolwatt?|/poolwatt_test?|')" npx vitest run
```

Expected: всё зелёное. Известные флаки: `resolve-user.test.ts` и
`coop-pages.test.ts` при запуске подмножествами; в полном наборе проходят.
`bot/__tests__/tts-bilingual.test.ts` требует живого `OPENAI_API_KEY`.

- [ ] **Step 2: сборка и перезапуск сайта**

```bash
cd ~/poolwatt && npm run build && pm2 restart poolwatt-web
```

- [ ] **Step 3: вся батарея e2e**

```bash
cd ~/poolwatt && npm run test:e2e
```

Expected: всё зелёное, кроме прежней флаки `contractor-public.spec.ts`.

- [ ] **Step 4: APK**

```bash
/home/dv/bin/android-build
```

Expected: напечатанный адрес сборки.

- [ ] **Step 5: реестр и отчёт**

Обновить `inbox/TZ-STATUS.md`: US-49 из «частично» в «готово» с
доказательством (коммиты, тесты, адреса экранов), счёт историй, запись в
журнале с главным наблюдением — правом `warehouse.write`, которое никто не
проверял. Отчёт владельцу: русский текст плюс два MP3 (RU + SK).
