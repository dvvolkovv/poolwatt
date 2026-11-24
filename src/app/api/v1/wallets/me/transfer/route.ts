// POST /v1/wallets/me/transfer — ТЗ §24, US-19.
// GET returns the remaining AML allowance for the transfer screen.
import type { NextRequest } from "next/server";
import { z } from "zod";
import { domainError, ok, parseBody, sessionUser, unauthorized } from "@/lib/exchange/api";
import { transfersOpen } from "@/lib/exchange/gates";
import { transferAllowance, transferKwh } from "@/lib/exchange/transfer-service";
import { requireZone } from "@/lib/exchange/zone-service";

const bodySchema = z.object({
  zoneId: z.string().min(1),
  toUsername: z.string().min(3).max(30),
  amountKwh: z.number().positive().max(100_000),
  note: z.string().max(200).optional().nullable(),
  requireConfirmation: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const parsed = await parseBody(req, bodySchema);
  if ("response" in parsed) return parsed.response;

  try {
    const zone = await requireZone(parsed.data.zoneId);
    const transfer = await transferKwh({
      fromUserId: user.id,
      toUsername: parsed.data.toUsername,
      zoneId: zone.id,
      amountKwh: parsed.data.amountKwh,
      note: parsed.data.note ?? null,
      requireConfirmation: parsed.data.requireConfirmation,
    });
    return ok({ transfer }, 201);
  } catch (err) {
    return domainError(err);
  }
}

export async function GET(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const zoneParam = new URL(req.url).searchParams.get("zoneId");
  if (!zoneParam) return domainError(new Error("zoneId is required"));

  try {
    const zone = await requireZone(zoneParam);
    return ok({ open: transfersOpen(), allowance: await transferAllowance(user.id, zone.id) });
  } catch (err) {
    return domainError(err);
  }
}
