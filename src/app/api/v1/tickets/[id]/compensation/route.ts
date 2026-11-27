// POST /v1/tickets/{id}/compensation — §51 «партнёр может настроить
// компенсацию подарочными кВт·ч своей сети за неудобство».
//
// Тела нет: размер назначил партнёр в своей кампании, поддержка решает «да
// или нет». `Idempotency-Key` всё равно нужен — подарок это энергия из
// бюджета сети.

import type { NextRequest } from "next/server";
import {
  domainError,
  idempotencyKey,
  idempotent,
  notFound,
  sessionUser,
  unauthorized,
} from "@/lib/exchange/api";
import { readTicketForUser } from "@/lib/work/ticket-access";
import { grantTicketCompensation } from "@/lib/work/ticket-compensation";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await sessionUser();
  if (!user) return unauthorized();

  const seen = await readTicketForUser(id, user.id, user.role);
  if (!seen?.canWrite || seen.authorKind !== "SUPPORT") return notFound();

  try {
    return await idempotent({
      endpoint: "POST /v1/tickets/{id}/compensation",
      key: idempotencyKey(request),
      userKey: user.id,
      body: { ticketId: id },
      run: async () => {
        const grant = await grantTicketCompensation(id, user.id);
        return {
          status: 201,
          data: {
            compensation: {
              grantId: grant.grantId,
              amountKwh: grant.amountKwh,
              expiresAt: grant.expiresAt.toISOString(),
            },
          },
        };
      },
    });
  } catch (err) {
    return domainError(err);
  }
}
