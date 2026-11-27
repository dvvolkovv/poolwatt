// §51 — водитель узнаёт, что сеть вернула деньги.
//
// Проходом воркера, а не письмом из транзакции возврата: та транзакция
// двигает деньги, и упавшая почта не должна её ронять. Тот же довод, по
// которому «станция снова работает» живёт в `ticket-recovery.ts`, а доставка
// чека — в `receipt-delivery.ts`.
//
// Письма может не быть вовсе — у человека может не быть подтверждённого
// адреса. Отметка всё равно ставится: запись в разговоре по заявке он увидит,
// когда откроет её, а проход не должен возвращаться к одному и тому же
// возврату каждую минуту.

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { num } from "@/lib/exchange/decimal";

export interface RefundMailOptions {
  sendTo?: (to: string, subject: string, html: string) => Promise<unknown>;
}

export async function notifyPendingRefunds(
  now: Date = new Date(),
  options: RefundMailOptions = {},
): Promise<number> {
  const send =
    options.sendTo ??
    ((to: string, subject: string, html: string) => sendEmail({ to, subject, html }));

  const pending = await prisma.paymentRefund.findMany({
    where: { notifiedAt: null },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: {
      wallet: { select: { owner: { select: { email: true, emailVerified: true } } } },
      payment: { select: { point: { select: { name: true, city: true } } } },
    },
  });

  let told = 0;
  for (const refund of pending) {
    // Строка занимается до отправки: два прохода не напишут дважды.
    const { count } = await prisma.paymentRefund.updateMany({
      where: { id: refund.id, notifiedAt: null },
      data: { notifiedAt: now },
    });
    if (count === 0) continue;

    const owner = refund.wallet.owner;
    const amount = `${num(refund.amountFiat).toFixed(2)} ${refund.currency}`;
    const where = [refund.payment.point?.name, refund.payment.point?.city]
      .filter(Boolean)
      .join(", ");

    if (owner.email && owner.emailVerified) {
      await send(
        owner.email,
        "[Poolwatt] A refund is back on your balance",
        `<p>${amount} has been credited to your Poolwatt balance.</p>
         ${where ? `<p>Session: ${where}.</p>` : ""}
         <p>Reason: ${refund.reason}</p>
         <p>Document: ${refund.number}</p>`,
      ).catch(() => undefined);
    }
    told += 1;
  }
  return told;
}
