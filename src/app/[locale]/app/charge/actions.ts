"use server";

// §22.9, US-20. Старт и завершение сеанса из телефона.
//
// Ключ идемпотентности рождается в браузере и приходит в форме: одно нажатие
// — один сеанс, даже если палец дрогнул и форма ушла дважды.

import { auth } from "@/lib/auth";
import {
  ChargeSessionError,
  authorizeSession,
  finishSession,
  readSession,
} from "@/lib/exchange/charge-session";

export interface StartResult {
  error?: string;
  sessionId?: string;
}

export async function startCharge(form: FormData): Promise<StartResult> {
  const session = await auth();
  if (!session?.user) return { error: "unauthorized" };

  const pointId = String(form.get("pointId") ?? "");
  const connectorId = String(form.get("connectorId") ?? "");
  const plannedKwh = Number(form.get("plannedKwh") ?? 0);
  const idempotencyKey = String(form.get("idempotencyKey") ?? "");
  if (!idempotencyKey) return { error: "missing idempotency key" };

  try {
    const started = await authorizeSession({
      userId: session.user.id,
      pointId,
      connectorId,
      plannedKwh,
      idempotencyKey,
    });
    return { sessionId: started.id };
  } catch (err) {
    if (err instanceof ChargeSessionError) return { error: err.message };
    throw err;
  }
}

export async function stopCharge(sessionId: string): Promise<{ error?: string }> {
  const session = await auth();
  if (!session?.user) return { error: "unauthorized" };

  const row = await readSession(sessionId);
  // Чужой сеанс для этого водителя не существует.
  if (!row || row.userId !== session.user.id) return { error: "not found" };

  try {
    await finishSession({ sessionId, reason: "the driver stopped it in the app" });
    return {};
  } catch (err) {
    if (err instanceof ChargeSessionError) return { error: err.message };
    throw err;
  }
}
