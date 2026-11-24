// POST /v1/orders — ТЗ §15, US-06, US-07, §6.
// GET /v1/orders — the caller's own orders (the terminal's "статус заявок").
import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  domainError,
  idempotencyKey,
  idempotent,
  ok,
  parseBody,
  sessionUser,
  unauthorized,
} from "@/lib/exchange/api";
import { num, numOrNull } from "@/lib/exchange/decimal";
import { placeOrder } from "@/lib/exchange/order-service";
import { requireZone } from "@/lib/exchange/zone-service";
import { prisma } from "@/lib/prisma";

const bodySchema = z
  .object({
    zoneId: z.string().min(1),
    side: z.enum(["BUY", "SELL"]),
    type: z.enum(["MARKET", "LIMIT"]),
    amountKwh: z.number().positive().max(10_000_000),
    limitPrice: z.number().positive().max(99.9999).optional().nullable(),
    intervalStart: z.string().optional().nullable(),
  })
  .refine((v) => v.type === "MARKET" || v.limitPrice != null, {
    message: "A limit order requires limitPrice",
    path: ["limitPrice"],
  });

export async function POST(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const parsed = await parseBody(req, bodySchema);
  if ("response" in parsed) return parsed.response;

  let intervalStart: Date | null = null;
  if (parsed.data.intervalStart) {
    intervalStart = new Date(parsed.data.intervalStart);
    if (Number.isNaN(intervalStart.getTime())) {
      return domainError(new Error("Invalid intervalStart"));
    }
  }

  const key = idempotencyKey(req);
  try {
    return await idempotent({
      endpoint: "POST /v1/orders",
      key,
      userKey: user.id,
      body: parsed.data,
      run: async () => {
        const zone = await requireZone(parsed.data.zoneId);
        const result = await placeOrder({
          userId: user.id,
          zoneId: zone.id,
          side: parsed.data.side,
          type: parsed.data.type,
          amountKwh: parsed.data.amountKwh,
          limitPrice: parsed.data.limitPrice ?? null,
          intervalStart,
          idempotencyKey: key,
        });
        // A rejected order is a recorded business outcome, not a transport
        // error: it has an id and a reason the client can show (§14 statuses).
        return { status: result.rejectReason ? 200 : 201, data: { order: result } };
      },
    });
  } catch (err) {
    return domainError(err);
  }
}

export async function GET(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);

  const orders = await prisma.order.findMany({
    where: {
      wallet: { ownerUserId: user.id },
      ...(status ? { status: status as never } : {}),
    },
    include: { zone: { select: { code: true, currency: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return ok({
    orders: orders.map((o) => ({
      id: o.id,
      zone: o.zone.code,
      currency: o.zone.currency,
      side: o.side,
      type: o.type,
      intervalStart: o.intervalStart?.toISOString() ?? null,
      amountKwh: num(o.amountKwh),
      filledKwh: num(o.filledKwh),
      limitPrice: numOrNull(o.limitPrice),
      avgPrice: numOrNull(o.avgPrice),
      reservedFiat: num(o.reservedFiat),
      status: o.status,
      rejectReason: o.rejectReason,
      createdAt: o.createdAt.toISOString(),
    })),
  });
}
