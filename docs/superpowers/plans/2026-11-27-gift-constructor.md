# Конструктор подарков целиком — план (§42)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** в конструкторе §42 работают все строки таблицы, которые не ждут
внешней стороны: промокод и QR, день рождения, скидка в %, бесплатная бронь,
комбинация, «не суммируется» и минимальный объём следующей зарядки.

**Architecture:** скидка — это подарок, размер которого известен только в
момент сеанса, поэтому `availableGiftKwh` и `spendGrants` начинают получать
объём сеанса; бесплатная бронь — подарок вида `FREE_BOOKING`, который
`createReservation` обменивает на нулевую плату; промокод и день рождения —
два новых входа в уже существующий `issueGrantTx`, то есть бюджет, «один раз
на клиента» и журнал достаются бесплатно.

**Tech Stack:** Next.js 16 (App Router), Prisma, vitest, Playwright.

Спецификация: `docs/superpowers/specs/2026-11-27-gift-constructor-design.md`.

Юнит-тесты — всегда против выбрасываемой базы:

```bash
cd ~/poolwatt
NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local \
  | tr -d '"' | sed 's|/poolwatt?|/poolwatt_test?|')" npx vitest run <путь>
```

Ниже сокращено до `TESTENV npx vitest run <путь>`.

---

## Файлы

| Файл | За что отвечает |
| --- | --- |
| `prisma/schema.prisma` | два триггера, вид подарка, код, скидка, бронь, exclusive, предел по числу, день и месяц рождения |
| `src/lib/marketing/gift-rules.ts` | новый: чистые правила — сколько даёт подарок в этом сеансе, какой один выбрать |
| `src/lib/marketing/gift-rules.test.ts` | новый |
| `src/lib/marketing/grant-spend.ts` | правка: объём сеанса, минимальный объём, exclusive, вид подарка |
| `src/lib/marketing/campaign-engine.ts` | правка: скидка как потолок, предел по числу подарков, комбинация |
| `src/lib/marketing/promo-code.ts` | новый: ввод кода |
| `src/lib/marketing/promo-code.test.ts` | новый |
| `src/lib/marketing/birthday.ts` | новый: суточный проход |
| `src/lib/marketing/birthday.test.ts` | новый |
| `src/lib/reservations/reservation-service.ts` | правка: бесплатная бронь |
| `src/lib/marketing/campaign-service.ts` | правка: новые параметры конструктора |
| `src/app/[locale]/me/charger-operator/[id]/campaigns/*` | конструктор: новые поля |
| `src/app/[locale]/me/gifts/page.tsx` | кнопка «у меня есть промокод», скидка и бронь в списке |
| `src/app/[locale]/promo/[code]/page.tsx` | новый: ссылка из QR |
| `src/app/[locale]/(auth)/register` | поле промокода при регистрации |
| `src/app/[locale]/me/account` | день и месяц рождения |
| `src/app/[locale]/app/more/gifts` | то же на телефоне |
| `worker/index.ts` | суточный проход дня рождения |

## Задачи

### 1. Схема

- [ ] Миграция: `CampaignTrigger += PROMO_CODE, BIRTHDAY`; `PromoGrantKind`;
      поля `Campaign.promoCode` (уникально в паре с `operatorId`),
      `discountPct`, `freeBooking`, `exclusive`, `budgetGrants`,
      `issuedGrants`; `PromoGrant.kind`, `PromoGrant.discountPct`;
      `Reservation.promoGrantId`; `User.birthDay`, `User.birthMonth`.
- [ ] `npx prisma migrate dev`, затем та же миграция на выбрасываемой базе.

### 2. Чистые правила подарка (TDD)

- [ ] `gift-rules.test.ts`: сколько даёт фиксированный подарок и скидка в
      сеансе 40 кВт·ч; потолок остатка; скидка 0 % и 100 %; округление до
      0,001; подарок кампании с `minNextChargeKwh` в сеансе меньше предела;
      выбор одного подарка при `exclusive` (больше кВт·ч; при равенстве —
      раньше сгорает).
- [ ] `gift-rules.ts` под эти случаи.

### 3. Расчёт и списание

- [ ] `availableGiftKwh(userId, pointId, requestedKwh)` и
      `spendGrants(tx, { … amountKwh, requestedKwh })` зовут `gift-rules`.
- [ ] Вызовы в `payment-service.ts` (расчёт до подтверждения и списание) и в
      сеансе зарядки передают объём.
- [ ] Тесты: сеанс со скидкой платит за остаток; два сеанса подряд не берут
      со скидки больше потолка.

### 4. Выдача: комбинация и предел по числу

- [ ] `issueGrantTx` пишет `kind` и `discountPct`, считает `issuedGrants` и
      останавливает кампанию по `budgetGrants`; скидка резервирует потолок.
- [ ] Кампания с энергией и бронью выдаёт два подарка с разными ключами.
- [ ] Гонка: две одновременные выдачи против последнего места в `budgetGrants`.

### 5. Промокод

- [ ] `promo-code.test.ts`: нет такого кода, чужая сеть, остановленная
      кампания, вне окна дат, дважды одним клиентом, два одновременных ввода.
- [ ] `redeemPromoCode`, страница `/promo/[code]`, поле при регистрации,
      кнопка в разделе «Подарки» (кабинет и телефон).

### 6. День рождения

- [ ] `birthday.test.ts`: клиент сети получает, не клиент — нет, раз в год,
      два прохода в один день, 29 февраля в невисокосный год.
- [ ] `birthday.ts`, проход в воркере, день и месяц в профиле.

### 7. Бесплатная бронь

- [ ] Тесты: плата ноль и подарок потрачен; залог не тронут; второй брони
      подарка не хватает; продление платное; подарок чужой сети не годится;
      две одновременные брони за один подарок.
- [ ] Правка `createReservation` и текст на экране брони.

### 8. Конструктор партнёра

- [ ] `campaign-service.ts` и `actions.ts` принимают новые параметры с
      проверками (код только для триггера `PROMO_CODE`, скидка 1–100,
      бесплатная бронь требует `budgetGrants`).
- [ ] Форма кампании: триггеры, блок подарка, ограничения, бюджет, ссылка
      для QR.

### 9. Проверка целиком

- [ ] Весь юнит-прогон против выбрасываемой базы.
- [ ] `npm run build`, `pm2 restart poolwatt-web poolwatt-worker`.
- [ ] Новый e2e: партнёр собирает кампанию с кодом и скидкой, водитель вводит
      код, видит подарок, бронь бесплатна.
- [ ] Весь e2e-прогон.
- [ ] Реестр: §42 закрыт, запись в журнал.
