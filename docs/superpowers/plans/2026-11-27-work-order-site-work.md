# §48 Site Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An engineer standing at a broken station works the order on their phone — ticks the checklist, photographs before and after, takes a signature and closes it, with or without a network (ТЗ §48).

**Architecture:** One access module replaces three divergent permission checks. A checklist is instantiated lazily from a per-type template, so orders that already exist get one. Closing asks the checklist and the signature, because a checklist nothing enforces is decoration. Before/after photos get their own table and store, apart from the customer's photos the order already carries. Ticks, the signature and the close ride the existing offline queue, which until now declared a `workorder.status` kind that nothing sent and no endpoint received.

**Tech Stack:** Next.js 16 App Router, Prisma/Postgres, vitest, Playwright, next-intl.

Spec: `docs/superpowers/specs/2026-11-27-work-order-site-work-design.md`.

`TESTENV` below means the throwaway-database prefix from CLAUDE.md:

```bash
NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local | tr -d '"' \
  | sed 's|/poolwatt?|/poolwatt_test?|')"
```

---

### Task 1: Schema

- [x] **Step 1:** add `WorkOrderTask`, `WorkOrderPhoto`, `WorkOrderSignature`,
      `WorkOrderPhotoStage`, `WorkOrderSignerKind` exactly as the spec's
      Prisma block gives them, with back-relations `tasks`, `sitePhotos`,
      `signature` on `WorkOrder`.
- [x] **Step 2:** `npx prisma migrate dev --name work_order_site_work`, then
      `TESTENV npx prisma migrate deploy`, then `npx prisma generate`.
- [x] **Step 3:** commit.

### Task 2: One right on an order

**Files:** create `src/lib/work/work-order-access.ts` + its test.

- [x] **Step 1:** write the failing test — assignee may work, network owner
      may work, employee with `workorders.write` in scope may work, employee
      with only `workorders.read` may read and not work, a stranger gets
      null, platform ADMIN may work, and a company-owned order answers the
      company's owner.
- [x] **Step 2:** run it, watch it fail.
- [x] **Step 3:** write `readWorkOrderForUser(orderId, userId, role)` returning
      `{ order, canRead: true, canWork, employeeId } | null`, following
      `src/lib/work/ticket-access.ts` line for line in shape and comment
      style.
- [x] **Step 4:** run it green.
- [x] **Step 5:** commit.

### Task 3: The checklist

**Files:** create `src/lib/work/work-order-checklist.ts` + test.

- [x] **Step 1:** write the failing test — a template exists for each of the
      four `WorkOrderType`s; `ensureChecklist` creates the rows once; two
      concurrent calls create one set (`Promise.allSettled`, then count);
      `tickTask` stamps `doneAt`/`doneById` and clears `skipReason`;
      `skipTask` demands a reason and clears `doneAt`; `checklistBlocking`
      returns the unanswered **required** items and ignores optional ones.
- [x] **Step 2:** run it, watch it fail.
- [x] **Step 3:** implement. Templates as a `Record<WorkOrderType, {title, required}[]>`
      constant. `ensureChecklist` wraps creation in `$transaction` with
      `createMany({ skipDuplicates: true })` against the
      `@@unique([workOrderId, position])`, so a race makes one set.
- [x] **Step 4:** run it green.
- [x] **Step 5:** commit.

### Task 4: Photos and the signature

**Files:** create `src/lib/work/work-order-media.ts` + test.

- [x] **Step 1:** write the failing test — a JPEG is stored under the order
      with a stage and comes back by key; a text file is refused; a 6 MB file
      is refused; the seventh photo of one stage is refused while the other
      stage still accepts; `saveSignature` stores the PNG and the signer's
      name and kind; a second signature replaces the first and writes an
      audit entry.
- [x] **Step 2:** run it, watch it fail.
- [x] **Step 3:** implement, reusing `sniffImage` from
      `src/lib/work/ticket-photos.ts` (import it, do not copy it). Root
      `process.env.WORK_ORDER_MEDIA_DIR || "var/work-order-media"`.
      `MAX_STAGE_PHOTOS = 6`, `MAX_PHOTO_BYTES = 5 * 1024 * 1024`.
- [x] **Step 4:** run it green.
- [x] **Step 5:** commit.

### Task 5: Closing asks

**Files:** modify `src/lib/work/work-order-service.ts` + its test.

- [x] **Step 1:** write the failing test — `advanceWorkOrder(..., "DONE")`
      is refused while a required item is unanswered, refused without a
      signature, and succeeds once both are there; `CANCELLED` is not held by
      either (a cancelled job was not done); `VERIFIED` from `DONE` still
      works.
- [x] **Step 2:** run it, watch it fail.
- [x] **Step 3:** implement: before writing `DONE`, call `checklistBlocking`
      and read the signature; throw `WorkOrderError` naming what is missing.
- [x] **Step 4:** run the whole `src/lib/work/` and `src/lib/warehouse/`
      suites green (existing tests advance orders to DONE and will need a
      signature and a checklist — fix the fixtures, not the rule).
- [x] **Step 5:** commit.

### Task 6: The methods

**Files:** create `src/app/api/v1/work-orders/[id]/tasks/[taskId]/route.ts`,
`.../photos/route.ts`, `.../signature/route.ts`, `.../status/route.ts`,
`src/app/api/v1/work-order-media/[key]/route.ts`.

- [x] **Step 1:** read `src/app/api/v1/stock-movements/route.ts` for the
      idempotent-write shape the offline queue already talks to, and
      `src/app/api/v1/ticket-photos/[key]/route.ts` for the byte-serving
      shape.
- [x] **Step 2:** write the four write routes: all `POST`, all through
      `idempotent()` with `idempotencyKey(request)`, all deciding access with
      `readWorkOrderForUser` and answering 404 rather than 403. Bodies:
      tasks `{ done: boolean, skipReason?: string }`, photos
      `{ stage, filename, base64 }`, signature
      `{ signerKind, signerName, base64 }`, status `{ status, report? }`.
- [x] **Step 3:** write the media route: bytes if `readWorkOrderForUser` says
      the viewer may read the order the key belongs to, else 404.
- [x] **Step 4:** `npm run build`, then smoke each route with curl expecting
      a JSON body rather than an HTML error page.
- [x] **Step 5:** commit.

### Task 7: The phone

**Files:** modify `src/components/mobile/work-order-screen.tsx`,
`src/app/[locale]/app/work-orders/[id]/page.tsx`,
`src/lib/mobile/offline-queue.ts`, `messages/{ru,en,sk}.json`.

- [x] **Step 1:** add `workorder.task` and `workorder.signature` to
      `QueuedKind`, and give `send` in the screen a case per kind (it
      currently hard-codes the stock endpoint).
- [x] **Step 2:** add to the screen, below the parts block: the checklist
      (a row per task, a tick, and a "skip" that asks for a reason), the two
      photo strips with a camera input each, a signature canvas with a name
      field and a signer-kind choice, and a "close the order" button. Ticks,
      the signature and the close go through `enqueue`; a photo is sent
      directly and says so when there is no network.
- [x] **Step 3:** add the words to all three message files under
      `app.work`.
- [x] **Step 4:** `npm run build && pm2 restart poolwatt-web`, then open the
      screen on a real order and work it through.
- [x] **Step 5:** commit.

### Task 8: The cabinet

**Files:** modify `src/app/[locale]/me/work-orders/[id]/page.tsx` and
`src/app/[locale]/me/work-orders/actions.ts`.

- [x] **Step 1:** show the checklist, both photo strips and the signature on
      the cabinet page, and let somebody working from a monitor tick an item
      (a server action beside `advanceOrder`, access through
      `readWorkOrderForUser`).
- [x] **Step 2:** replace `mayTouch` in `actions.ts` with
      `readWorkOrderForUser`.
- [x] **Step 3:** build, restart, look at it.
- [x] **Step 4:** commit.

### Task 9: e2e

**Files:** create `tests/e2e/work-order-site-work.mobile.spec.ts` and
`tests/e2e/work-order-site-work.spec.ts`.

- [x] **Step 1:** phone spec on Pixel 7 against the real domain: the engineer
      opens the order, ticks two items, skips one with a reason, uploads an
      "after" photo, signs, closes; the order is `DONE` in the database with
      a signature row.
- [x] **Step 2:** desktop spec: the network's owner sees the checklist, the
      photo and the signature on the cabinet page; a stranger gets 404.
- [x] **Step 3:** run both, then the whole unit suite and the whole e2e
      suite.
- [x] **Step 4:** commit.

### Task 10: Tick the plan and the tracker

- [x] **Step 1:** tick every box above.
- [x] **Step 2:** split the N-3 row of `inbox/TZ-STATUS.md` into N-3-а (done)
      and N-3-б (manual creation, assignment by region and load, brigade,
      route), and write what was found before the work started.
- [x] **Step 3:** commit the plan (the tracker is gitignored).

---

## Где работа разошлась с планом

- **Маршрут к объекту уже был.** `WorkOrderPanel` в кабинете давно печатает
  координаты и ссылку «маршрут», так что из N-3-б эта строка §48 выпадает.
- **Проверка пункта в методе `tasks`**: сверка «этот пункт принадлежит этому
  наряду» делается чтением чек-листа наряда, а не отдельным запросом по
  `taskId` — так право на наряд и принадлежность пункта проверяются одним
  решением.
- **Найдено и исправлено попутно, и это важнее остального:**
  - *чек-бокс в кабинете не нажимался*. Управляемый `checkbox` без
    собственного состояния React возвращает в прежнее положение сразу после
    нажатия и держит так до ревалидации — для человека это «кнопка не
    работает». Нашлось только на живой сборке: юниты про это ничего не знают.
    Оба экрана теперь держат ответ у себя и пересинхронизируются с сервером;
  - *холст подписи лежал ниже видимой части экрана телефона*, и `page.mouse`
    страницу не прокручивает — до холста не доходило ни одного события.
    Это починка теста, а не кода, но без неё подпись «не работала»;
  - *географический поиск US-53 в тесте считал, что он один в базе*. Два
    новых набора тестов сдвинули расписание и это вылезло: теперь проверяется
    порядок своих пунктов, а не то, что в ответе больше никого нет.
- **`readEngineerStock` может вернуть null у законного наряда**: право на
  наряд и право на склад §47 — разные вещи, и инженер без `warehouse.write`
  всё равно работает наряд. Экран телефона теперь это переживает (пустой
  снимок склада), а раньше отдал бы 404.
