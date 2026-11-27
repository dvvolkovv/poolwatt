// GET /v1/tickets/me — метод из §51. Свои заявки и состояние каждой.

import { ok, unauthorized, sessionUser } from "@/lib/exchange/api";
import { listMyTickets } from "@/lib/work/ticket-view";

export async function GET() {
  const user = await sessionUser();
  if (!user) return unauthorized();
  return ok({ tickets: await listMyTickets(user.id, 100) });
}
