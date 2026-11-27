// GET /v1/work-orders/{id}/candidates — ТЗ §48 «с учётом региона и загрузки».
// Телефон и внешний диспетчер видят тот же порядок, что страница кабинета.

import type { NextRequest } from "next/server";
import { notFound, ok, sessionUser, unauthorized } from "@/lib/exchange/api";
import { suggestAssignees } from "@/lib/work/assignment";
import { readWorkOrderForUser } from "@/lib/work/work-order-access";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await sessionUser();
  if (!user) return unauthorized();

  const seen = await readWorkOrderForUser(id, user.id, user.role);
  if (!seen) return notFound();

  return ok({ candidates: await suggestAssignees(id) });
}
