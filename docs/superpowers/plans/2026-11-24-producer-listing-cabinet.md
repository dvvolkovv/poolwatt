# План: кабинет производителя (Блок A — US-01, US-03, US-05)

Спецификация: `docs/superpowers/specs/2026-11-24-producer-listing-cabinet-design.md`

## Шаг 1. Хранилище документов

- [x] `src/lib/exchange/listing-docs.ts`: `storeDocument`, `readDocument`,
      `deleteDocument`, `sniffMime`, лимит 20 МБ.
- [x] Тест `listing-docs.test.ts`: тип по байтам, отказ на EXE, отказ на >20 МБ,
      путь не выходит за корень (`../`).
- [x] `var/` в `.gitignore`.

## Шаг 2. Черновик заявки вместе с компанией

- [x] `createCompany` создаёт `ListingApplication` в DRAFT в одной транзакции.
- [x] `addDocument` / `removeDocument` в `listing-service.ts` — только в DRAFT.
- [x] Тесты на обе операции и на запрет в SUBMITTED.

## Шаг 3. Маршрут скачивания

- [x] `GET /api/v1/listing-applications/[id]/documents/[docId]`.
- [x] Тест: владелец 200, чужой 403, ADMIN 200, неизвестный docId 404.

## Шаг 4. Письма

- [x] `src/lib/resend-listing.ts` + тексты в `messages/*.json` (`emails.notify.*`).
- [x] Вызов из серверного действия отправки и из `decideApplication`.

## Шаг 5. Страницы листинга

- [x] `/me/listing` + форма компании.
- [x] `/me/listing/[companyId]` + загрузка, удаление, отправка.
- [x] Пункт «Листинг» в боковом меню кабинета.
- [x] `bodySizeLimit: "24mb"` в `next.config.ts`.

## Шаг 6. Объекты и мониторинг (US-03)

- [x] `/me/listing/[companyId]/assets`: форма объекта, ключи, показания,
      правила продажи.
- [x] Серверные действия поверх `asset-service.ts`.

## Шаг 7. Дашборд токенов (US-05)

- [x] `/me/listing/[companyId]/tokens`: объект, период, итоги, партии, CSV.

## Шаг 8. Проверка

- [x] Вся юнит/интеграционная выборка на `poolwatt_test`.
- [x] e2e-сценарий производителя.
- [x] Сборка, рестарт, проверка страниц на живом сайте.
- [x] Реестр `inbox/TZ-STATUS.md` обновлён.
