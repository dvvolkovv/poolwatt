# Возврат ошибочного чека и журнал изменений — план (§46)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** чек становится документом (замораживается в момент выдачи),
бухгалтер возвращает ошибочный чек в поддержку, поддержка выпускает
исправленную версию, и каждое изменение видно в журнале.

**Architecture:** снимок `ReceiptDocument` ложится в `Receipt.document`;
`readReceiptDocument` отдаёт снимок всем читателям; `ReceiptClaim` несёт
заявку и её решение, `ReceiptCorrection` — журнал «было/стало»; исправление
выпускает новый `Receipt` с `correctsReceiptId`, а книга месяца печатает номер
действующей версии.

**Tech Stack:** Next.js 16 (App Router), Prisma, vitest, Playwright.

Спецификация: `docs/superpowers/specs/2026-11-27-receipt-corrections-design.md`.

Юнит-тесты — против выбрасываемой базы (`TESTENV npx vitest run <путь>`):

```bash
NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local \
  | tr -d '"' | sed 's|/poolwatt?|/poolwatt_test?|')" npx vitest run <путь>
```

---

## Файлы

| Файл | За что отвечает |
| --- | --- |
| `prisma/schema.prisma` | `Receipt.document`, `correctsReceiptId`; `ReceiptClaim`; `ReceiptCorrection` |
| `src/lib/receipts/receipt-store.ts` | новый: снимок — запись, чтение, разбор дат |
| `src/lib/receipts/receipt-store.test.ts` | новый |
| `src/lib/receipts/receipt-claims.ts` | новый: заявка бухгалтера и решение поддержки |
| `src/lib/receipts/receipt-claims.test.ts` | новый |
| `src/lib/receipts/receipt-correction.ts` | новый: выпуск исправленной версии + журнал |
| `src/lib/receipts/receipt-correction.test.ts` | новый |
| `src/lib/exchange/gates.ts` | `receiptRefundsOpen()` |
| `src/lib/accounting/ledger.ts` | номер действующей версии, исправления не в книге |
| `src/app/[locale]/me/wallet/receipts/[id]/*` | снимок вместо живой сборки, ссылки между версиями |
| `src/app/[locale]/app/wallet/receipts/[id]/page.tsx` | то же на телефоне |
| `src/lib/receipts/receipt-delivery.ts` | письмо печатает снимок |
| `src/app/[locale]/me/charger-operator/[id]/accounting/*` | кнопка «вернуть в поддержку», пометки, журнал |
| `src/app/[locale]/admin/receipt-claims/*` | очередь поддержки, исправление, отказ |
| `src/lib/mail/*` | письмо оператору о заявке и бухгалтеру о решении |

## Задачи

### 1. Схема

- [ ] `Receipt.document Json?`, `Receipt.documentVersion Int @default(1)`,
      `Receipt.correctsReceiptId String?` + обратная связь.
- [ ] `ReceiptClaim`: чек, сеть, кто подал, причина (enum), текст, статус
      (`OPEN`, `CORRECTED`, `REJECTED`), кто и когда решил, решение.
- [ ] `ReceiptCorrection`: заявка, исходный чек, новый чек, кто, когда,
      `changes Json`.
- [ ] Миграция на живую базу и на выбрасываемую.

### 2. Чек как документ (TDD)

- [ ] `receipt-store.test.ts`: снимок пишется при первом чтении; правка ставки
      НДС у партнёра не меняет уже прочитанный чек; даты возвращаются датами;
      нет чека — `null`.
- [ ] `receipt-store.ts` (`readReceiptDocument`, `freezeReceiptDocument`).
- [ ] Перевести четырёх читателей (кабинет, телефон, печать, письмо).
- [ ] Весь прогон по чекам зелёный.

### 3. Заявка бухгалтера

- [ ] Тесты: право (`finance.read`, область пунктов, чужая сеть), заявка
      дважды, заявка на чужой чек, письмо оператору.
- [ ] `receipt-claims.ts` + серверное действие на странице месяца.

### 4. Исправление по регламенту

- [ ] Тесты: новая версия с новым номером и ссылками в обе стороны; запрещённое
      поле не меняется; суммы не меняются; причина «суммы» — отказ с текстом
      гейта; журнал «было/стало»; два одновременных исправления дают одну
      версию.
- [ ] `receipt-correction.ts`, `receiptRefundsOpen()` в гейтах.

### 5. Страницы

- [ ] `/admin/receipt-claims` — очередь, карточка, форма исправления, отказ.
- [ ] Страница месяца бухгалтера: кнопка, пометки, номер действующей версии.
- [ ] Страница чека (кабинет, телефон, печать, проверка по QR): ссылки между
      версиями.

### 6. Книга месяца

- [ ] Тесты: номер действующей версии в строке; исправления не удваивают
      месяц; суммы не поменялись.
- [ ] Правка `readLedger`.

### 7. Проверка целиком

- [ ] Весь юнит-прогон против выбрасываемой базы.
- [ ] `npm run build`, перезапуск `poolwatt-web` и `poolwatt-worker`.
- [ ] Новый e2e `tests/e2e/receipt-correction.spec.ts`.
- [ ] Весь e2e-прогон.
- [ ] Реестр и журнал.
