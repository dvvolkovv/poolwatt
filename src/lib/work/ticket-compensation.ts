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
//
// Сторона партнёра при возврате не дебетуется — её не кредитовали и при
// списании: плата за бронь в US-55 так же просто ушла из кошелька водителя,
// потому что расчёты с партнёром ждут EMI (`gates.ts`).

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { type Db, writeAudit } from "@/lib/exchange/audit";
import { num } from "@/lib/exchange/decimal";
import { roundKwh, roundMoney } from "@/lib/exchange/precision";
import { assertReceiptRefundsOpen, receiptRefundsOpen } from "@/lib/exchange/gates";
import { nextReceiptNumber } from "@/lib/receipts/receipt-number";
import { issueGrantTx } from "@/lib/marketing/campaign-engine";
import { systemMessage } from "./ticket-conversation";

export class TicketCompensationError extends Error {}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

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

/** §51 «Ошибочное списание — возврат после проверки поддержкой». */
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
      payment: {
        select: {
          id: true,
          walletId: true,
          status: true,
          cardId: true,
          amountFiat: true,
          zone: { select: { currency: true } },
        },
      },
    },
  });
  if (!ticket) throw new TicketCompensationError("No such ticket");
  if (!ticket.payment) {
    throw new TicketCompensationError(
      "This ticket names no session: there is nothing to give back",
    );
  }
  if (ticket.payment.status !== "CAPTURED") {
    throw new TicketCompensationError("That session was not charged for");
  }
  // §46 — возврат на карту делает провайдер, а не мы.
  if (ticket.payment.cardId && !receiptRefundsOpen()) assertReceiptRefundsOpen();

  const payment = ticket.payment;
  const currency = payment.zone.currency;

  let created: { id: string; number: string };
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
          `That is more than the session cost: ${roundMoney(charged - refunded)} ${currency} left to give back`,
        );
      }

      const row = await tx.paymentRefund.create({
        data: {
          paymentId: payment.id,
          ticketId: ticket.id,
          walletId: payment.walletId,
          number: await nextReceiptNumber(tx),
          amountFiat: new Prisma.Decimal(amount),
          currency,
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
    `A refund of ${amount.toFixed(2)} ${currency} has been credited to your balance (${created.number}).`,
  );

  return { id: created.id, number: created.number, amountFiat: amount, currency };
}

/**
 * §51 «Дополнения: Ticket получает поле compensation». Одна строка о том, что
 * сеть вернула, пересобранная из фактов — подарков и возвратов этой заявки.
 * Экраны читают её, а не считают сами: цифра, посчитанная на двух страницах
 * по-разному, однажды разойдётся.
 */
export async function stampCompensation(db: Db, ticketId: string): Promise<string | null> {
  const grants = await db.promoGrant.findMany({
    where: { onceKey: `ticket-${ticketId}` },
    select: { amountKwh: true },
  });
  const refunds = await db.paymentRefund.findMany({
    where: { ticketId },
    select: { amountFiat: true, currency: true },
  });

  const parts: string[] = [];
  const kwh = roundKwh(grants.reduce((sum, g) => sum + num(g.amountKwh), 0));
  if (kwh > 0) parts.push(`${kwh.toFixed(3)} kWh`);
  const money = roundMoney(refunds.reduce((sum, r) => sum + num(r.amountFiat), 0));
  if (money > 0) parts.push(`${money.toFixed(2)} ${refunds[0]?.currency ?? "EUR"}`);

  const line = parts.length > 0 ? parts.join(" + ") : null;
  await db.ticket.update({ where: { id: ticketId }, data: { compensation: line } });
  return line;
}

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
  const reporterId = ticket.reporterId;

  const campaign = await readCompensationCampaign(ticket.operatorId, ticket.pointId);
  if (!campaign) {
    throw new TicketCompensationError("This network has not configured a compensation");
  }

  const onceKey = `ticket-${ticketId}`;
  let grantId: string | null;
  try {
    grantId = await prisma.$transaction((tx) =>
      issueGrantTx(tx, campaign, {
        userId: reporterId,
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
 * вторую — но читатель всё равно берёт самую новую и предпочитает названный
 * пункт, чтобы данные из прошлого не делали выбор монеткой.
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
  const scoped = campaigns.find(
    (c) => pointId !== null && c.scopePointIds.includes(pointId),
  );
  return scoped ?? campaigns.find((c) => c.scopePointIds.length === 0) ?? null;
}
