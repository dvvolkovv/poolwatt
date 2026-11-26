// POST /v1/charge-sessions/{id}/meter — ТЗ §15, US-20.
//
// Оборудование говорит, сколько кВт·ч уже выдало. Ключ пункта плюс подпись
// HMAC, как у занятости разъёмов: чей это сеанс, решает не заголовок, а то,
// что ключ принадлежит пункту сеанса.
import { NextResponse } from "next/server";
import { ChargeSessionError, reportMeter } from "@/lib/exchange/charge-session";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

  let body: { kwhTotal?: unknown; powerKw?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body is not JSON" }, { status: 400 });
  }
  if (typeof body?.kwhTotal !== "number") {
    return NextResponse.json({ error: "kwhTotal must be a number" }, { status: 422 });
  }

  try {
    const session = await reportMeter({
      token,
      sessionId: id,
      body: {
        kwhTotal: body.kwhTotal,
        powerKw: typeof body.powerKw === "number" ? body.powerKw : null,
      },
      signature: req.headers.get("x-poolwatt-signature"),
      timestamp: req.headers.get("x-poolwatt-timestamp"),
      path: `/v1/charge-sessions/${id}/meter`,
    });
    return NextResponse.json({ session }, { status: 202 });
  } catch (err) {
    if (err instanceof ChargeSessionError) {
      // Неизвестный ключ, чужой пункт и плохая подпись — всё «мы это не
      // возьмём», и ни одно из них не говорит оборудованию, что именно не так.
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[charge-sessions/meter]", err);
    return NextResponse.json({ error: "Could not record the meter report" }, { status: 500 });
  }
}
