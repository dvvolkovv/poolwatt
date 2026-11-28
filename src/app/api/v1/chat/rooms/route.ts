// GET /v1/chat/rooms — мои комнаты и непрочитанное (§48). §50 чата не
// перечисляет: это добавление к списку методов, названное прямо.

import { ok, sessionUser, unauthorized } from "@/lib/exchange/api";
import { listMyRooms } from "@/lib/work/chat-service";

export async function GET() {
  const user = await sessionUser();
  if (!user) return unauthorized();
  return ok({ rooms: await listMyRooms(user.id) });
}
