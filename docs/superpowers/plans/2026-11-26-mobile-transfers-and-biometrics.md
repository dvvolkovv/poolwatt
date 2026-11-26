# M4 — переводы и биометрия Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/{locale}/app/contacts` — перевод кВт·ч с телефона (US-19) за существующим переключателем §24.4, с подтверждением отпечатком по WebAuthn (§25 SCA), моим QR на получение и входящими переводами.

**Architecture:** Биометрия — WebAuthn: подпись проверяет сервер, а не клиент. Две новые таблицы: `DeviceKey` (открытый ключ устройства) и `WebAuthnChallenge` (одноразовый вызов). Экран перевода зовёт тот же `transferKwh`, что метод API, — копии правил §24 не появляется.

**Tech Stack:** `@simplewebauthn/server` 9 и `@simplewebauthn/browser` 9, Prisma 5, Next.js 16, vitest, Playwright (`mobile`, виртуальный аутентификатор CDP).

Спецификация: `docs/superpowers/specs/2026-11-26-mobile-transfers-and-biometrics-design.md`.

---

## Файлы

| Файл | За что отвечает |
| --- | --- |
| `prisma/schema.prisma` (изменить) | `DeviceKey`, `WebAuthnChallenge` |
| `src/lib/webauthn/relying-party.ts` (создать) | кто мы для WebAuthn: имя, идентификатор, разрешённые источники |
| `src/lib/webauthn/device-keys.ts` (создать) | вызов, регистрация, проверка подписи, список устройств |
| `src/lib/webauthn/device-keys.test.ts` (создать) | одноразовость вызова, срок, счётчик, чужой домен, чужой ключ |
| `src/app/api/v1/device-keys/route.ts` (создать) | список и удаление устройств |
| `src/app/api/v1/device-keys/challenge/route.ts` (создать) | вызов на регистрацию и на операцию |
| `src/app/api/v1/device-keys/verify/route.ts` (создать) | проверка ответа на регистрацию |
| `src/lib/exchange/transfer-service.ts` (изменить) | `transferKwh` принимает доказательство SCA |
| `src/lib/exchange/transfer-sca.test.ts` (создать) | без подписи у владельца ключа — отказ; с подписью — проход |
| `src/app/api/v1/wallets/me/transfer/route.ts` (изменить) | принять `assertion` |
| `src/app/[locale]/app/contacts/page.tsx` (переписать) | экран §22.8 |
| `src/app/[locale]/app/contacts/actions.ts` (создать) | перевод, подтверждение, отклонение |
| `src/components/mobile/transfer-form.tsx` (создать) | получатель, сумма, подпись отпечатком |
| `src/components/mobile/receive-qr.tsx` (создать) | мой QR, работает без сети |
| `src/components/mobile/device-key-button.tsx` (создать) | привязать это устройство |
| `src/app/[locale]/app/profile/page.tsx` (изменить) | список устройств и привязка |
| `worker/index.ts` (изменить) | чистка просроченных вызовов |
| `messages/{en,ru,sk}.json` (изменить) | ветки `app.transfer`, `app.devices` |
| `tests/e2e/mobile-transfer.mobile.spec.ts` (создать) | экран, QR, входящий перевод, привязка устройства |

---

### Task 1: таблицы и сторона проверки

- [x] **Step 1:** добавить `DeviceKey` и `WebAuthnChallenge` в `prisma/schema.prisma`
      (поля — из спецификации), обратные связи в `User`.
- [x] **Step 2:** `npx prisma migrate dev --name device_key --create-only`,
      `npx prisma migrate deploy`, то же для `poolwatt_test`, `npx prisma generate`.
- [x] **Step 3:** `src/lib/webauthn/relying-party.ts`: `rpId` из `NEXTAUTH_URL`
      (хост без порта), `rpName` «Poolwatt», `expectedOrigin` — массив из
      `NEXTAUTH_URL` плюс `capacitor://localhost` и `http://localhost` для
      оболочек; в тестах переопределяется через аргумент.
- [x] **Step 4:** `src/lib/webauthn/device-keys.ts`:
      `newChallenge(userId, purpose)` — пишет строку и отдаёт параметры;
      `registerDevice(userId, response, name)` — `verifyRegistrationResponse`,
      съедает вызов, пишет `DeviceKey`;
      `verifyAssertion(userId, purpose, response)` — `verifyAuthenticationResponse`,
      съедает вызов, двигает счётчик вперёд и только вперёд, обновляет
      `lastUsedAt`, возвращает идентификатор ключа;
      `listDevices(userId)`, `forgetDevice(userId, id)`;
      `purgeWebAuthnChallenges(now)` — старше 120 секунд.
- [x] **Step 5:** тесты `device-keys.test.ts` — восемь случаев из спецификации;
      ответы аутентификатора берутся от программного ключа на `node:crypto`
      (ES256), чтобы подпись была настоящей.
- [x] **Step 6:** `git commit -m "feat(webauthn): a device key the server can check"`

### Task 2: перевод требует подписи, когда устройство привязано

- [x] **Step 1:** в `TransferInput` добавить
      `sca?: { purpose: "transfer"; response: unknown } | null`.
- [x] **Step 2:** в начале `transferKwh` после `assertTransfersOpen()`:
      если у `fromUserId` есть хоть один `DeviceKey` — требовать `sca` и
      проверить его `verifyAssertion`; нет устройств — идти без подписи.
- [x] **Step 3:** тесты `transfer-sca.test.ts` — три случая.
- [x] **Step 4:** метод API принимает `assertion` в теле и передаёт дальше.
- [x] **Step 5:** `git commit -m "feat(transfers): SCA for a transfer, when the account has a key"`

### Task 3: экран §22.8

- [x] **Step 1:** подписи `app.transfer` и `app.devices` в трёх локалях.
- [x] **Step 2:** `receive-qr.tsx` — `PWX:<ник>` через `qrcode`, значение
      кладётся в `localStorage`, чтобы рисоваться без сети.
- [x] **Step 3:** `transfer-form.tsx` — получатель (ник или `QrScan`), сумма,
      примечание, «получатель подтверждает», кнопка с подписью отпечатком
      через `@simplewebauthn/browser`.
- [x] **Step 4:** `actions.ts` — `sendTransfer`, `acceptTransfer`, `declineTransfer`.
- [x] **Step 5:** страница: мой QR, остаток по AML, входящие, форма (или
      объяснение, чего не хватает, при закрытом переключателе).
- [x] **Step 6:** `device-key-button.tsx` и список устройств в профиле.
- [x] **Step 7:** сборка, `curl` на `/ru/app/contacts` → 307 для гостя.
- [x] **Step 8:** `git commit -m "feat(mobile): the §22.8 transfer screen"`

### Task 4: чистка вызовов, e2e, вся проверка, APK, реестр

- [x] **Step 1:** `worker/index.ts` — `purgeWebAuthnChallenges` в 03:40.
- [x] **Step 2:** `tests/e2e/mobile-transfer.mobile.spec.ts` на Pixel 7:
      экран при закрытом переключателе; мой QR; ник из чужого QR;
      входящий перевод принимается; привязка устройства через
      `WebAuthn.addVirtualAuthenticator`; перевод с подписью, когда
      переключатель открыт в этом прогоне.
- [x] **Step 3:** весь юнит-набор и весь e2e.
- [x] **Step 4:** `/home/dv/bin/android-build`.
- [x] **Step 5:** отметить план, обновить `inbox/TZ-STATUS.md`, коммит.

---

## Где работа ушла от плана

- **Библиотека оказалась девятой версии, не последней.** `npm install` принёс
  `@simplewebauthn/server` 9, и у него прежний вид API: `credentialID` и
  `credentialPublicKey` отдельными полями, `authenticator: {…}` в проверке
  подписи, `userID` строкой. Код написан под неё; переход на 13-ю — отдельная
  работа, которой ничего не требует.
- **Подпись в юнит-тестах не подделывается.** Собрать настоящий ответ
  аутентификатора в тесте значит собрать CBOR с attestation — то есть
  переписать половину библиотеки. Юнит-тесты проверяют то, что написали мы:
  жизнь одноразового вызова, кому принадлежит ключ, правило счётчика. Порядок
  проверок в коде этому помогает: вызов съедается первым, поэтому ни один
  такой случай до разбора подписи не доходит. Саму подпись проверяет e2e
  виртуальным аутентификатором Chrome — тот же протокол и тот же ES256, что у
  Face ID.
- **Сканер QR стал общим по виду кода**, а не вторым компонентом рядом: на
  зарядке он читает разъём, на переводе — ник. Разбор приходит снаружи,
  потому что «это не код Poolwatt» зависит от того, какой код здесь ждут.
- **QR без сети живёт на экране офлайна.** Экран перевода требует сессии и
  из кэша служебного работника не отдаётся, поэтому ник кладётся в
  `localStorage` (как баланс на M1), а рисует его экран офлайна — тот
  единственный, который служебный работник отдаёт без сети.
- **Устройства — в профиле, а не на экране перевода.** Привязка относится к
  счёту, а не к одной операции; §22.11 — его место.
- **Попутно исправлено пять замечаний линтера, из них три — свои.** Карта
  трогала ref во время отрисовки; `receive-qr` и `device-key-button` ставили
  состояние синхронно в теле эффекта. Счётчик ошибок в
  `src/components/mobile` вернулся к тем двум, что были до этого прогона.

## Доказательство

- 1614 юнит-тестов и 148 e2e зелёные на живой сборке; из e2e шесть новых на
  Pixel 7 через настоящий домен (`tests/e2e/mobile-transfer.mobile.spec.ts`),
  включая настоящую церемонию WebAuthn: виртуальный аутентификатор подписал,
  сервер проверил, `DeviceKey` появился и исчез по кнопке «Забыть».
- `https://poolwatt.com/ru/app/contacts` уводит гостя на вход (307); вошедший
  видит мой QR, пределы AML, входящие переводы и честную строку о §24.4.
- `https://poolwatt.com/ru/app/profile` и `/ru/app/offline` отвечают 200;
  экран офлайна рисует тот же QR из кэша.
- Воркер объявил новое расписание: «idempotency + connector log + webauthn
  challenge purge 03:40».
- APK build 9: `https://poolwatt.com/downloads/poolwatt-build-9.apk`.
