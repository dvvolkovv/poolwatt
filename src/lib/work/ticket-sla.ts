// §48 «SLA по приоритету; эскалация».
//
// Срок ответа ставится в заявку в момент отправки (`respondBy`, по виду
// проблемы) и до этой работы его не читал никто — он был строкой в списке.
// Теперь просроченная без ответа заявка поднимается на ступень и о ней
// узнаёт владелец сети.
//
// Два правила, которые выглядят мелочью и ими не являются:
//
//  * эскалация происходит один раз. Смысл в том, чтобы поднять заявку, а не
//    звонить каждую минуту: проход идёт раз в минуту, и письмо без отметки
//    превратилось бы в тысячу четыреста писем в сутки;
//  * поздний ответ приоритет не опускает. Просрочка уже случилась, и отчёт
//    по §48 должен её помнить.

import { WorkOrderPriority } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { systemMessage } from "./ticket-conversation";

/** Решённая заявка закрывается сама, если спорить никто не стал. */
export const RESOLVED_CLOSE_DAYS = 7;

const NEXT_PRIORITY: Record<WorkOrderPriority, WorkOrderPriority> = {
  LOW: WorkOrderPriority.NORMAL,
  NORMAL: WorkOrderPriority.HIGH,
  HIGH: WorkOrderPriority.URGENT,
  URGENT: WorkOrderPriority.URGENT,
};

export interface EscalateOptions {
  sendTo?: (to: string, subject: string, html: string) => Promise<unknown>;
}

export async function escalateOverdueTickets(
  now: Date = new Date(),
  options: EscalateOptions = {},
): Promise<number> {
  const send =
    options.sendTo ??
    ((to: string, subject: string, html: string) => sendEmail({ to, subject, html }));

  const overdue = await prisma.ticket.findMany({
    where: {
      firstRespondedAt: null,
      escalatedAt: null,
      respondBy: { not: null, lt: now },
      status: { in: ["OPEN", "IN_PROGRESS"] },
    },
    orderBy: { respondBy: "asc" },
    take: 200,
    include: {
      point: { select: { name: true, city: true } },
      operator: {
        select: {
          id: true,
          displayName: true,
          email: true,
          claimedBy: { select: { email: true, emailVerified: true } },
        },
      },
    },
  });

  let raised = 0;
  for (const ticket of overdue) {
    // Отметка ставится условным update: два прохода, случившиеся рядом,
    // дадут одну эскалацию и одно письмо.
    const { count } = await prisma.ticket.updateMany({
      where: { id: ticket.id, escalatedAt: null, firstRespondedAt: null },
      data: { escalatedAt: now, priority: NEXT_PRIORITY[ticket.priority] },
    });
    if (count === 0) continue;

    await systemMessage(
      prisma,
      ticket.id,
      "The agreed response time has passed with no answer: the ticket has been escalated.",
    );

    const recipients = new Set<string>();
    const owner = ticket.operator?.claimedBy;
    if (owner?.email && owner.emailVerified) recipients.add(owner.email);
    if (ticket.operator?.email) recipients.add(ticket.operator.email);

    const where = [ticket.point?.name, ticket.point?.city].filter(Boolean).join(", ");
    for (const to of recipients) {
      await send(
        to,
        `[Poolwatt] Ticket overdue: ${ticket.problemType}`,
        `<p><b>${ticket.problemType}</b>${where ? ` — ${where}` : ""}</p>
         <p>No answer within the agreed response time. The ticket is now ${NEXT_PRIORITY[ticket.priority]}.</p>`,
      ).catch(() => undefined);
    }
    raised += 1;
  }
  return raised;
}

export async function closeResolvedTickets(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - RESOLVED_CLOSE_DAYS * 86_400_000);
  const { count } = await prisma.ticket.updateMany({
    where: { status: "RESOLVED", resolvedAt: { not: null, lt: cutoff } },
    data: { status: "CLOSED", closedAt: now },
  });
  return count;
}
