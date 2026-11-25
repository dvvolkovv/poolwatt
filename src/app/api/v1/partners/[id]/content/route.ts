// POST /v1/partners/{id}/content — ТЗ §45, US-40.
//
// Multipart: the content's fields plus its files in one request, which is what
// an upload from outside the browser form needs. Moves neither money nor
// energy, so it carries no Idempotency-Key; a repeat creates a second draft
// the partner can delete.

import type { NextRequest } from "next/server";
import { z } from "zod";
import { domainError, fail, ok, parseRawBody, sessionUser, unauthorized } from "@/lib/exchange/api";
import {
  ContentError,
  attachAsset,
  createContent,
  deleteContent,
  submitForReview,
} from "@/lib/marketing/content-service";

const fieldsSchema = z.object({
  type: z.enum(["BANNER", "VIDEO", "GALLERY", "PROMO", "NEWS", "LINK"]),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(4000).optional().nullable(),
  linkUrl: z.string().url().max(500).optional().nullable(),
  placements: z.array(z.string().max(32)).max(8).optional(),
  audience: z.enum(["ALL", "NEWCOMERS", "REGULARS", "COOP_MEMBERS", "CARD_HOLDERS"]).optional(),
  pointIds: z.array(z.string().max(40)).max(200).optional(),
  zoneId: z.string().max(40).optional().nullable(),
  radiusKm: z.number().int().positive().max(5000).optional().nullable(),
  startsAt: z.string().datetime().optional().nullable(),
  endsAt: z.string().datetime().optional().nullable(),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  hourFrom: z.number().int().min(0).max(23).optional().nullable(),
  hourTo: z.number().int().min(0).max(23).optional().nullable(),
  submit: z.boolean().optional(),
});

/** A gallery takes ten; one extra file is refused by the service itself. */
const MAX_FILES = 11;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await sessionUser();
  if (!user) return unauthorized();
  const { id: operatorId } = await params;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("Send the content as multipart/form-data", 415);
  }

  const raw = form.get("content");
  if (typeof raw !== "string") {
    return fail('The "content" part must be the JSON fields of the content', 400);
  }
  const parsed = parseRawBody(raw, fieldsSchema);
  if ("response" in parsed) return parsed.response;
  const f = parsed.data;

  const files = form.getAll("files").filter((v): v is File => v instanceof File);
  if (files.length > MAX_FILES) return fail(`At most ${MAX_FILES} files per request`, 400);

  let contentId: string | null = null;
  try {
    const content = await createContent(operatorId, user.id, {
      type: f.type,
      title: f.title,
      body: f.body ?? null,
      linkUrl: f.linkUrl ?? null,
      placements: f.placements ?? [],
      audience: f.audience,
      pointIds: f.pointIds ?? [],
      zoneId: f.zoneId ?? null,
      radiusKm: f.radiusKm ?? null,
      startsAt: f.startsAt ? new Date(f.startsAt) : null,
      endsAt: f.endsAt ? new Date(f.endsAt) : null,
      weekdays: f.weekdays ?? [],
      hourFrom: f.hourFrom ?? null,
      hourTo: f.hourTo ?? null,
    });
    contentId = content.id;

    for (const file of files) {
      await attachAsset(content.id, user.id, Buffer.from(await file.arrayBuffer()));
    }

    const final = f.submit ? await submitForReview(content.id, user.id) : content;
    return ok({ content: { id: final.id, status: final.status, files: files.length } }, 201);
  } catch (err) {
    // A draft with a refused file left behind would be litter nobody asked
    // for: the request failed, so nothing of it stays.
    if (contentId) {
      try {
        await deleteContent(contentId, user.id);
      } catch {
        /* the original error is the one worth reporting */
      }
    }
    if (err instanceof ContentError) return fail(err.message, 400);
    return domainError(err);
  }
}
