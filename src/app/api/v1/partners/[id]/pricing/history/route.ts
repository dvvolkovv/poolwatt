// GET /v1/partners/{id}/pricing/history — ТЗ §54.

import type { NextRequest } from "next/server";
import { fail, ok, sessionUser, unauthorized } from "@/lib/exchange/api";
import { prisma } from "@/lib/prisma";
import { readNetworkPricing } from "@/lib/pricing/pricing-service";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await sessionUser();
  if (!user) return unauthorized();
  const { id } = await params;

  const operator = await prisma.chargerOperator.findUnique({
    where: { id },
    select: { claimedById: true },
  });
  if (!operator || (operator.claimedById !== user.id && user.role !== "ADMIN")) {
    return fail("Not found", 404);
  }

  const rules = await readNetworkPricing(id);
  return ok({
    history: rules.map((r) => ({
      version: r.version,
      scope: r.scope,
      scopeId: r.scopeId,
      params: r.params,
      activeFrom: r.activeFrom.toISOString(),
      createdById: r.createdById,
      note: r.note,
    })),
  });
}
