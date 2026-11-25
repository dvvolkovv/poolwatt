# План: чеки и бухгалтерия партнёра (Блок H)

Спецификация: `docs/superpowers/specs/2026-11-25-receipts-and-accounting-design.md`

Две истории: US-45 (чек §46 с доставкой), US-46 (выгрузка месяца).

## Часть 1. Данные

- [x] Миграция: `Payment.pointId/connectorId/startedAt/endedAt`,
      `Receipt.number/verifyCode/deliveredAt/deliveryChannels/deliveryError`,
      модель `OperatorAccounting`, `User.receiptEmail/receiptPush`,
      последовательность `receipt_number_seq`.
- [x] Номер и код проверки выдаются при создании любого чека (зарядка,
      сделка, неявка). Тест на три пути.

## Часть 2. US-45 — документ

- [x] `receipts/receipt-document.ts`: состав §46 из записи чека.
- [x] `receipts/vat.ts`: разбивка суммы на нетто и НДС по ставке партнёра.
- [x] Тесты `receipt-document.test.ts`.
- [ ] Страница чека переписана под §46: логотипы, реквизиты, пункт и разъём,
      источник, цены, разбивка, НДС, QR.
- [ ] Страница печати `/me/wallet/receipts/[id]/print`.
- [ ] Открытая проверка `/r/[code]`.
- [ ] Ключи en/ru/sk. Прогон, сборка, коммит.

## Часть 3. US-45 — доставка

- [ ] `receipts/receipt-delivery.ts`: письмо, пуш за `pushOpen()`, запись
      каналов; настройки пользователя.
- [ ] Платёж, расчёт сделки и неявка зовут доставку после фиксации.
- [ ] Добор в воркере раз в минуту.
- [ ] Переключатели доставки в `/me/settings`.
- [ ] Тесты `receipt-delivery.test.ts`.
- [ ] Ключи en/ru/sk. Прогон, сборка, коммит.

## Часть 4. US-46 — проводки и форматы

- [ ] Реквизиты сети и счета DATEV/BMD: форма в кабинете сети.
- [ ] `accounting/ledger.ts`: строки проводок сети за период.
- [ ] `accounting/export-csv.ts`, `export-xlsx.ts`, `export-pdf.ts`,
      `export-datev.ts`, `export-bmd.ts`.
- [ ] Тесты `ledger.test.ts`, `accounting-export.test.ts`.
- [ ] Маршрут выгрузки с проверкой `finance.read`.
- [ ] Страница `/me/charger-operator/[id]/accounting` с периодом, строками,
      итогами и пятью кнопками.
- [ ] Ключи en/ru/sk. Прогон, сборка, коммит.

## Часть 5. Проверка и отчёт

- [ ] e2e `receipts.spec.ts` на живой сборке.
- [ ] Вся сюита с e2e, пересборка и перезапуск процессов.
- [ ] Реестр и журнал.
- [ ] Отчёт владельцу текстом и двумя аудиофайлами.
