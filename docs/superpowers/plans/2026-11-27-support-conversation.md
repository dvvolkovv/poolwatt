# Поддержка: заявка становится разговором — план (§48, §51)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan
> task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Выполнено 2026-11-27.** Расхождения с планом — в конце файла.

**Goal:** заявка §51 перестаёт быть письмом в пустоту: у неё есть разговор,
срок ответа с эскалацией §48, фотографии с места, экран у водителя и рабочее
место у поддержки.

**Architecture:** `TicketMessage` append-only несёт разговор;
`ticket-access.ts` — единственный ответ на вопрос «кому можно» (заявитель,
сотрудник в области §47, владелец, оператор); `ticket-conversation.ts` —
правила статусов и первый ответ; эскалация и «станция снова работает» живут
проходом воркера рядом с существующими уведомлениями; фотографии устроены как
фотографии пункта (вне веб-корня, тип по первым байтам, маршрут решает
доступ); пятый вид канала §15 `ticket.{id}` доставляет сообщение живым.

**Tech Stack:** Next.js 16 (App Router), Prisma, vitest, Playwright.

Спецификация: `docs/superpowers/specs/2026-11-27-support-conversation-design.md`.

Юнит-тесты — против выбрасываемой базы:

```bash
NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local \
  | tr -d '"' | sed 's|/poolwatt?|/poolwatt_test?|')" npx vitest run <путь>
```

---

## Файлы

| Файл | За что отвечает |
| --- | --- |
| `prisma/schema.prisma` | `TicketMessage`, `TicketAuthorKind`; `Ticket.firstRespondedAt`, `escalatedAt`, `recoveryNotifiedAt`, `resolvedAt` |
| `src/lib/work/ticket-access.ts` | новый: кому можно читать и писать в заявку |
| `src/lib/work/ticket-access.test.ts` | новый |
| `src/lib/work/ticket-conversation.ts` | новый: сообщения, первый ответ, статусы, переоткрытие |
| `src/lib/work/ticket-conversation.test.ts` | новый |
| `src/lib/work/ticket-sla.ts` | новый: эскалация §48 и закрытие решённых |
| `src/lib/work/ticket-sla.test.ts` | новый |
| `src/lib/work/ticket-recovery.ts` | новый: «станция снова работает» |
| `src/lib/work/ticket-recovery.test.ts` | новый |
| `src/lib/work/ticket-photos.ts` | новый: хранение фотографий заявки и доступ к файлу |
| `src/lib/work/ticket-photos.test.ts` | новый |
| `src/lib/work/ticket-service.ts` | склейка повторной заявки, фотографии, системная запись об открытии наряда |
| `src/lib/exchange/realtime.ts` | пятый вид канала `ticket.{id}` |
| `src/app/api/v1/tickets/report/route.ts` | новый (§51) |
| `src/app/api/v1/tickets/me/route.ts` | новый (§51) |
| `src/app/api/v1/tickets/route.ts` | новый: очередь сети (§50) |
| `src/app/api/v1/tickets/[id]/messages/route.ts` | новый |
| `src/app/api/v1/ticket-photos/[key]/route.ts` | новый: отдача файла |
| `src/components/work/ticket-thread.tsx` | новый: разговор + поле ответа, живой канал |
| `src/app/[locale]/me/tickets/page.tsx` | новый: мои заявки |
| `src/app/[locale]/me/tickets/[id]/page.tsx` | новый: заявка и разговор |
| `src/app/[locale]/app/tickets/page.tsx` | новый: то же на телефоне |
| `src/app/[locale]/app/tickets/[id]/page.tsx` | новый |
| `src/lib/mobile/tabs.ts` | раздел `support` в хабе §22 |
| `src/app/[locale]/me/charger-operator/[id]/tickets/page.tsx` | очередь: срок, просрочка, ссылка на карточку |
| `src/app/[locale]/me/charger-operator/[id]/tickets/[id]/page.tsx` | новый: рабочее место поддержки |
| `src/app/[locale]/c/[id]/report/*` | фотографии в форме, ссылка «следить за заявкой» |
| `src/components/work/work-order-panel.tsx` | фотографии картинками, а не строками |
| `worker/index.ts` | два шага в `runAlertSweep` + закрытие решённых |
| `messages/{ru,en,sk}.json` | ветка `tickets` |
| `tests/e2e/support-conversation.spec.ts` | новый |
| `tests/e2e/support-conversation.mobile.spec.ts` | новый |

## Задачи

### 1. Схема

- [x] `enum TicketAuthorKind { CUSTOMER SUPPORT SYSTEM }`.
- [x] `model TicketMessage`: `id`, `ticketId` (cascade), `authorKind`,
      `authorId String?` + связь `User?` (`SetNull`), `body String @db.Text`,
      `createdAt`, индекс `[ticketId, createdAt]`.
- [x] `Ticket`: `firstRespondedAt DateTime?`, `escalatedAt DateTime?`,
      `recoveryNotifiedAt DateTime?`, `resolvedAt DateTime?`,
      `messages TicketMessage[]`, индекс `[operatorId, respondBy]`.
- [x] `User`: обратная связь `ticketMessages TicketMessage[]`.
- [x] Миграция на живую и на выбрасываемую базу, `npx prisma generate`.
- [x] Коммит.

### 2. Права (`ticket-access.ts`)

- [x] Тест: заявитель читает и пишет свою; сотрудник с `tickets.read` читает,
      но не пишет; с `tickets.write` пишет; заявка о пункте вне области
      сотрудника не видна совсем; владелец сети и `ADMIN` видят всё;
      посторонний не видит; анонимная заявка (`reporterId = null`) не видна
      никому, кроме сети и оператора.
- [x] Прогон — падает.
- [x] `readTicketForUser(ticketId, userId, role)` → `{ ticket, canRead,
      canWrite, authorKind }` или `null`. Область пунктов берётся из
      `can(employee, "tickets.read", ticket.pointId)`.
- [x] Прогон — зелено. Коммит.

### 3. Разговор (`ticket-conversation.ts`)

- [x] Тест: `postTicketMessage` от клиента в OPEN оставляет статус;
      первое сообщение поддержки ставит `firstRespondedAt` и переводит в
      IN_PROGRESS; второе сообщение поддержки отметку не двигает;
      `resolveTicket` без текста отвергается; `resolveTicket` со словами
      ставит RESOLVED, `resolvedAt` и пишет сообщение; клиент пишет в
      RESOLVED → IN_PROGRESS и `resolvedAt` обнуляется; в CLOSED не пишет
      никто (`TicketError`); `systemMessage` пишет запись без автора и
      статуса не трогает.
- [x] Прогон — падает.
- [x] Реализация: одна транзакция на сообщение, `firstRespondedAt`
      выставляется условным `updateMany` (`firstRespondedAt: null`), чтобы
      два одновременных ответа дали одну отметку. Публикация в канал
      `ticket.{id}` — после фиксации, в `try/catch`, как в `publish` у
      ордеров.
- [x] Тест гонки: два одновременных первых ответа поддержки → одна отметка,
      два сообщения.
- [x] Прогон — зелено. Коммит.

### 4. Канал §15

- [x] Тест в `realtime.test.ts`: `ticketChannel(id)` известен,
      не публичный; билет на чужой канал заявки не выдаётся.
- [x] `isKnownChannel` получает `ticket`; `ticketChannel`.
- [x] `POST /v1/realtime/ticket` разрешает `ticket.{id}` только тому, кому
      `readTicketForUser` дал `canRead`.
- [x] Прогон — зелено. Коммит.

### 5. Фотографии (`ticket-photos.ts`)

- [x] Тест: `sniffImage` принимает JPEG, PNG, WebP и отвергает PDF;
      четвёртая фотография отвергается (`MAX_TICKET_PHOTOS = 3`);
      6 МБ отвергаются; ключ с `../` отвергается; `readTicketPhoto`
      отдаёт байты по ключу.
- [x] Прогон — падает.
- [x] Реализация по образцу `src/lib/points/point-photos.ts`: корень
      `process.env.TICKET_PHOTOS_DIR || "var/ticket-photos"`, ключ
      `<ticketId>/<random>.<ext>`, запись в `Ticket.photos`.
- [x] `GET /api/v1/ticket-photos/[key]`: доступ, если
      `readTicketForUser.canRead`, **или** если тот же ключ есть в
      `WorkOrder.photos` и человек может читать этот наряд
      (`can(employee, "workorders.read", pointId)` или он исполнитель).
      Иначе 404.
- [x] Прогон — зелено. Коммит.

### 6. Отправка заявки: склейка, фотографии, системная запись

- [x] Тест в `ticket-service.test.ts`: вошедший заявитель, повторивший тот же
      пункт и тот же тип в пределах пяти минут, получает ту же заявку;
      шесть минут — новую; анонимные заявки не склеиваются; технический тип
      пишет системное сообщение «наряд открыт»; фотографии попадают и в
      заявку, и в наряд.
- [x] Прогон — падает.
- [x] `reportProblem` принимает `photos: {bytes, filename}[]`, сохраняет их
      и кладёт ключи в оба места; склейка — `findFirst` по
      `(reporterId, pointId, problemType, status in [OPEN, IN_PROGRESS],
      createdAt > now - 5 мин)`.
- [x] Тест гонки: два одновременных отчёта вошедшего заявителя → одна заявка
      (уникальный индекс не годится — окно по времени; гонку закрывает
      транзакция с `FOR UPDATE` на пользователе-заявителе; если и это
      допускает две, тест фиксирует фактическое поведение и решение
      записывается здесь).
- [x] Прогон — зелено. Коммит.

### 7. SLA и эскалация (`ticket-sla.ts`)

- [x] Тест: заявка без ответа с прошедшим `respondBy` поднимается на ступень
      приоритета, получает `escalatedAt`, системное сообщение и письмо;
      второй проход ничего не делает; заявка с `firstRespondedAt` не
      эскалируется; URGENT остаётся URGENT; ответ после эскалации приоритет
      не опускает; `closeResolvedTickets` закрывает решённые старше семи
      дней и не трогает более свежие.
- [x] Прогон — падает.
- [x] Реализация: `escalateOverdueTickets(now, { sendTo })`,
      `closeResolvedTickets(now)`. Письмо — владельцу сети и на
      `operator.email`, по образцу `notifyPendingWorkOrders`.
- [x] Прогон — зелено. Коммит.

### 8. «Станция снова работает» (`ticket-recovery.ts`)

- [x] Тест: заявка с техническим типом и разъёмом, который больше не
      `OUT_OF_SERVICE`, получает системное сообщение, письмо заявителю и
      `recoveryNotifiedAt`; второй проход молчит; разъём всё ещё
      `OUT_OF_SERVICE` — молчит; CLOSED — молчит; заявка без разъёма —
      молчит; заявитель без подтверждённой почты письма не получает, но
      системная запись есть.
- [x] Прогон — падает.
- [x] `notifyRecoveredTickets(now, { sendTo })`.
- [x] Прогон — зелено. Коммит.

### 9. Воркер

- [x] Три шага в `runAlertSweep`: `escalateOverdueTickets`,
      `notifyRecoveredTickets`, `closeResolvedTickets` — каждый в своём
      `try/catch`, как остальные шаги прохода.
- [x] Прогон полного набора юнит-тестов. Коммит.

### 10. API §50/§51

- [x] `POST /v1/tickets/report` — то же, что серверное действие формы.
- [x] `GET /v1/tickets/me` — свои заявки с последним сообщением.
- [x] `GET /v1/tickets?operatorId=` — очередь по праву `tickets.read`,
      чужая сеть 404.
- [x] `POST /v1/tickets/{id}/messages` — сообщение; без `canWrite` 404.
- [x] Прогон. Коммит.

### 11. Экран водителя

- [x] `src/components/work/ticket-thread.tsx` — разговор, поле ответа,
      `useChannel("ticket.{id}")`, пометка «ждёт ответа поддержки» и срок.
- [x] `/{locale}/me/tickets` — список: пункт, тип, статус, срок, последнее
      сообщение.
- [x] `/{locale}/me/tickets/[id]` — состояние, фотографии, разговор; чужая
      заявка 404.
- [x] `/{locale}/app/tickets` и `/{locale}/app/tickets/[id]` — одна колонка,
      те же серверные действия.
- [x] `tabs.ts`: раздел `support` → `/tickets`, перед `bookings`; тест
      `tabs.test.ts` на новый раздел.
- [x] Экран отправки заявки §51: ссылка «следить за заявкой» вошедшему,
      предложение войти остальным; загрузка до трёх фотографий.
- [x] Переводы `ru`, `en`, `sk`. Сборка. Коммит.

### 12. Рабочее место поддержки

- [x] `/me/charger-operator/[id]/tickets` — срок, просрочка (подсветка),
      «ждёт ответа», ссылка на карточку.
- [x] `/me/charger-operator/[id]/tickets/[id]` — разговор, ответ, «решено»
      со словами (кнопка требует текста), наряд, фотографии, заявитель;
      всё под `tickets.write`, чтение под `tickets.read`.
- [x] `work-order-panel.tsx` рисует фотографии картинками через
      `/api/v1/ticket-photos/[key]`.
- [x] Сборка. Коммит.

### 13. e2e на живой сборке

- [x] `tests/e2e/support-conversation.spec.ts`: водитель отправляет заявку с
      фотографией и открывает её; поддержка отвечает и у заявки появляется
      отметка срока реакции; водитель видит ответ; поддержка решает словами;
      водитель пишет в решённую, и она открывается заново; чужая заявка 404;
      фотография отдаётся заявителю и не отдаётся постороннему.
- [x] `tests/e2e/support-conversation.mobile.spec.ts` на Pixel 7: раздел
      «Поддержка» в хабе, заявка и ответ с телефона.
- [x] `npm run build && pm2 restart poolwatt-web poolwatt-worker`.
- [x] Полный прогон: юнит + e2e. Коммит.

### 14. Отчёт

- [x] `inbox/TZ-STATUS.md`: блок N, часть первая — закрыта; что осталось в
      блоке; вопрос владельцу про входящую почту §48.
- [x] Отметить шаги плана и записать расхождения.
- [x] Отчёт владельцу: текст по-русски + два MP3 (RU и SK).

## Расхождения с планом

- **Пятый канал §15 потребовал изменить сам способ выдачи билета.**
  `POST /v1/realtime/ticket` перечислял каналы заранее, и для заявок это не
  годится: у сотрудника поддержки их сотни, а страница смотрит одну. Канал
  теперь приезжает в теле запроса и проверяется по имени; `useChannel`
  сообщает, какой канал ему нужен. Остальные страницы не затронуты — их
  каналы по-прежнему в перечне по умолчанию.
- **Комментарий клиента стал первой репликой разговора.** В плане этого не
  было: §51.5 обещает переписку, и читаться она должна с начала, а не с
  ответа поддержки. Поле `Ticket.comment` осталось — по нему живёт очередь и
  описание наряда.
- **Фотографии складываются в `Ticket.photos` без своей таблицы**, и файл
  находится обратным поиском по ключу. Выгода неочевидная и важная: ту же
  фотографию несёт наряд, и маршрут файла спрашивает про право на наряд, не
  зная ничего о заявке.
- **Отказ по файлу не теряет заявку.** В `reportProblem` сохранение
  фотографий обёрнуто так, что жалоба уходит даже если снимок не принят:
  тридцать секунд §51 важнее снимка.
- **`ticket-view.ts` появился сверх плана** — один читатель на четыре
  страницы. Иначе «ждёт ответа» и «просрочено» считались бы в четырёх местах
  и однажды разошлись.
- **Решать заявку может только сторона поддержки.** В плане это не было
  сказано: кнопки «решено» у клиента нет, и серверное действие тоже её не
  примет, даже если позвать его руками.
- **Нового APK нет и не нужно:** оболочка открывает живой сайт, экраны
  §22 появились на телефоне сами. Проверено проектом `mobile` на Pixel 7
  через настоящий домен.
- **Статический импорт в e2e вместо динамического.** `await import()` внутри
  теста Playwright падает с «Cannot use import statement outside a module» —
  спецификация компилируется в CJS. Импорт на верхнем уровне работает.
