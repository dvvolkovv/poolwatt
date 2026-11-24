// PATCH /v1/listing-applications/{id}/decision — ТЗ §15, US-02.
import type { NextRequest } from "next/server";
import { z } from "zod";
import { domainError, forbidden, ok, operatorUser, parseBody } from "@/lib/exchange/api";
import { decideApplication } from "@/lib/exchange/listing-service";

const bodySchema = z
  .object({
    approve: z.boolean(),
    comment: z.string().max(2000).optional().nullable(),
    screeningNote: z.string().max(2000).optional().nullable(),
  })
  // US-02: "отказ требует комментария" — enforced here as well as in the
  // service, so the API contract documents it.
  .refine((v) => v.approve || Boolean(v.comment?.trim()), {
    message: "A rejection requires a comment",
    path: ["comment"],
  });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const operator = await operatorUser();
  if (!operator) return forbidden("Operator role required");

  const { id } = await params;
  const parsed = await parseBody(req, bodySchema);
  if ("response" in parsed) return parsed.response;

  try {
    const result = await decideApplication({
      applicationId: id,
      reviewerId: operator.id,
      approve: parsed.data.approve,
      comment: parsed.data.comment ?? null,
      screeningNote: parsed.data.screeningNote ?? null,
    });
    return ok({
      application: {
        id: result.application.id,
        status: result.application.status,
        decidedAt: result.application.decidedAt?.toISOString() ?? null,
        decisionComment: result.application.decisionComment,
      },
      accountId: result.accountId,
      promotedAssets: result.promotedAssets,
    });
  } catch (err) {
    return domainError(err);
  }
}
