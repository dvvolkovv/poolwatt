# План: эффективность кампании (US-44)

Спецификация: `docs/superpowers/specs/2026-11-25-campaign-analytics-design.md`.

- [x] 1. Схема `ContentEvent` + миграция.
- [x] 2. `content-events.ts`: запись события с проверками. Тесты.
- [x] 3. `POST /v1/marketing/events` и клиентский трекер в блоке контента
      (показ, клик, просмотр видео).
- [x] 4. `campaign-analytics.ts`: метрики §44 по кампании и по контенту. Тесты.
- [x] 5. Страница «Эффективность» в кабинете кампаний.
- [x] 6. `GET /v1/campaigns/{id}/stats` с `?format=csv`.
- [x] 7. Переводы RU/EN/SK.
- [ ] 8. e2e; весь набор; сборка; реестр и отчёт.
