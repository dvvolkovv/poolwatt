# §51 Compensations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support can give back a wrong debit as money on the driver's wallet balance, and hand out the partner's configured gift kWh for the inconvenience — both from the ticket that reviewed it (ТЗ §51 "Компенсации").

**Architecture:** Two instruments, one module. A refund is a `PaymentRefund` row — one per ticket, numbered from the receipt sequence, crediting the wallet in one transaction — and a second source of lines for the §46 ledger. A compensation gift is an ordinary §42 campaign with a new `COMPENSATION` trigger that only support fires, so budget, validity, scope, analytics and the client's letter all come for free. The ticket learns which session it is about (`Ticket.paymentId`), which is what gives a refund its subject.

**Tech Stack:** Next.js 16 App Router, Prisma/Postgres, vitest, Playwright, next-intl.

Spec: `docs/superpowers/specs/2026-11-27-support-compensation-design.md`.

Run tests with the throwaway database (see CLAUDE.md "Known gotchas"):

```bash
cd ~/poolwatt
NODE_ENV=test DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env.local \
  | tr -d '"' | sed 's|/poolwatt?|/poolwatt_test?|')" npx vitest run <file>
```

Call that prefix `TESTENV` below.

---

## File map

| File | Responsibility |
| --- | --- |
| `prisma/schema.prisma` | `PaymentRefund`, `Ticket.paymentId`, `CampaignTrigger.COMPENSATION` |
| `src/lib/work/ticket-compensation.ts` | both compensations + the `Ticket.compensation` line |
| `src/lib/work/ticket-compensation.test.ts` | its tests |
| `src/lib/work/refund-mail.ts` | the letter about a refund, swept by the worker |
| `src/lib/work/ticket-service.ts` | accept `paymentId`, dedupe by payment |
| `src/lib/marketing/campaign-engine.ts` | `COMPENSATION` is not earned by charging |
| `src/lib/marketing/campaign-service.ts` | one active compensation campaign per network |
| `src/lib/accounting/ledger.ts` | `refund` lines |
| `src/lib/exchange/wallet-history.ts` | `REFUND` entries |
| `src/app/[locale]/me/charger-operator/[id]/tickets/[ticketId]/page.tsx` + `actions.ts` | support's two buttons |
| `src/app/[locale]/me/tickets/[id]/page.tsx`, `src/app/[locale]/app/tickets/[id]/page.tsx` | the client sees what was given back |
| `src/app/[locale]/me/wallet/page.tsx`, `src/app/[locale]/app/wallet/page.tsx` | §51.1 "report a problem" from the charge history |
| `src/app/api/v1/tickets/[id]/compensation/route.ts`, `.../refund/route.ts` | §50/§51 methods |
| `worker/index.ts` | `notifyPendingRefunds()` pass |
| `messages/{ru,en,sk}.json` | the words |

---

### Task 1: Schema — the refund row, the ticket's session, the new trigger

**Files:**
- Modify: `prisma/schema.prisma`
- Create: migration via `npx prisma migrate dev --name support_compensation`

- [ ] **Step 1: Add `COMPENSATION` to `CampaignTrigger`**

In `enum CampaignTrigger`, after `TOKEN_PAYMENT`:

```prisma
  // §51 "партнёр может настроить компенсацию подарочными кВт·ч своей сети за
  // неудобство". Nothing earns it: support hands it out on a ticket, which is
  // why `triggerFired` answers "no" for it like it does for a promo code.
  COMPENSATION
```

- [ ] **Step 2: Add the session and the refunds to `Ticket`**

In `model Ticket`, after the `connector` relation:

```prisma
  // §51 "неверная цена или списание" — which session is being appealed.
  // Filled by a report sent from the charge history; without it a refund has
  // no subject, because support cannot know which debit to give back.
  paymentId          String?
  payment            Payment?          @relation("TicketPayment", fields: [paymentId], references: [id], onDelete: SetNull)
```

and after `messages`:

```prisma
  refunds            PaymentRefund[]
```

and a new index at the bottom of the model:

```prisma
  @@index([paymentId])
```

- [ ] **Step 3: Add the back-relations and the model**

In `model Payment`, next to `promoGrants`:

```prisma
  tickets           Ticket[]           @relation("TicketPayment")
  refunds           PaymentRefund[]
```

In `model Wallet`, next to its other relations, add `refunds PaymentRefund[]`.
In `model User`, add `refundsDecided PaymentRefund[] @relation("RefundDecidedBy")`.

After `model TicketMessage`, the new model:

```prisma
/// §51 "Ошибочное списание — возврат после проверки поддержкой".
///
/// The money goes back onto the wallet balance it was taken from, which is
/// the same ledger move as the booking fee of US-55 and needs no payment
/// provider. A session paid by card is refused by `receiptRefundsOpen`:
/// money back onto a card is the provider's job, and promising it would be
/// an invention.
model PaymentRefund {
  id        String  @id @default(cuid())
  paymentId String
  payment   Payment @relation(fields: [paymentId], references: [id], onDelete: Cascade)
  /// The review that decided it. Unique: one review, one refund — a second
  /// refund needs a second review, and that is also what makes two clicks
  /// produce one row without a lock.
  ticketId  String  @unique
  ticket    Ticket  @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  walletId  String
  wallet    Wallet  @relation(fields: [walletId], references: [id], onDelete: Cascade)
  /// Its own number from `receipt_number_seq`: a partner's accountant refers
  /// to a document, not to a cuid.
  number     String   @unique
  amountFiat Decimal  @db.Decimal(18, 2)
  currency   String   @default("EUR")
  reason     String   @db.Text
  decidedById String
  decidedBy   User    @relation("RefundDecidedBy", fields: [decidedById], references: [id], onDelete: Cascade)
  /// Null means the worker still owes the driver a letter.
  notifiedAt DateTime?
  createdAt  DateTime @default(now())

  @@index([paymentId])
  @@index([notifiedAt])
  @@index([createdAt])
}
```

- [ ] **Step 4: Migrate and generate**

```bash
cd ~/poolwatt
npx prisma migrate dev --name support_compensation
TESTENV npx prisma migrate deploy
```

Expected: migration applied on both databases, client regenerated.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(support): the schema of a §51 compensation"
```

---

### Task 2: `refundTicketPayment` — money back onto the balance

**Files:**
- Create: `src/lib/work/ticket-compensation.ts`
- Create: `src/lib/work/ticket-compensation.test.ts`

- [ ] **Step 1: Write the failing tests**

Read `src/lib/work/ticket-conversation.test.ts` first for the fixture style
used in this folder (it builds an operator, a point, a connector and a user
with `prisma` directly and deletes them in `afterAll`). Create
`src/lib/work/ticket-compensation.test.ts` with a `makeWorld()` helper that
additionally creates a `GridZone`, a `Wallet` with `fiatBalance: 50`, and a
`CAPTURED` `Payment` of `amountFiat: 12` on that wallet and point, plus a
ticket of `problemType: "WRONG_PRICE"` carrying `paymentId`.

Cases:

```ts
it("credits the wallet, stamps the ticket and says so in the conversation", async () => {
  const w = await makeWorld();
  const refund = await refundTicketPayment({
    ticketId: w.ticket.id,
    supportUserId: w.support.id,
    amountFiat: 4.2,
    reason: "The tariff was wrong",
  });
  expect(refund.amountFiat).toBe(4.2);
  expect(refund.number).toMatch(/^PW-\d{4}-\d{6}$/);
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: w.wallet.id } });
  expect(num(wallet.fiatBalance)).toBe(54.2);
  const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: w.ticket.id } });
  expect(ticket.compensation).toContain("4.20 EUR");
  const messages = await prisma.ticketMessage.findMany({ where: { ticketId: w.ticket.id } });
  expect(messages.some((m) => m.authorKind === "SYSTEM" && m.body.includes("4.20"))).toBe(true);
  const audit = await prisma.auditLog.findFirst({
    where: { entity: "PaymentRefund", entityId: refund.id },
  });
  expect(audit?.action).toBe("payment.refunded");
});

it("refuses a second refund on the same review", async () => {
  const w = await makeWorld();
  await refundTicketPayment({ ticketId: w.ticket.id, supportUserId: w.support.id, amountFiat: 1, reason: "x" });
  await expect(
    refundTicketPayment({ ticketId: w.ticket.id, supportUserId: w.support.id, amountFiat: 1, reason: "x" }),
  ).rejects.toThrow(TicketCompensationError);
});

it("two simultaneous clicks produce one refund", async () => {
  const w = await makeWorld();
  const results = await Promise.allSettled([
    refundTicketPayment({ ticketId: w.ticket.id, supportUserId: w.support.id, amountFiat: 3, reason: "a" }),
    refundTicketPayment({ ticketId: w.ticket.id, supportUserId: w.support.id, amountFiat: 3, reason: "b" }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const rows = await prisma.paymentRefund.findMany({ where: { paymentId: w.payment.id } });
  expect(rows).toHaveLength(1);
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: w.wallet.id } });
  expect(num(wallet.fiatBalance)).toBe(53);
});

it("refuses more than the session cost", async () => {
  const w = await makeWorld();
  await expect(
    refundTicketPayment({ ticketId: w.ticket.id, supportUserId: w.support.id, amountFiat: 12.01, reason: "x" }),
  ).rejects.toThrow(/more than/i);
});

it("refuses a ticket that names no session", async () => {
  const w = await makeWorld({ withPayment: false });
  await expect(
    refundTicketPayment({ ticketId: w.ticket.id, supportUserId: w.support.id, amountFiat: 1, reason: "x" }),
  ).rejects.toThrow(/no session/i);
});

it("refuses a session that was not captured", async () => {
  const w = await makeWorld({ paymentStatus: "FAILED" });
  await expect(
    refundTicketPayment({ ticketId: w.ticket.id, supportUserId: w.support.id, amountFiat: 1, reason: "x" }),
  ).rejects.toThrow(/was not charged/i);
});

it("refuses a card session until the provider exists", async () => {
  const w = await makeWorld({ cardId: "card_1" });
  await expect(
    refundTicketPayment({ ticketId: w.ticket.id, supportUserId: w.support.id, amountFiat: 1, reason: "x" }),
  ).rejects.toThrow(FeatureClosedError);
});

it("refuses a refund with no reason", async () => {
  const w = await makeWorld();
  await expect(
    refundTicketPayment({ ticketId: w.ticket.id, supportUserId: w.support.id, amountFiat: 1, reason: "  " }),
  ).rejects.toThrow(/reason/i);
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
TESTENV npx vitest run src/lib/work/ticket-compensation.test.ts
```

Expected: FAIL — `Cannot find module './ticket-compensation'`.

- [ ] **Step 3: Write `src/lib/work/ticket-compensation.ts`**

```ts
// Компенсации §51 — то, что сеть возвращает за испорченную зарядку.
//
// §51 даёт два инструмента, и каждый из них совпадает с тем, что мы можем
// сделать честно:
//
//  * деньги — обратно на денежный баланс кошелька, откуда их и списали. Это
//    та же проводка, что возврат платы за бронь в US-55, и платёжный
//    провайдер ей не нужен. На карту — нужен, поэтому сеанс с картой
//    отказывается гейтом §46;
//  * энергия — подарочные кВт·ч из бюджета самого партнёра (§42/§43).
//    Намайнить кВт·ч под возврат нельзя: токен §8 стоит за настоящей
//    выработкой, и подарок из бюджета сети — единственный честный источник.
//
// Одна проверка — один возврат и один подарок: «после проверки поддержкой»
// из §51 означает заявку, и уникальность по заявке закрывает двойное
// нажатие без всякой блокировки.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit, type Db } from "@/lib/exchange/audit";
import { num } from "@/lib/exchange/decimal";
import { roundKwh, roundMoney } from "@/lib/exchange/precision";
import { assertReceiptRefundsOpen, receiptRefundsOpen } from "@/lib/exchange/gates";
import { nextReceiptNumber } from "@/lib/receipts/receipt-number";
import { isUniqueViolation } from "@/lib/exchange/idempotency";
import { issueGrantTx } from "@/lib/marketing/campaign-engine";
import { systemMessage } from "./ticket-conversation";

export class TicketCompensationError extends Error {}

export interface RefundArgs {
  ticketId: string;
  supportUserId: string;
  amountFiat: number;
  reason: string;
}

export interface RefundView {
  id: string;
  number: string;
  amountFiat: number;
  currency: string;
}

export async function refundTicketPayment(args: RefundArgs): Promise<RefundView> {
  const amount = roundMoney(args.amountFiat);
  const reason = args.reason.trim();
  if (reason.length === 0) {
    throw new TicketCompensationError("A refund needs a reason: the review is the record");
  }
  if (!(amount > 0)) throw new TicketCompensationError("A refund has to be more than zero");

  const ticket = await prisma.ticket.findUnique({
    where: { id: args.ticketId },
    include: {
      payment: { select: { id: true, walletId: true, status: true, cardId: true, amountFiat: true, zone: { select: { currency: true } } } },
    },
  });
  if (!ticket) throw new TicketCompensationError("No such ticket");
  if (!ticket.payment) {
    throw new TicketCompensationError("This ticket names no session: there is nothing to give back");
  }
  if (ticket.payment.status !== "CAPTURED") {
    throw new TicketCompensationError("That session was not charged for");
  }
  // §46 — возврат на карту делает провайдер, а не мы.
  if (ticket.payment.cardId && !receiptRefundsOpen()) assertReceiptRefundsOpen();

  const payment = ticket.payment;

  let created: { id: string; number: string } | null = null;
  try {
    created = await prisma.$transaction(async (tx) => {
      // Платёж под блокировкой: двух заявок об одном сеансе никто не
      // запрещал, и сумма возвратов не может перерасти списание.
      await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${payment.id} FOR UPDATE`;
      const already = await tx.paymentRefund.aggregate({
        where: { paymentId: payment.id },
        _sum: { amountFiat: true },
      });
      const refunded = roundMoney(num(already._sum.amountFiat ?? 0));
      const charged = roundMoney(num(payment.amountFiat));
      if (roundMoney(refunded + amount) > charged) {
        throw new TicketCompensationError(
          `That is more than the session cost: ${charged - refunded} left to give back`,
        );
      }

      const row = await tx.paymentRefund.create({
        data: {
          paymentId: payment.id,
          ticketId: ticket.id,
          walletId: payment.walletId,
          number: await nextReceiptNumber(tx),
          amountFiat: new Prisma.Decimal(amount),
          currency: payment.zone.currency,
          reason,
          decidedById: args.supportUserId,
        },
      });

      const before = await tx.wallet.findUniqueOrThrow({ where: { id: payment.walletId } });
      const after = await tx.wallet.update({
        where: { id: payment.walletId },
        data: { fiatBalance: { increment: new Prisma.Decimal(amount) } },
      });

      await writeAudit(tx, {
        actor: args.supportUserId,
        entity: "PaymentRefund",
        entityId: row.id,
        action: "payment.refunded",
        before: { fiatBalance: num(before.fiatBalance) },
        after: {
          fiatBalance: num(after.fiatBalance),
          paymentId: payment.id,
          ticketId: ticket.id,
          amountFiat: amount,
          number: row.number,
          reason,
        },
      });

      await stampCompensation(tx, ticket.id);
      return { id: row.id, number: row.number };
    });
  } catch (err) {
    // Уникальность по заявке — это правило §51, а не сбой: вторая проверка
    // нужна для второго возврата.
    if (isUniqueViolation(err)) {
      throw new TicketCompensationError("This review has already been answered with a refund");
    }
    throw err;
  }

  await systemMessage(
    prisma,
    ticket.id,
    `A refund of ${amount.toFixed(2)} ${payment.zone.currency} has been credited to your balance (${created.number}).`,
  );

  return {
    id: created.id,
    number: created.number,
    amountFiat: amount,
    currency: payment.zone.currency,
  };
}

/**
 * §51 «Дополнения: Ticket получает поле compensation». Одна строка о том, что
 * сеть вернула, пересобранная из фактов — подарков и возвратов этой заявки.
 * Экраны читают её, а не считают сами.
 */
export async function stampCompensation(db: Db, ticketId: string): Promise<string | null> {
  const [grants, refunds] = await Promise.all([
    db.promoGrant.findMany({
      where: { onceKey: `ticket-${ticketId}` },
      select: { amountKwh: true },
    }),
    db.paymentRefund.findMany({
      where: { ticketId },
      select: { amountFiat: true, currency: true },
    }),
  ]);

  const parts: string[] = [];
  const kwh = roundKwh(grants.reduce((sum, g) => sum + num(g.amountKwh), 0));
  if (kwh > 0) parts.push(`${kwh.toFixed(3)} kWh`);
  const money = roundMoney(refunds.reduce((sum, r) => sum + num(r.amountFiat), 0));
  if (money > 0) parts.push(`${money.toFixed(2)} ${refunds[0]?.currency ?? "EUR"}`);

  const line = parts.length > 0 ? parts.join(" + ") : null;
  await db.ticket.update({ where: { id: ticketId }, data: { compensation: line } });
  return line;
}
```

Check `src/lib/exchange/idempotency.ts` actually exports `isUniqueViolation`;
if it lives elsewhere (`campaign-engine.ts` imports it from somewhere — read
its import list), import it from the same place.

- [ ] **Step 4: Run the tests**

```bash
TESTENV npx vitest run src/lib/work/ticket-compensation.test.ts
```

Expected: PASS, 8 cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/work/ticket-compensation.ts src/lib/work/ticket-compensation.test.ts
git commit -m "feat(support): a wrong debit goes back onto the balance, once per review"
```

---

### Task 3: `grantTicketCompensation` — the partner's gift kWh

**Files:**
- Modify: `src/lib/work/ticket-compensation.ts`
- Modify: `src/lib/work/ticket-compensation.test.ts`
- Modify: `src/lib/marketing/campaign-engine.ts:69` (the trigger guard)

- [ ] **Step 1: Write the failing tests**

Add to `ticket-compensation.test.ts` a `makeCompensationCampaign(operatorId, zoneId, over)`
helper creating an `ACTIVE` campaign with `trigger: "COMPENSATION"`,
`giftKwh: 5`, `budgetKwh: 100`, `validityDays: 30`, `oncePerClient: false`,
`fundingSource: "TOKENS"`.

```ts
it("hands out what the partner configured, once per review", async () => {
  const w = await makeWorld();
  await makeCompensationCampaign(w.operator.id, w.zone.id);
  const first = await grantTicketCompensation(w.ticket.id, w.support.id);
  expect(first.amountKwh).toBe(5);
  const grants = await prisma.promoGrant.findMany({ where: { userId: w.reporter.id } });
  expect(grants).toHaveLength(1);
  expect(grants[0].onceKey).toBe(`ticket-${w.ticket.id}`);
  const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: w.ticket.id } });
  expect(ticket.compensation).toContain("5.000 kWh");
  await expect(grantTicketCompensation(w.ticket.id, w.support.id)).rejects.toThrow(
    TicketCompensationError,
  );
});

it("two simultaneous clicks hand out one gift", async () => {
  const w = await makeWorld();
  await makeCompensationCampaign(w.operator.id, w.zone.id);
  const results = await Promise.allSettled([
    grantTicketCompensation(w.ticket.id, w.support.id),
    grantTicketCompensation(w.ticket.id, w.support.id),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const grants = await prisma.promoGrant.findMany({ where: { userId: w.reporter.id } });
  expect(grants).toHaveLength(1);
});

it("refuses when the network configured no compensation", async () => {
  const w = await makeWorld();
  await expect(grantTicketCompensation(w.ticket.id, w.support.id)).rejects.toThrow(
    /has not configured/i,
  );
});

it("refuses an anonymous report: a gift belongs to somebody", async () => {
  const w = await makeWorld({ anonymous: true });
  await makeCompensationCampaign(w.operator.id, w.zone.id);
  await expect(grantTicketCompensation(w.ticket.id, w.support.id)).rejects.toThrow(/nobody/i);
});

it("refuses when the campaign budget is spent", async () => {
  const w = await makeWorld();
  await makeCompensationCampaign(w.operator.id, w.zone.id, { budgetKwh: 2 });
  await expect(grantTicketCompensation(w.ticket.id, w.support.id)).rejects.toThrow(/budget/i);
});

it("a charge earns no compensation gift", async () => {
  const w = await makeWorld();
  const campaign = await makeCompensationCampaign(w.operator.id, w.zone.id);
  const ids = await awardAfterCharge(w.payment.id);
  expect(ids).toHaveLength(0);
  const grants = await prisma.promoGrant.findMany({ where: { campaignId: campaign.id } });
  expect(grants).toHaveLength(0);
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
TESTENV npx vitest run src/lib/work/ticket-compensation.test.ts
```

Expected: FAIL — `grantTicketCompensation is not a function`.

- [ ] **Step 3: Keep `COMPENSATION` out of the charge triggers**

In `src/lib/marketing/campaign-engine.ts`, extend the guard that already
turns away `PROMO_CODE` and `BIRTHDAY`:

```ts
  // §42 — a code is redeemed by the driver (`promo-code.ts`), a birthday
  // comes round on its own (`birthday.ts`), and a §51 compensation is handed
  // out by support on a ticket. None of the three is earned by charging, and
  // falling through to the n-th-charge branch would hand them out to whoever
  // charged the right number of times.
  if (
    campaign.trigger === "PROMO_CODE" ||
    campaign.trigger === "BIRTHDAY" ||
    campaign.trigger === "COMPENSATION"
  ) {
    return false;
  }
```

- [ ] **Step 4: Add the granter to `ticket-compensation.ts`**

```ts
export interface CompensationView {
  grantId: string;
  amountKwh: number;
  expiresAt: Date;
}

/**
 * §51 «Партнёр может настроить компенсацию подарочными кВт·ч своей сети за
 * неудобство».
 *
 * Размер назначает партнёр, а не оператор поддержки: оператор решает «да или
 * нет». Сеть, не настроившая компенсацию, ничего не даёт — §51 говорит
 * «может», а не «обязан».
 */
export async function grantTicketCompensation(
  ticketId: string,
  supportUserId: string,
): Promise<CompensationView> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, operatorId: true, pointId: true, reporterId: true },
  });
  if (!ticket) throw new TicketCompensationError("No such ticket");
  if (!ticket.reporterId) {
    throw new TicketCompensationError(
      "This report was sent by nobody in particular: a gift needs a holder",
    );
  }

  const campaign = await readCompensationCampaign(ticket.operatorId, ticket.pointId);
  if (!campaign) {
    throw new TicketCompensationError("This network has not configured a compensation");
  }

  const onceKey = `ticket-${ticketId}`;
  let grantId: string | null;
  try {
    grantId = await prisma.$transaction((tx) =>
      issueGrantTx(tx, campaign, {
        userId: ticket.reporterId!,
        paymentId: null,
        amountKwh: num(campaign.giftKwh),
        action: "promo.compensation",
        kind: "ENERGY",
        onceKey,
      }),
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new TicketCompensationError("This review has already been compensated");
    }
    throw err;
  }
  if (!grantId) {
    // `issueGrantTx` отвечает null на две причины: подарок уже выдан по этой
    // заявке, и бюджет кампании кончился. Различает их сама заявка.
    const already = await prisma.promoGrant.findFirst({
      where: { campaignId: campaign.id, onceKey },
      select: { id: true },
    });
    throw new TicketCompensationError(
      already
        ? "This review has already been compensated"
        : "The compensation budget of this network is spent",
    );
  }

  const grant = await prisma.promoGrant.findUniqueOrThrow({ where: { id: grantId } });
  await stampCompensation(prisma, ticketId);
  await systemMessage(
    prisma,
    ticketId,
    `The network has credited you ${num(grant.amountKwh).toFixed(3)} kWh for the trouble.`,
  );

  return { grantId, amountKwh: num(grant.amountKwh), expiresAt: grant.expiresAt };
}

/**
 * Активная кампания-компенсация сети, если она есть. §51 говорит о
 * компенсации в единственном числе, и `campaign-service.ts` не даёт включить
 * вторую — но читатель всё равно берёт самую новую, чтобы данные из прошлого
 * не делали выбор монеткой.
 */
export async function readCompensationCampaign(operatorId: string, pointId: string | null) {
  const now = new Date();
  const campaigns = await prisma.campaign.findMany({
    where: {
      operatorId,
      trigger: "COMPENSATION",
      status: "ACTIVE",
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  return (
    campaigns.find(
      (c) =>
        c.scopePointIds.length === 0 || (pointId !== null && c.scopePointIds.includes(pointId)),
    ) ?? null
  );
}
```

- [ ] **Step 5: Run the tests**

```bash
TESTENV npx vitest run src/lib/work/ticket-compensation.test.ts src/lib/marketing/campaign-engine.test.ts
```

Expected: PASS, 14 cases in the new file and the engine's own suite green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/work/ticket-compensation.ts src/lib/work/ticket-compensation.test.ts src/lib/marketing/campaign-engine.ts
git commit -m "feat(support): §51 compensation in gift kWh, out of the partner's own budget"
```

---

### Task 4: One active compensation campaign per network

**Files:**
- Modify: `src/lib/marketing/campaign-service.ts`
- Modify: `src/lib/marketing/campaign-service.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("refuses a second compensation campaign in one network", async () => {
  const { operatorId, userId, zoneId } = await world();
  const first = await createCampaign(operatorId, userId, compensationInput(zoneId));
  await setCampaignStatus(first.id, userId, "ACTIVE");
  const second = await createCampaign(operatorId, userId, compensationInput(zoneId));
  await expect(setCampaignStatus(second.id, userId, "ACTIVE")).rejects.toThrow(
    /one compensation/i,
  );
});

it("lets a compensation campaign replace a paused one", async () => {
  const { operatorId, userId, zoneId } = await world();
  const first = await createCampaign(operatorId, userId, compensationInput(zoneId));
  await setCampaignStatus(first.id, userId, "ACTIVE");
  await setCampaignStatus(first.id, userId, "PAUSED");
  const second = await createCampaign(operatorId, userId, compensationInput(zoneId));
  await expect(setCampaignStatus(second.id, userId, "ACTIVE")).resolves.toBeTruthy();
});

it("a compensation campaign gives no free booking", async () => {
  const { operatorId, userId, zoneId } = await world();
  await expect(
    createCampaign(operatorId, userId, { ...compensationInput(zoneId), freeBooking: true }),
  ).rejects.toThrow(/kWh/i);
});
```

`compensationInput(zoneId)` returns
`{ name: "Sorry", trigger: "COMPENSATION", giftKwh: 5, validityDays: 30, budgetKwh: 100, oncePerClient: false, zoneId }`.
Read the existing `campaign-service.test.ts` for how it builds an operator and
a user and reuse that helper rather than writing a second one.

- [ ] **Step 2: Run them and watch them fail**

```bash
TESTENV npx vitest run src/lib/marketing/campaign-service.test.ts
```

Expected: FAIL — the second activation succeeds.

- [ ] **Step 3: Add the rules in `validate()` and in `setCampaignStatus`**

In `validate()`, inside the `else` branch that handles gift campaigns, after
the free-booking check:

```ts
  // §51 — компенсация это кВт·ч за неудобство, а не бесплатная бронь.
  if (trigger === "COMPENSATION") {
    if (input.freeBooking ?? current?.freeBooking ?? false) {
      throw new CampaignError("A compensation is measured in kWh, not in free bookings");
    }
    if (!(gift != null && gift > 0)) {
      throw new CampaignError("A compensation has to be more than zero kWh");
    }
    if (input.promoCode ?? current?.promoCode ?? null) {
      throw new CampaignError("A compensation is handed out by support, not redeemed by a code");
    }
  }
```

In `setCampaignStatus`, before writing `ACTIVE`:

```ts
  // §51 говорит о компенсации сети в единственном числе. Две активные
  // сделали бы выбор монеткой при каждой выдаче.
  if (status === "ACTIVE" && campaign.trigger === "COMPENSATION") {
    const other = await prisma.campaign.findFirst({
      where: {
        operatorId: campaign.operatorId,
        trigger: "COMPENSATION",
        status: "ACTIVE",
        id: { not: campaign.id },
      },
      select: { id: true, name: true },
    });
    if (other) {
      throw new CampaignError(
        `A network runs one compensation at a time; "${other.name}" is the active one`,
      );
    }
  }
```

- [ ] **Step 4: Run the tests**

```bash
TESTENV npx vitest run src/lib/marketing/campaign-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/marketing/campaign-service.ts src/lib/marketing/campaign-service.test.ts
git commit -m "feat(marketing): a network runs one §51 compensation at a time"
```

---

### Task 5: The report knows its session

**Files:**
- Modify: `src/lib/work/ticket-service.ts`
- Modify: `src/lib/work/ticket-service.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("keeps the session a report came from", async () => {
  const w = await world();
  const { ticket } = await reportProblem({
    pointId: w.point.id,
    reporterId: w.user.id,
    problemType: "WRONG_PRICE",
    paymentId: w.payment.id,
  });
  expect(ticket.paymentId).toBe(w.payment.id);
});

it("two reports about one session and one problem are one ticket", async () => {
  const w = await world();
  const first = await reportProblem({
    pointId: w.point.id, reporterId: w.user.id, problemType: "WRONG_PRICE", paymentId: w.payment.id,
  });
  const second = await reportProblem({
    pointId: w.point.id, reporterId: w.user.id, problemType: "WRONG_PRICE", paymentId: w.payment.id,
  });
  expect(second.ticket.id).toBe(first.ticket.id);
});

it("refuses a session that belongs to somebody else", async () => {
  const w = await world();
  const other = await makeUserWithPayment(w.point.id);
  await expect(
    reportProblem({
      pointId: w.point.id, reporterId: w.user.id, problemType: "WRONG_PRICE", paymentId: other.payment.id,
    }),
  ).rejects.toThrow(TicketError);
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
TESTENV npx vitest run src/lib/work/ticket-service.test.ts
```

Expected: FAIL — `paymentId` is not accepted and lands nowhere.

- [ ] **Step 3: Accept and verify the session**

In `ReportProblemArgs` add:

```ts
  /**
   * §51.1 — заявка из истории зарядок. Тот сеанс, о котором речь: без него
   * «возврат ошибочного списания» не имеет предмета.
   */
  paymentId?: string | null;
```

In `reportProblem`, after the point is resolved and before
`findOrCreateTicket`:

```ts
  // Чужой сеанс в заявке дал бы поддержке право вернуть не те деньги, так
  // что он проверяется, а не принимается на слово.
  let paymentId: string | null = null;
  if (args.paymentId) {
    if (!args.reporterId) throw new TicketError("A session belongs to somebody: sign in first");
    const payment = await prisma.payment.findUnique({
      where: { id: args.paymentId },
      select: { id: true, wallet: { select: { ownerUserId: true } } },
    });
    if (!payment || payment.wallet.ownerUserId !== args.reporterId) {
      throw new TicketError("That session is not yours");
    }
    paymentId = payment.id;
  }
```

Pass `paymentId` into `findOrCreateTicket` (add it to the signature) and into
both `create` calls (`paymentId`). In the dedupe query inside the
transaction, make the window depend on it:

```ts
    // Ошибочное списание — один факт, а не момент: заявка о сеансе
    // склеивается по сеансу, без окна в пять минут. Заявка с места остаётся
    // при прежнем правиле.
    const existing = await tx.ticket.findFirst({
      where: {
        reporterId: args.reporterId,
        problemType: args.problemType,
        status: { in: ["OPEN", "IN_PROGRESS"] },
        ...(paymentId
          ? { paymentId }
          : { pointId: args.pointId, createdAt: { gte: since } }),
      },
      orderBy: { createdAt: "desc" },
    });
```

- [ ] **Step 4: Run the tests**

```bash
TESTENV npx vitest run src/lib/work/ticket-service.test.ts
```

Expected: PASS, including the existing cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/work/ticket-service.ts src/lib/work/ticket-service.test.ts
git commit -m "feat(support): a report from the charge history names its session"
```

---

### Task 6: The refund reaches the partner's books and the driver's history

**Files:**
- Modify: `src/lib/accounting/ledger.ts`
- Modify: `src/lib/accounting/ledger.test.ts`
- Modify: `src/lib/exchange/wallet-history.ts`
- Modify: `src/lib/exchange/wallet-history.test.ts`

- [ ] **Step 1: Write the failing tests**

In `ledger.test.ts`:

```ts
it("a §51 refund is a negative line and the month sums with it", async () => {
  const w = await world();            // existing helper: operator, point, captured payment with a receipt
  const refund = await prisma.paymentRefund.create({
    data: {
      paymentId: w.payment.id,
      ticketId: w.ticket.id,
      walletId: w.wallet.id,
      number: "PW-2026-999001",
      amountFiat: new Prisma.Decimal(4.2),
      currency: "EUR",
      reason: "wrong tariff",
      decidedById: w.support.id,
    },
  });
  const ledger = await readLedger({ operatorId: w.operator.id, from, to });
  const line = ledger.lines.find((l) => l.kind === "refund");
  expect(line?.documentNumber).toBe("PW-2026-999001");
  expect(line?.gross).toBe(-4.2);
  expect(line?.kwh).toBe(0);
  expect(ledger.totals.gross).toBe(roundMoney(chargeGross - 4.2));
  expect(refund.id).toBeTruthy();
});

it("the csv export carries the refund line", async () => {
  // …same world, then:
  const csv = renderCsv(await readLedger({ operatorId: w.operator.id, from, to }));
  expect(csv).toContain("refund");
  expect(csv).toContain("-4.20");
});
```

In `wallet-history.test.ts`:

```ts
it("a §51 refund shows up as money back", async () => {
  const w = await world();
  await prisma.paymentRefund.create({ data: { /* as above */ } });
  const entries = await readWalletHistory(w.user.id);
  const row = entries.find((e) => e.kind === "REFUND");
  expect(row?.fiat).toBe(4.2);
  expect(row?.kwh).toBe(0);
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
TESTENV npx vitest run src/lib/accounting/ledger.test.ts src/lib/exchange/wallet-history.test.ts
```

Expected: FAIL — no `refund` line, no `REFUND` entry.

- [ ] **Step 3: Teach the ledger a second source**

In `ledger.ts`, widen the kind:

```ts
export type LedgerKind = "charge" | "reservation.no_show" | "refund" | "other";
```

and after the receipt lines are built, before the totals:

```ts
  // §51 — возврат ошибочного списания. Второй источник строк, а не чек:
  // чек на зарядку остаётся верным, зарядка была. Без этой строки выгрузка
  // навсегда завысила бы выручку сети, и заметить это было бы нечем.
  const refunds = await prisma.paymentRefund.findMany({
    where: { createdAt: window, payment: { point: pointFilter } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      number: true,
      createdAt: true,
      amountFiat: true,
      currency: true,
      payment: { select: { pointId: true, point: { select: { name: true } } } },
    },
  });

  for (const r of refunds) {
    const gross = roundMoney(-num(r.amountFiat));
    const split = splitVat(gross, vatRatePct);
    lines.push({
      date: r.createdAt,
      documentNumber: r.number,
      receiptId: r.id,
      correctedReceiptId: null,
      kind: "refund",
      pointId: r.payment.pointId,
      pointName: r.payment.point?.name ?? null,
      kwh: 0,
      gross,
      net: split?.net ?? gross,
      vat: split?.amount ?? 0,
      vatRatePct,
      currency: r.currency,
      // Комиссии §53/§52 брались со зарядки и возвратом не двигаются: их
      // перерасчёт — вопрос договора с партнёром, а не этой строки.
      platformFee: 0,
      subpartnerFee: 0,
      partnerNet: gross,
    });
  }
  lines.sort((a, b) => a.date.getTime() - b.date.getTime());
```

`lines` is currently a `const` built from `.map(...)` — change it to
`const lines: LedgerLine[] = receipts.map(...)` (it already is) and push into
it; if TypeScript complains about the inferred type, annotate it explicitly.

- [ ] **Step 4: Teach the wallet history the new kind**

In `wallet-history.ts` add `"REFUND"` to `WalletHistoryKind` and to
`ALL_HISTORY_KINDS`, and a block after the `CHARGE` one:

```ts
  if (walletIds.length > 0 && kinds.has("REFUND")) {
    // §51 — деньги, которые сеть вернула после проверки поддержкой.
    const refunds = await db.paymentRefund.findMany({
      where: { walletId: { in: walletIds } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        amountFiat: true,
        currency: true,
        createdAt: true,
        payment: { select: { point: { select: { name: true } }, zone: { select: { code: true } } } },
      },
    });
    for (const refund of refunds) {
      entries.push({
        id: `REFUND:${refund.id}`,
        kind: "REFUND",
        at: refund.createdAt,
        kwh: 0,
        fiat: roundMoney(num(refund.amountFiat)),
        currency: refund.currency,
        zoneCode: refund.payment.zone.code,
        receiptId: null,
        title: refund.payment.point?.name ?? null,
      });
    }
  }
```

- [ ] **Step 5: Run the tests**

```bash
TESTENV npx vitest run src/lib/accounting src/lib/exchange/wallet-history.test.ts
```

Expected: PASS, including the five export-format suites.

- [ ] **Step 6: Commit**

```bash
git add src/lib/accounting src/lib/exchange/wallet-history.ts src/lib/exchange/wallet-history.test.ts
git commit -m "feat(accounting): a §51 refund is a line in the partner's month and in the wallet"
```

---

### Task 7: The letter about a refund

**Files:**
- Create: `src/lib/work/refund-mail.ts`
- Create: `src/lib/work/refund-mail.test.ts`
- Modify: `worker/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("tells the driver once and marks it told", async () => {
  const w = await world();                       // refund with notifiedAt: null, verified reporter email
  const sent: string[] = [];
  const told = await notifyPendingRefunds(new Date(), {
    sendTo: async (to) => { sent.push(to); },
  });
  expect(told).toBe(1);
  expect(sent).toEqual([w.reporter.email]);
  expect(await notifyPendingRefunds(new Date(), { sendTo: async () => {} })).toBe(0);
});

it("marks a refund told even when the driver has no verified email", async () => {
  const w = await world({ emailVerified: null });
  expect(await notifyPendingRefunds(new Date(), { sendTo: async () => {} })).toBe(1);
  const row = await prisma.paymentRefund.findUniqueOrThrow({ where: { id: w.refund.id } });
  expect(row.notifiedAt).not.toBeNull();
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
TESTENV npx vitest run src/lib/work/refund-mail.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/work/refund-mail.ts`**

Copy the shape of `ticket-recovery.ts`: an options object with `sendTo`, a
`findMany` over `paymentRefund` where `notifiedAt: null` with
`take: 200`, a conditional `updateMany({ where: { id, notifiedAt: null } })`
that claims the row before sending (so two passes cannot both write), a
`.catch(() => undefined)` around the send, and the money and the document
number in the body. Address the refund's wallet owner, not the ticket's
reporter — they are the same person today, and the wallet is the one who got
the money.

- [ ] **Step 4: Wire the worker**

In `worker/index.ts`, next to the other ticket passes:

```ts
  // §51 — водитель узнаёт о возврате письмом; экран заявки говорит то же.
  try {
    const told = await notifyPendingRefunds(now);
    if (told > 0) log(`support: ${told} refund notification(s) sent`);
  } catch (err) {
    console.error("[worker] refund notification failed:", err);
  }
```

- [ ] **Step 5: Run the tests**

```bash
TESTENV npx vitest run src/lib/work/refund-mail.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/work/refund-mail.ts src/lib/work/refund-mail.test.ts worker/index.ts
git commit -m "feat(support): the driver gets a letter about a §51 refund"
```

---

### Task 8: Support's two buttons

**Files:**
- Modify: `src/app/[locale]/me/tickets/actions.ts`
- Modify: `src/app/[locale]/me/charger-operator/[id]/tickets/[ticketId]/page.tsx`
- Modify: `messages/ru.json`, `messages/en.json`, `messages/sk.json`

- [ ] **Step 1: Add the server actions**

In `src/app/[locale]/me/tickets/actions.ts` (the same file the other ticket
actions live in, for the same reason: the right is decided by
`readTicketForUser`, not by a page):

```ts
const refundSchema = z.object({
  ticketId: z.string().min(1),
  amountFiat: z.number().positive(),
  reason: z.string().trim().min(1).max(2000),
});

export async function refundTicket(input: unknown): Promise<MessageResult> {
  const parsed = refundSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, formError: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Authentication required." };
  const seen = await readTicketForUser(parsed.data.ticketId, session.user.id, session.user.role);
  // Возврат решает сторона поддержки: клиент о своей заявке только пишет.
  if (!seen?.canWrite || seen.authorKind !== "SUPPORT") {
    return { ok: false, formError: "Not found." };
  }
  try {
    await refundTicketPayment({
      ticketId: parsed.data.ticketId,
      supportUserId: session.user.id,
      amountFiat: parsed.data.amountFiat,
      reason: parsed.data.reason,
    });
  } catch (err) {
    return {
      ok: false,
      formError:
        err instanceof TicketCompensationError || err instanceof FeatureClosedError
          ? err.message
          : "Could not refund.",
    };
  }
  revalidateTicket(parsed.data.ticketId);
  return { ok: true };
}

export async function compensateTicket(input: unknown): Promise<MessageResult> {
  const parsed = z.object({ ticketId: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, formError: "Invalid input." };
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Authentication required." };
  const seen = await readTicketForUser(parsed.data.ticketId, session.user.id, session.user.role);
  if (!seen?.canWrite || seen.authorKind !== "SUPPORT") {
    return { ok: false, formError: "Not found." };
  }
  try {
    await grantTicketCompensation(parsed.data.ticketId, session.user.id);
  } catch (err) {
    return {
      ok: false,
      formError: err instanceof TicketCompensationError ? err.message : "Could not compensate.",
    };
  }
  revalidateTicket(parsed.data.ticketId);
  return { ok: true };
}
```

Also add `revalidatePath(`/${locale}/me/wallet`)` and
`/${locale}/app/wallet` to `revalidateTicket`: a refund changes the balance
those pages print.

- [ ] **Step 2: Put them on the page**

Read `src/app/[locale]/me/charger-operator/[id]/tickets/[ticketId]/page.tsx`
and follow its existing client-component pattern for the reply form. Add a
section below the conversation:

- When the ticket has a `payment` and the remainder (amount less the sum of
  its refunds) is above zero: a form with a number input defaulted to the
  remainder, a required reason field, and a submit calling `refundTicket`.
  Print the session: point, date, `amountFiat`, and what is left to give
  back. When `payment.cardId` is set, print the gate's sentence instead of
  the form.
- When `readCompensationCampaign(operatorId, pointId)` returns a campaign and
  `ticket.compensation` carries no kWh yet: a single button calling
  `compensateTicket`, labelled with the configured kWh. When it returns null:
  one line saying the network has configured no compensation, with a link to
  the campaigns page.
- When `ticket.compensation` is set: a line stating what the network gave
  back.

- [ ] **Step 3: Add the words**

Add to the `tickets` namespace of all three message files; keep the Russian
plain ("Вернуть списание", "Выдать компенсацию", "Сеть вернула",
"Остаток к возврату", "Причина возврата", "Сеть не настроила компенсацию").

- [ ] **Step 4: Build and look at it**

```bash
npm run build && pm2 restart poolwatt-web
```

Expected: build succeeds. Open the ticket of a network you own and see both
controls.

- [ ] **Step 5: Commit**

```bash
git add src/app messages
git commit -m "feat(support): the desk can give back a debit and hand out a compensation"
```

---

### Task 9: The client sees what came back, and reports from the history

**Files:**
- Modify: `src/app/[locale]/me/tickets/[id]/page.tsx`
- Modify: `src/app/[locale]/app/tickets/[id]/page.tsx`
- Modify: `src/app/[locale]/me/wallet/page.tsx`
- Modify: `src/app/[locale]/app/wallet/page.tsx`
- Modify: `src/app/[locale]/c/[id]/report/page.tsx`
- Modify: `src/app/[locale]/c/[id]/report/actions.ts`
- Modify: `messages/{ru,en,sk}.json`

- [ ] **Step 1: Show the compensation on the client's ticket**

On both client ticket pages, where the status block is printed, add a line
when `ticket.compensation` is not null: the label from the messages file and
the value. The systemmessages in the conversation already say it in words;
this is the line a thumb finds without reading the thread.

- [ ] **Step 2: Carry a session into the report form**

In `src/app/[locale]/c/[id]/report/page.tsx`, read the optional
`payment` search param (remember: `searchParams` is async — `await` it),
verify nothing there (the action does), and pass it to the form as a hidden
value. In `actions.ts` add `paymentId: z.string().min(1).nullable().optional()`
to the schema and pass it to `reportProblem`. When a session is given,
default the problem type to `WRONG_PRICE` — that is what a report from the
history is about nine times out of ten, and the list stays editable.

- [ ] **Step 3: §51.1 — the button in the charge history**

On `/me/wallet`, in the receipts table, add a last cell for rows with a
`paymentId`: a link to
`/${locale}/c/${pointId}/report?payment=${paymentId}`. The query already
selects `paymentId`; add `payment: { select: { pointId: true } }` to it and
skip the link when the session has no point of ours (a charge elsewhere has
no network to complain to). Do the same on the phone's wallet page in the
charge list.

- [ ] **Step 4: Build and walk it through**

```bash
npm run build && pm2 restart poolwatt-web
```

Open `/ru/me/wallet`, press the link on a charge, send a report, then answer
it from the support desk with a refund and a compensation, and watch both
appear on the driver's ticket and in the wallet.

- [ ] **Step 5: Commit**

```bash
git add src/app messages
git commit -m "feat(support): §51.1 reports from the charge history, and the client sees what came back"
```

---

### Task 10: The two methods of §50/§51

**Files:**
- Create: `src/app/api/v1/tickets/[id]/refund/route.ts`
- Create: `src/app/api/v1/tickets/[id]/compensation/route.ts`
- Modify: `src/app/api/v1/tickets/report/route.ts`
- Modify: `docs/api.md` if one exists; otherwise skip

- [ ] **Step 1: Read the sibling route**

`src/app/api/v1/tickets/[id]/messages/route.ts` is the model: how it reads
the bearer or session identity, how it calls `readTicketForUser`, and how it
answers 404 rather than 403. Copy that shape exactly.

- [ ] **Step 2: Write the two routes**

`POST /v1/tickets/{id}/refund` takes `{ amountFiat, reason }` and
`POST /v1/tickets/{id}/compensation` takes no body. Both require
`Idempotency-Key` through the same helper the other money-moving routes use
(`src/lib/exchange/idempotency.ts`; read `POST /v1/payments/charge` for the
call), answer 503 on `FeatureClosedError`, 400 on
`TicketCompensationError`, 404 when `readTicketForUser` says nothing.

- [ ] **Step 3: Accept a session in the report method**

In `src/app/api/v1/tickets/report/route.ts` add `paymentId` to the schema and
pass it through, mirroring the server action.

- [ ] **Step 4: Smoke them**

```bash
npm run build && pm2 restart poolwatt-web
curl -s -X POST http://127.0.0.1:3000/api/v1/tickets/<id>/compensation \
  -H 'Idempotency-Key: t1' -H 'Authorization: Bearer <token>' | head -5
```

Expected: a JSON body, not an HTML error page.

- [ ] **Step 5: Commit**

```bash
git add src/app/api
git commit -m "feat(api): POST /v1/tickets/{id}/refund and /compensation"
```

---

### Task 11: e2e on the live build

**Files:**
- Create: `e2e/support-compensation.spec.ts`
- Create: `e2e/support-compensation.mobile.spec.ts`

- [ ] **Step 1: Write the desktop spec**

Read `e2e/support-conversation.spec.ts` for how it seeds a network, a point,
a driver and a support employee through Prisma and signs them in. Then:
a driver opens `/ru/me/wallet`, follows the report link on a charge, sends a
report about a wrong debit; the support employee opens the ticket, refunds
part of the amount with a reason and hands out the compensation; the driver
reloads their ticket and sees both lines, and `/ru/me/wallet` shows the new
balance. Clean up every row the spec created.

- [ ] **Step 2: Write the phone spec**

Mirror `e2e/support-conversation.mobile.spec.ts`: Pixel 7 viewport against
the real domain, the driver's `/ru/app/tickets/[id]` shows the compensation
line and `/ru/app/wallet` the refund in the history.

- [ ] **Step 3: Run the suites**

```bash
ssh dv@77.221.159.163 'pm2 status'     # poolwatt-web must be online
cd ~/poolwatt && npm run test:e2e -- support-compensation
```

Expected: PASS.

- [ ] **Step 4: Run everything**

```bash
TESTENV npx vitest run
cd ~/poolwatt && npm run test:e2e
```

Expected: the whole unit suite green (1808 cases before this work, plus the
new ones) and the whole e2e suite green.

- [ ] **Step 5: Commit**

```bash
git add e2e
git commit -m "test(support): §51 compensations on the live build, on a monitor and on a Pixel 7"
```

---

### Task 12: Tick the plan and the tracker

- [ ] **Step 1: Tick every box above that is done**

- [ ] **Step 2: Update `inbox/TZ-STATUS.md`**

Mark N-2 `готово 2026-11-27`, write what was found before the work started
(the dead `compensation` field, the missing session link, the refund that
would never have reached the partner's books), what was built, what was
checked and how, and what is not there and why (a refund to a card, a payout,
push). The story count does not change: §51's compensation lines have no user
story of their own.

- [ ] **Step 3: Commit (the tracker is gitignored, so only the plan)**

```bash
git add docs/superpowers/plans/2026-11-27-support-compensation.md
git commit -m "docs(support): tick the §51 compensation plan"
```
