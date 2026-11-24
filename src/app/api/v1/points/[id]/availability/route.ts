// POST /v1/points/{id}/availability — ТЗ §27, §29.4, US-23.
//
// The equipment of one point says how busy its connectors are. Bearer key of
// the point plus an HMAC signature (§15); the first accepted report publishes
// the card.

import { NextResponse } from "next/server";
import { AvailabilityError, reportAvailability } from "@/lib/points/point-availability";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }

  let body: { connectors?: { type: string; status: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body is not JSON" }, { status: 400 });
  }
  if (!Array.isArray(body?.connectors)) {
    return NextResponse.json({ error: "connectors must be an array" }, { status: 422 });
  }

  try {
    const result = await reportAvailability({
      token,
      body: { connectors: body.connectors },
      signature: req.headers.get("x-poolwatt-signature"),
      timestamp: req.headers.get("x-poolwatt-timestamp"),
      path: `/v1/points/${id}/availability`,
    });
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    if (err instanceof AvailabilityError) {
      // An unknown key and a bad signature are both "we will not take this",
      // and neither tells the caller which it was.
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[points/availability]", err);
    return NextResponse.json({ error: "Could not record availability" }, { status: 500 });
  }
}
