// POST /v1/marketing/events — §44 "Показы и клики по контенту, просмотры
// видео", US-44. Written by the browser; signing in is not required, because
// a show is a show whoever saw it.
import type { NextRequest } from "next/server";
import { z } from "zod";
import { domainError, ok, parseBody, sessionUser } from "@/lib/exchange/api";
import { recordContentEvent } from "@/lib/marketing/content-events";

const bodySchema = z.object({
  contentId: z.string().min(1).max(40),
  kind: z.enum(["IMPRESSION", "CLICK", "VIDEO_VIEW"]),
  pointId: z.string().max(40).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, bodySchema);
  if ("response" in parsed) return parsed.response;

  // Signed in or not: the viewer is recorded when we know them, because §44's
  // returning share can only count the people we can recognise.
  const user = await sessionUser();

  try {
    await recordContentEvent({
      contentId: parsed.data.contentId,
      kind: parsed.data.kind,
      userId: user?.id ?? null,
      pointId: parsed.data.pointId ?? null,
    });
    return ok({ recorded: true });
  } catch (err) {
    return domainError(err);
  }
}
