// §51 «после ремонта клиент получает уведомление, что станция снова
// работает».
//
// Почему проходом воркера, а не внутри `setConnectorStatus`: единственный
// писатель занятости разъёма работает внутри транзакций, которые двигают
// деньги и энергию (сеанс зарядки, бронь, отчёт оборудования), и письмо из
// такой транзакции роняло бы зарядку. Тот же довод, по которому доставка
// чека и письмо о наряде живут в воркере.
//
// Сообщить можно только о том, о чём мы знаем: заявка должна называть
// разъём, иначе «снова работает» — догадка о чужом оборудовании.

import { TicketProblemType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { systemMessage } from "./ticket-conversation";

/** Те же четыре вида, что заводят наряд: сломанное может починиться. */
const TECHNICAL: TicketProblemType[] = [
  TicketProblemType.NO_START,
  TicketProblemType.INTERRUPTED,
  TicketProblemType.DAMAGED_CABLE,
  TicketProblemType.SCREEN_DEAD,
];

export interface RecoveryOptions {
  sendTo?: (to: string, subject: string, html: string) => Promise<unknown>;
}

export async function notifyRecoveredTickets(
  now: Date = new Date(),
  options: RecoveryOptions = {},
): Promise<number> {
  const send =
    options.sendTo ??
    ((to: string, subject: string, html: string) => sendEmail({ to, subject, html }));

  const recovered = await prisma.ticket.findMany({
    where: {
      recoveryNotifiedAt: null,
      status: { not: "CLOSED" },
      problemType: { in: TECHNICAL },
      connectorId: { not: null },
      reporterId: { not: null },
      connector: { status: { not: "OUT_OF_SERVICE" } },
    },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: {
      point: { select: { name: true, city: true } },
      connector: { select: { type: true } },
      reporter: { select: { email: true, emailVerified: true } },
    },
  });

  let told = 0;
  for (const ticket of recovered) {
    // Условный update: два прохода рядом дадут одно письмо.
    const { count } = await prisma.ticket.updateMany({
      where: { id: ticket.id, recoveryNotifiedAt: null },
      data: { recoveryNotifiedAt: now },
    });
    if (count === 0) continue;

    const where = [ticket.point?.name, ticket.point?.city].filter(Boolean).join(", ");
    await systemMessage(
      prisma,
      ticket.id,
      `The connector you reported is working again${where ? ` (${where})` : ""}.`,
    );

    // Письма нет — запись в разговоре всё равно есть: человек увидит её,
    // когда откроет заявку. Почта не единственный канал.
    if (ticket.reporter?.email && ticket.reporter.emailVerified) {
      await send(
        ticket.reporter.email,
        "[Poolwatt] The station works again",
        `<p>${where || "The station"} is back in service.</p>
         <p>Thank you for the report.</p>`,
      ).catch(() => undefined);
    }
    told += 1;
  }
  return told;
}
