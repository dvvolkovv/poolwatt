// POST /v1/work-orders/{id}/tasks — отметка пункта чек-листа §48.
//
// Под ключом §15, потому что инженер отмечает пункты в подвале: очередь
// офлайна досылает запись, и повтор обязан дать тот же ответ.

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
  ChecklistError,
  ensureChecklist,
  readChecklist,
  skipTask,
  tickTask,
} from "@/lib/work/work-order-checklist";

const bodySchema = z.object({
  taskId: z.string().min(1),
  done: z.boolean().optional(),
  skipReason: z.string().max(2000).optional().nullable(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await sessionUser();
  if (!user) return unauthorized();
  const seen = await readWorkOrderForUser(id, user.id, user.role);
  if (!seen) return notFound();
  // Чек-лист создаётся при первом открытии: в базе уже лежат наряды, и без
  // этого §48 был бы выполнен только для будущих.
  const tasks = seen.canWork ? await ensureChecklist(id) : await readChecklist(id);
  return Response.json({ ok: true, tasks });
}

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
      endpoint: "POST /v1/work-orders/{id}/tasks",
      key: idempotencyKey(request),
      userKey: user.id,
      body: { id, ...body },
      run: async () => {
        // Пункт должен принадлежать этому наряду: чужой чек-лист правит
        // только тот, у кого право на тот наряд.
        const mine = await readChecklist(id);
        if (!mine.some((t) => t.id === body.taskId)) {
          throw new ChecklistError("No such checklist item on this order");
        }
        const task = body.skipReason
          ? await skipTask(body.taskId, user.id, body.skipReason)
          : await tickTask(body.taskId, user.id, body.done ?? true);
        return { status: 200, data: { task } };
      },
    });
  } catch (err) {
    if (err instanceof ChecklistError) {
      return fail(err.message, /No such/.test(err.message) ? 404 : 400);
    }
    throw err;
  }
}
