// POST /v1/work-orders/{id}/photos — снимок «до» или «после», §48.
//
// Снимок приезжает строкой base64 одним запросом, как фотография заявки
// §51.4. Без связи он не ставится в очередь: кадр с камеры 2–5 МБ, и три
// таких не влезут в `localStorage` — очередь молча потеряла бы запись.

import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  fail,
  idempotencyKey,
  idempotent,
  notFound,
  parseBody,
  sessionUser,
  unauthorized,
} from "@/lib/exchange/api";
import { readWorkOrderForUser } from "@/lib/work/work-order-access";
import {
  MAX_PHOTO_BYTES,
  WorkOrderMediaError,
  saveSitePhoto,
} from "@/lib/work/work-order-media";

const bodySchema = z.object({
  stage: z.enum(["BEFORE", "AFTER"]),
  filename: z.string().max(200),
  base64: z.string().max(Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 1024),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await sessionUser();
  if (!user) return unauthorized();

  const parsed = await parseBody(request, bodySchema);
  if ("response" in parsed) return parsed.response;
  const body = parsed.data;

  const seen = await readWorkOrderForUser(id, user.id, user.role);
  if (!seen?.canWork) return notFound();

  try {
    return await idempotent({
      endpoint: "POST /v1/work-orders/{id}/photos",
      key: idempotencyKey(request),
      userKey: user.id,
      body: { id, stage: body.stage, filename: body.filename, size: body.base64.length },
      run: async () => {
        const photo = await saveSitePhoto(id, {
          stage: body.stage,
          filename: body.filename,
          bytes: Buffer.from(body.base64, "base64"),
          takenById: user.id,
        });
        return { status: 201, data: { photo } };
      },
    });
  } catch (err) {
    if (err instanceof WorkOrderMediaError) return fail(err.message, 400);
    throw err;
  }
}
