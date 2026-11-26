// GET /v1/charge-sessions/me/active — что показать на экране зарядки.
import { NextResponse } from "next/server";
import { sessionUser, unauthorized } from "@/lib/exchange/api";
import { readActiveSession, readLastTick } from "@/lib/exchange/charge-session";

export async function GET() {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const session = await readActiveSession(user.id);
  const lastTick = session ? await readLastTick(session.id) : null;
  return NextResponse.json({ session, lastTick });
}
