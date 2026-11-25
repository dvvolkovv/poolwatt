// POST /v1/point-templates — ТЗ §31, US-25.
//
// Creates or updates a template and, when asked, applies it in the same call:
// an owner rolling out a winter tariff across fifty stations wants one
// request, not two.

import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, parseBody, sessionUser, unauthorized } from "@/lib/exchange/api";
import { TemplateError, applyTemplate, saveTemplate } from "@/lib/points/point-template";

const bodySchema = z.object({
  operatorId: z.string().min(1),
  name: z.string().trim().min(2).max(80),
  tariffs: z
    .array(
      z.object({
        label: z.string().max(80).optional().nullable(),
        fromMinute: z.number().int().min(0).max(1440),
        toMinute: z.number().int().min(0).max(1440),
        priceFiat: z.number().min(0).max(1000).optional().nullable(),
        currency: z.string().length(3).optional(),
        priceTokens: z.number().min(0).max(1000).optional().nullable(),
        idleFeePerMin: z.number().min(0).max(1000).optional().nullable(),
        coopDiscount: z.number().int().min(0).max(100).optional().nullable(),
      }),
    )
    .max(12)
    .default([]),
  open24: z.boolean().optional(),
  holidayNote: z.string().max(200).optional().nullable(),
  paymentMethods: z.array(z.string().max(32)).max(10).optional(),
  amenities: z.array(z.string().max(32)).max(20).optional(),
  /** Apply it straight away: null means the whole network. */
  apply: z.boolean().optional(),
  pointIds: z.array(z.string().max(40)).max(500).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const parsed = await parseBody(req, bodySchema);
  if ("response" in parsed) return parsed.response;
  const { apply, pointIds, ...input } = parsed.data;

  try {
    const template = await saveTemplate({ ...input, actorId: user.id });
    const applied = apply
      ? (await applyTemplate({ templateId: template.id, pointIds: pointIds ?? null, actorId: user.id }))
          .applied
      : 0;

    return ok(
      { template: { id: template.id, name: template.name, applied } },
      201,
    );
  } catch (err) {
    if (err instanceof TemplateError) {
      return fail(err.message, /somebody else|No such/.test(err.message) ? 404 : 400);
    }
    throw err;
  }
}
