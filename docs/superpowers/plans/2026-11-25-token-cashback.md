# План: кэшбэк за оплату токенами (US-12)

Спецификация: `docs/superpowers/specs/2026-11-25-token-cashback-design.md`.

- [x] 1. Арифметика `cashbackKwh` в `src/lib/marketing/cashback.ts` + тесты.
- [x] 2. Схема: `CampaignTrigger.TOKEN_PAYMENT`, `Campaign.cashbackPct`,
      `PromoGrant.paymentId`, `PromoGrant.onceKey`, две уникальности, миграция
      с переносом правила «один раз на клиента» в `onceKey`.
- [x] 3. `campaign-service.ts`: проверки кампании кэшбэка, `cashbackPct` в
      создании, правке и списке. Тесты.
- [x] 4. `campaign-engine.ts`: `awardCashback` в транзакции платежа —
      бюджет под блокировкой, право с `paymentId`, запись в `AuditLog`. Тесты.
- [x] 5. `payment-service.ts`: база из токенов, вызов начисления, строка
      `cashbackKwh` в разбивке чека. Интеграционные тесты, включая повтор
      ключа и две одновременные зарядки.
- [x] 6. Чек: `cashbackKwh` в документе §46.6 и на странице чека.
- [x] 7. `/me/gifts`: источник права (подарок или кэшбэк) и ссылка на чек.
- [x] 8. Кабинет партнёра: триггер и доля в конструкторе и в списке.
- [x] 9. Переводы RU/EN/SK.
- [x] 10. e2e `tests/e2e/cashback.spec.ts`; весь набор; сборка; реестр и отчёт.
