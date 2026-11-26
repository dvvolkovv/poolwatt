// POST /v1/charge-sessions/{id}/stop — водитель закончил.
//
// Пока мост OCPP закрыт (`ocppOpen`), это не команда станции: сеанс
// рассчитывается по тому, что станция уже отчитала, а кабель водитель
// отсоединяет сам. Открытый мост добавит сюда RemoteStopTransaction.
import { NextResponse } from "next/server";
import { domainError, sessionUser, unauthorized } from "@/lib/exchange/api";
import { finishSession, readSession } from "@/lib/exchange/charge-session";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await sessionUser();
  if (!user) return unauthorized();

  const session = await readSession(id);
  // Чужой сеанс для этого водителя не существует — 404, не 403.
  if (!session || session.userId !== user.id) {
    return NextResponse.json({ error: "No such session" }, { status: 404 });
  }

  try {
    const done = await finishSession({ sessionId: id, reason: "the driver stopped it" });
    return NextResponse.json({ session: done });
  } catch (err) {
    return domainError(err);
  }
}
