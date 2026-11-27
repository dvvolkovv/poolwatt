// POST /v1/tickets/{id}/refund — §51 «Ошибочное списание — возврат после
// проверки поддержкой».
//
// Движение денег, значит `Idempotency-Key`: повторённый запрос обязан дать
// тот же ответ, а не второй возврат. Второй возврат по одной заявке закрыт и
// в самой модели — одна проверка, один возврат.

import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  domainError,
  idempotencyKey,
  idempotent,
  notFound,
  parseBody,
  sessionUser,
  unauthorized,
} from "@/lib/exchange/api";
import { readTicketForUser } from "@/lib/work/ticket-access";
import { refundTicketPayment } from "@/lib/work/ticket-compensation";

const schema = z.object({
  amountFiat: z.number().positive().max(1_000_000),
  reason: z.string().trim().min(1).max(2000),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await sessionUser();
  if (!user) return unauthorized();

  const parsed = await parseBody(request, schema);
  if ("response" in parsed) return parsed.response;

  const seen = await readTicketForUser(id, user.id, user.role);
  // Возврат решает сторона поддержки. Клиенту заявка видна, но не эта кнопка,
  // и для него её не существует — как и самой заявки для чужого.
  if (!seen?.canWrite || seen.authorKind !== "SUPPORT") return notFound();

  try {
    return await idempotent({
      endpoint: "POST /v1/tickets/{id}/refund",
      key: idempotencyKey(request),
      userKey: user.id,
      body: { ticketId: id, ...parsed.data },
      run: async () => {
        const refund = await refundTicketPayment({
          ticketId: id,
          supportUserId: user.id,
          amountFiat: parsed.data.amountFiat,
          reason: parsed.data.reason,
        });
        return { status: 201, data: { refund } };
      },
    });
  } catch (err) {
    return domainError(err);
  }
}
