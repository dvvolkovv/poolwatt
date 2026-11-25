# План: роуминг со списанием и взаиморасчётом (US-11)

Спецификация: `docs/superpowers/specs/2026-11-25-roaming-settlement-design.md`.
Порядок — по TDD: тест, потом код, коммит после каждого зелёного шага.

- [x] 1. Арифметика. `roamingDebit` и `roamingAffordableKwh` в
      `src/lib/exchange/roaming.ts`, тесты в `roaming.test.ts`.
- [ ] 2. Водопад. Ступень роуминга в `planCharge` (`src/lib/exchange/charge.ts`):
      новый вход `roaming`, выходы `kwhFromRoaming`, `roamingDebitKwh`,
      `roamingFeeKwh`, источник `"roaming"`; тесты в `charge.test.ts`.
- [ ] 3. Схема. Модель `RoamingSettlement` и перечисление статуса, миграция.
- [ ] 4. Коридор для сессии. `resolveRoamingLeg` в `roaming-service.ts`:
      домашняя зона, коридор, курс, остаток суточного предела из сеансов за
      сутки; `quoteRoaming` считает предел накопленным за сутки. Тесты.
- [ ] 5. Списание. `quoteCharge` и `chargeSession` в `payment-service.ts`
      сжигают домашние партии, пишут `RoamingSettlement` и строки роуминга в
      чек в той же транзакции. Интеграционные тесты, включая повтор ключа и
      две одновременные сессии.
- [ ] 6. Взаимозачёт. `readRoamingPositions` и `netRoamingPeriod` в
      `roaming-service.ts` с записью в `AuditLog`. Тесты.
- [ ] 7. Страница водителя `/me/roaming`: коридоры, расчёт, подтверждение,
      ссылка на чек; серверные действия; ссылка в боковом меню `/me`.
- [ ] 8. Чек: строки роуминга на странице чека и в печатной версии.
- [ ] 9. Страница оператора `/admin/roaming`: коридоры, позиции, закрытие
      периода; ссылка в меню админа.
- [ ] 10. Переводы RU/EN/SK для обеих страниц.
- [ ] 11. e2e `tests/e2e/roaming.spec.ts` на живой сборке; весь набор тестов;
      сборка и перезапуск процессов; реестр и отчёт владельцу.
