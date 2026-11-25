# Маркетинг партнёра и подарочные кВт·ч — план

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> или superpowers:executing-plans. Шаги отмечаются чекбоксами.

**Goal:** партнёр размещает контент в карточках своих пунктов и дарит клиентам
кВт·ч, которые тратятся только в его сети (§41–§45, US-40…US-43).

**Architecture:** спецификация `docs/superpowers/specs/2026-11-25-marketing-and-gifts-design.md`.
Контент — `MarketingContent` + `MarketingAsset`, файлы вне веб-корня, видимость
считает чистая функция. Подарок — `PromoGrant`, не токены в кошельке водителя;
энергию под него даёт кошелёк партнёра. Водопад оплаты получает нулевой шаг.

**Tech Stack:** Next.js 16 App Router, Prisma, Postgres, vitest, Playwright.

Тесты только против `poolwatt_test`:
`NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local | tr -d '"' | sed 's|/poolwatt?|/poolwatt_test?|')" npx vitest run <путь>`

---

## Часть 1. Контент карточки (US-40)

### Задача 1. Длина видео из контейнера MP4

**Файлы:** создать `src/lib/marketing/mp4-duration.ts`, `src/lib/marketing/mp4-duration.test.ts`

- [x] Тест: `mp4DurationMs` на собранном в тесте буфере `ftyp` + `moov/mvhd`
      версии 0 (timescale 1000, duration 42_000) даёт 42_000.
- [x] Тест: `mvhd` версии 1 (64-битные поля) читается.
- [x] Тест: буфер без `moov` даёт `null`.
- [x] Тест: `moov` внутри `box` размера 1 (расширенный размер) не зацикливается.
- [x] Прогнать — падают.
- [x] Реализация: обход дерева коробок на верхнем уровне, спуск в `moov`,
      чтение `mvhd`. Размер 0 — коробка до конца буфера; размер 1 —
      64-битный размер в следующих восьми байтах.
- [x] Прогнать — зелено. Коммит.

### Задача 2. Хранилище медиа

**Файлы:** создать `src/lib/marketing/media-storage.ts`, `src/lib/marketing/media-storage.test.ts`

- [x] Тесты: `sniffMediaMime` узнаёт JPEG, PNG, WebP, MP4 и отвергает чужое;
      картинка больше 5 МБ отвергается; видео больше 50 МБ отвергается;
      MP4 длиннее 60 с отвергается; MP4 без `mvhd` отвергается;
      `saveMedia` → `readMedia` возвращает те же байты; `deleteMedia` убирает.
- [x] Прогнать — падают. Реализация по образцу `listing-docs.ts`
      (`MARKETING_MEDIA_DIR`, по умолчанию `var/marketing-media`).
- [x] Зелено. Коммит.

### Задача 3. Схема

**Файлы:** изменить `prisma/schema.prisma`, миграция.

- [x] `MarketingContent`, `MarketingAsset`, перечисления
      `MarketingContentType`, `MarketingAudience`, `MarketingStatus`;
      связи у `ChargerOperator` и `GridZone`.
- [x] `npx prisma migrate dev --name marketing_content` против `poolwatt_test`,
      затем `migrate deploy` против рабочей базы.
- [x] Коммит.

### Задача 4. Видимость и выбор — чистые функции

**Файлы:** создать `src/lib/marketing/visibility.ts`, `src/lib/marketing/visibility.test.ts`

- [x] Тесты `isContentLive`: черновик не живой; одобренный без расписания —
      живой; до `startsAt` и после `endsAt` — нет; день недели вне `weekdays`
      — нет; час вне `[hourFrom,hourTo)` — нет; окно через полночь (22→6)
      живое в 23 и в 5, мёртвое в 12.
- [x] Тесты `matchesAudience`: `ALL` всем; `NEWCOMERS` только при нуле
      зарядок в сети; `REGULARS` от трёх; `COOP_MEMBERS` только члену;
      `CARD_HOLDERS` никому.
- [x] Тест `selectForPlacement`: отбирает по месту, баннер первым, мёртвое
      и не по аудитории отбрасывает.
- [x] Прогнать — падают. Реализация. Зелено. Коммит.

### Задача 5. Сервис контента

**Файлы:** создать `src/lib/marketing/content-service.ts`, `src/lib/marketing/content-service.test.ts`

- [x] Тесты против базы: `createContent` принадлежит сети и начинается
      черновиком; чужой человек получает ошибку; `attachAsset` кладёт файл и
      строку; баннеру больше одного файла нельзя; в галерее не больше десяти;
      `submitForReview` без обязательного файла отказывает; `decideContent`
      только оператором Poolwatt, отказ пишет записку и возвращает в черновик;
      `readLiveContent(pointId, placement, viewer)` отдаёт только живое и
      по области пункта (`pointIds` пусто = вся сеть).
- [x] Прогнать — падают. Реализация. Зелено. Коммит.

### Задача 6. Маршрут отдачи медиа и REST создания

**Файлы:** создать `src/app/api/v1/marketing/media/[assetId]/route.ts`,
`src/app/api/v1/partners/[id]/content/route.ts`

- [x] Тест интеграцией (vitest, вызов обработчика): одобренный живой контент
      отдаётся гостю; черновик гостю — 404, владельцу — 200.
- [x] Реализация: `GET` по `assetId`, `Content-Type` из строки,
      `Cache-Control: private, max-age=60`. `POST /v1/partners/{id}/content` —
      multipart, `Idempotency-Key` не нужен: денег и энергии не двигает.
- [x] Зелено. Коммит.

### Задача 7. Кабинет партнёра

**Файлы:** создать `src/app/[locale]/me/charger-operator/[id]/marketing/page.tsx`,
`.../marketing/actions.ts`, `.../marketing/content-form.tsx`;
изменить `src/app/[locale]/me/charger-operator/[id]/page.tsx` (ссылка),
`messages/{en,ru,sk}.json` (раздел `marketing`).

- [x] Список контента со статусом, запиской модератора и предпросмотром.
- [x] Форма: тип, заголовок, текст, ссылка, файлы, места показа, аудитория,
      расписание, пункты. Серверные действия над `content-service`.
- [x] Коммит.

### Задача 8. Модерация оператором

**Файлы:** создать `src/app/[locale]/admin/marketing/page.tsx`,
`.../admin/marketing/actions.ts`, `src/lib/marketing/content-mail.ts`;
изменить `src/app/[locale]/admin/layout.tsx`.

- [x] Очередь `REVIEW`, решение с запиской, письмо владельцу сети.
- [x] Коммит.

### Задача 9. Показ: карточка, навигатор, экран завершения зарядки

**Файлы:** создать `src/components/marketing/content-block.tsx`;
изменить `src/app/[locale]/c/[id]/page.tsx`,
`src/app/[locale]/navigator/station-card.tsx`,
`src/app/[locale]/me/wallet/receipts/[id]/page.tsx`.

- [x] Полная карточка — все типы; мини-карточка — только баннер;
      страница чека — `CHARGE_COMPLETE` сети того пункта.
- [x] Сборка, e2e `tests/e2e/marketing-content.spec.ts`: загрузка, модерация,
      показ в карточке, контент вне расписания не показан.
- [x] Коммит.

---

## Часть 2. Подарочные кВт·ч (US-41, US-42, US-43)

### Задача 10. `pointId` доходит до оплаты

**Файлы:** изменить `src/lib/exchange/payment-service.ts`,
`src/app/api/v1/payments/charge/route.ts`, тест `src/lib/exchange/exchange-flow.test.ts`.

- [x] Тест: зарядка с `pointId` и `connectorId` пишет их в `Payment`, и чек
      печатает бренд сети; чужой `pointId` (пункт другой сети) принимается,
      но пункт не из нашей базы — отказ.
- [x] Реализация: поля в `ChargeInput`, в `payment.create`, в схему тела
      маршрута; проверка, что пункт существует.
- [x] Зелено. Коммит.

### Задача 11. Схема кампаний

**Файлы:** изменить `prisma/schema.prisma`, миграция; `src/lib/exchange/gates.ts`.

- [x] `Campaign`, `PromoGrant`, перечисления; `Payment.campaignsEvaluatedAt`.
- [x] `campaignFiatFundingOpen()` + `assertCampaignFiatFundingOpen()`, тест в
      `gates.test.ts`: закрыт без `CAMPAIGN_FIAT_FUNDING`.
- [x] Миграция, коммит.

### Задача 12. Выдача подарка

**Файлы:** создать `src/lib/marketing/campaign-engine.ts`,
`src/lib/marketing/campaign-engine.test.ts`.

- [x] Тесты: первая зарядка в сети даёт подарок с правильным сроком; вторая
      по `FIRST_CHARGE` не даёт; `oncePerClient` держится правилом базы при
      двух одновременных вызовах; `NTH_CHARGE` даёт только на N-ной;
      `VOLUME_PERIOD` даёт при наборе объёма за период; бюджет на исходе —
      кампания `EXHAUSTED`, подарка нет; зарядка без `pointId` — ничего;
      зарядка в пункте вне `scopePointIds` — ничего; второй проход по той же
      оплате не удваивает.
- [x] Прогнать — падают. Реализация. Зелено. Коммит.

### Задача 13. Письмо о подарке и проход воркера

**Файлы:** создать `src/lib/marketing/gift-mail.ts`; изменить
`worker/index.ts` (или где стоят проходы), `src/lib/exchange/payment-service.ts`.

- [x] Тест: `awardAfterCharge` ставит `campaignsEvaluatedAt`; проход воркера
      берёт оплаты, где поле пусто, и не берёт остальные; письмо ушло,
      `notifiedAt` заполнен.
- [x] Реализация: вызов после захвата оплаты без `await`, проход раз в минуту.
- [x] Зелено. Коммит.

### Задача 14. Водопад: подарок списывается первым и только в своей сети

**Файлы:** изменить `src/lib/exchange/charge.ts`, `src/lib/exchange/charge.test.ts`,
`src/lib/exchange/payment-service.ts`; создать `src/lib/marketing/grant-spend.ts`,
`src/lib/marketing/grant-spend.test.ts`.

- [ ] Тесты `planCharge`: `giftKwh` тратится раньше баланса; подарок больше
      запроса тратится частично; ноль подарка ничего не меняет; цена считается
      только по купленному.
- [ ] Тесты `grant-spend`: отбор подарков по пункту — только своя сеть и
      область; раньше истекает — раньше тратится; списание растит `usedKwh` и
      закрывает исчерпанный подарок; партии жгутся из кошелька партнёра;
      кошелька не хватает — подарок не применён, кампания `PAUSED` с причиной;
      две одновременные зарядки одним подарком тратят его один раз.
- [ ] Тест сквозной: зарядка в чужой сети подарок не тратит (US-43); чек
      печатает строку подарка; `Wallet.kwhBalance` водителя подарком не вырос,
      и заявкой на продажу подарок не продаётся (§43).
- [ ] Прогнать — падают. Реализация. Зелено. Коммит.

### Задача 15. Сгорание возвращает бюджет

**Файлы:** изменить `src/lib/marketing/campaign-engine.ts`, его тест, воркер.

- [x] Тесты: истёкший подарок становится `EXPIRED`, неиспользованный остаток
      вернулся в бюджет; кампания из `EXHAUSTED` снова `ACTIVE`; полностью
      использованный подарок бюджет не возвращает; повторный проход не
      возвращает дважды.
- [x] Реализация + проход воркера. Зелено. Коммит.

### Задача 16. Конструктор кампаний в кабинете

**Файлы:** создать `src/app/[locale]/me/charger-operator/[id]/campaigns/page.tsx`,
`.../campaigns/actions.ts`, `.../campaigns/campaign-form.tsx`; изменить
кабинет (ссылка) и `messages/{en,ru,sk}.json`.

- [ ] Форма по таблице §42 для подарка в кВт·ч; список кампаний с выданным,
      использованным и сгоревшим объёмом; бюджет в деньгах отказывает
      закрытым переключателем.
- [ ] Коммит.

### Задача 17. «Подарки» у клиента (US-42)

**Файлы:** создать `src/app/[locale]/me/gifts/page.tsx`,
`src/app/api/v1/wallets/me/gifts/route.ts`; изменить
`src/app/[locale]/me/wallet/page.tsx`, навигатор (фильтр по сети),
`messages/{en,ru,sk}.json`.

- [ ] Раздел: партнёр, остаток, срок, кнопка «Показать станции» → навигатор
      по этой сети. Чужие подарки не видны.
- [ ] e2e `tests/e2e/gifts.spec.ts`: подарок виден, кнопка ведёт в навигатор,
      трата в своей сети уменьшает остаток, в чужой — нет.
- [ ] Коммит.

### Задача 18. Сборка, вся сходимость, реестр

- [ ] `npm run build`, весь vitest против `poolwatt_test`, e2e.
- [ ] `pm2 restart poolwatt-web poolwatt-worker`.
- [ ] Реестр: US-40…US-43 со доказательствами, US-44 в блок L, вопросы
      владельцу (push-ключи, правила контента, EMI).
