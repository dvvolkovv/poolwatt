// POST /v1/work-orders/{id}/signature — подпись §48.
//
// Росчерк с холста — десятки килобайт, поэтому подпись, в отличие от
// фотографии, переживает отсутствие связи в очереди офлайна.

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
  MAX_SIGNATURE_BYTES,
  WorkOrderMediaError,
  saveSignature,
} from "@/lib/work/work-order-media";

const bodySchema = z.object({
  // Инженер, подписавшийся сам, — не подделка подписи клиента, и называется
  // прямо: у станции часто нет никого на месте.
  signerKind: z.enum(["SITE_CONTACT", "ENGINEER"]),
  signerName: z.string().trim().min(1).max(200),
  base64: z.string().max(Math.ceil((MAX_SIGNATURE_BYTES * 4) / 3) + 1024),
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
      endpoint: "POST /v1/work-orders/{id}/signature",
      key: idempotencyKey(request),
      userKey: user.id,
      body: { id, signerKind: body.signerKind, signerName: body.signerName },
      run: async () => {
        const signature = await saveSignature(id, {
          signerKind: body.signerKind,
          signerName: body.signerName,
          bytes: Buffer.from(body.base64, "base64"),
          signedById: user.id,
        });
        return { status: 201, data: { signature } };
      },
    });
  } catch (err) {
    if (err instanceof WorkOrderMediaError) return fail(err.message, 400);
    throw err;
  }
}
