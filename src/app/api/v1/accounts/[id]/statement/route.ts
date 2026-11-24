// GET /v1/accounts/{id}/statement — ТЗ §19.
import type { NextRequest } from "next/server";
import { domainError, forbidden, notFound, ok, sessionUser, unauthorized } from "@/lib/exchange/api";
import { readStatement } from "@/lib/exchange/settlement-service";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const account = await prisma.settlementAccount.findUnique({
    where: { id },
    include: { company: { select: { ownerUserId: true } } },
  });
  if (!account) return notFound("Account not found");
  const owns = account.userId === user.id || account.company?.ownerUserId === user.id;
  if (!owns && user.role !== "ADMIN") return forbidden();

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  try {
    return ok({
      statement: await readStatement(id, {
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        limit: Number(url.searchParams.get("limit") ?? 100) || 100,
      }),
    });
  } catch (err) {
    return domainError(err);
  }
}
