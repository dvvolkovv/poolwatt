// GET/POST /v1/pipeline — ТЗ §50, US-51.

import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, parseBody, sessionUser, unauthorized } from "@/lib/exchange/api";
import { LEAD_STAGES, LeadError, createLead, readBoard } from "@/lib/crm/lead-service";

const createSchema = z.object({
  operatorId: z.string().min(1),
  title: z.string().trim().min(2).max(160),
  country: z.string().max(2).optional().nullable(),
  city: z.string().max(80).optional().nullable(),
  addressLine: z.string().max(200).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  ownerEmployeeId: z.string().max(40).optional().nullable(),
  dueAt: z.string().datetime().optional().nullable(),
});

export async function GET(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const operatorId = req.nextUrl.searchParams.get("operatorId");
  if (!operatorId) return fail("operatorId is required", 400);

  try {
    const board = await readBoard(operatorId, user.id);
    return ok({
      stages: LEAD_STAGES,
      totals: board.totals,
      columns: board.columns.map((c) => ({
        stage: c.stage,
        leads: c.leads.map((l) => ({
          id: l.id,
          title: l.title,
          city: l.city,
          stage: l.stage,
          owner: l.ownerName,
          dueAt: l.dueAt?.toISOString() ?? null,
          overdue: l.overdue,
          notes: l.noteCount,
          documents: l.documentCount,
        })),
      })),
      lost: board.lost.map((l) => ({ id: l.id, title: l.title, reason: l.lostReason })),
    });
  } catch (err) {
    if (err instanceof LeadError) return fail("Not found", 404);
    throw err;
  }
}

export async function POST(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const parsed = await parseBody(req, createSchema);
  if ("response" in parsed) return parsed.response;
  const { dueAt, ...rest } = parsed.data;

  try {
    const lead = await createLead({
      ...rest,
      actorId: user.id,
      dueAt: dueAt ? new Date(dueAt) : null,
    });
    return ok({ lead: { id: lead.id, stage: lead.stage, title: lead.title } }, 201);
  } catch (err) {
    if (err instanceof LeadError) {
      return fail(err.message, /somebody else|No such/.test(err.message) ? 404 : 400);
    }
    throw err;
  }
}
