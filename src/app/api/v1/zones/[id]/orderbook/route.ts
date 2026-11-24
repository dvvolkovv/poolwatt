// GET /v1/zones/{id}/orderbook?intervalStart= — ТЗ §15, §6.
import type { NextRequest } from "next/server";
import { domainError, ok } from "@/lib/exchange/api";
import { readOrderBook } from "@/lib/exchange/order-service";
import { requireZone } from "@/lib/exchange/zone-service";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raw = new URL(req.url).searchParams.get("intervalStart");
  const intervalStart = raw ? new Date(raw) : null;
  if (intervalStart && Number.isNaN(intervalStart.getTime())) {
    return domainError(new Error("Invalid intervalStart"));
  }

  try {
    const zone = await requireZone(id);
    return ok({ orderbook: await readOrderBook(zone.id, intervalStart) });
  } catch (err) {
    return domainError(err);
  }
}
