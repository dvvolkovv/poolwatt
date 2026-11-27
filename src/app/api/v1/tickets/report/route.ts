// POST /v1/tickets/report — метод из §51 («новые методы API: POST
// /v1/tickets/report, GET /v1/tickets/me»).
//
// Ключа идемпотентности §15 здесь нет: заявка не двигает ни деньги, ни
// киловатт-часы. Двойное нажатие всё равно даёт одну заявку — склейку делает
// `reportProblem` по заявителю, пункту и типу проблемы.

import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, parseBody, sessionUser } from "@/lib/exchange/api";
import { MAX_TICKET_PHOTOS, MAX_TICKET_PHOTO_BYTES } from "@/lib/work/ticket-photos";
import { TicketError, reportProblem } from "@/lib/work/ticket-service";

const schema = z.object({
  pointId: z.string().min(1),
  connectorId: z.string().min(1).nullable().optional(),
  problemType: z.enum([
    "NO_START",
    "INTERRUPTED",
    "DAMAGED_CABLE",
    "SCREEN_DEAD",
    "BLOCKED",
    "WRONG_PRICE",
    "OTHER",
  ]),
  comment: z.string().trim().max(2000).nullable().optional(),
  photos: z
    .array(
      z.object({
        filename: z.string().max(200),
        base64: z.string().max(Math.ceil((MAX_TICKET_PHOTO_BYTES * 4) / 3) + 1024),
      }),
    )
    .max(MAX_TICKET_PHOTOS)
    .optional(),
});

export async function POST(request: NextRequest) {
  const parsed = await parseBody(request, schema);
  if ("response" in parsed) return parsed.response;
  const body = parsed.data;

  // Сообщить о поломке можно и без входа: §51 просит тридцать секунд.
  const user = await sessionUser();

  try {
    const result = await reportProblem({
      pointId: body.pointId,
      connectorId: body.connectorId ?? null,
      reporterId: user?.id ?? null,
      problemType: body.problemType,
      comment: body.comment ?? null,
      source: "api",
      photos: body.photos?.map((photo) => ({
        filename: photo.filename,
        bytes: Buffer.from(photo.base64, "base64"),
      })),
    });
    return ok(
      {
        ticket: {
          id: result.ticket.id,
          status: result.ticket.status,
          priority: result.ticket.priority,
          respondBy: result.ticket.respondBy?.toISOString() ?? null,
          photos: result.ticket.photos.length,
        },
        workOrderId: result.workOrder?.id ?? null,
        // US-53 — куда поехать вместо этого.
        alternatives: result.alternatives.map((p) => ({
          id: p.id,
          name: p.name,
          city: p.city,
          distanceM: p.distanceM,
        })),
      },
      201,
    );
  } catch (err) {
    if (err instanceof TicketError) return fail(err.message, 404);
    throw err;
  }
}
