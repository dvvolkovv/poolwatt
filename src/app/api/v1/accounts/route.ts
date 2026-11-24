// POST /v1/accounts — ТЗ §19 US-13 (company IBAN) and §21 (personal IBAN).
// GET  /v1/accounts — the caller's accounts.
import type { NextRequest } from "next/server";
import { z } from "zod";
import { domainError, forbidden, ok, parseBody, sessionUser, unauthorized } from "@/lib/exchange/api";
import { num } from "@/lib/exchange/decimal";
import { publishableIban } from "@/lib/exchange/gates";
import { openCompanyAccount, openUserAccount } from "@/lib/exchange/settlement-service";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  /** Omit to open the caller's personal account. */
  companyId: z.string().min(1).optional().nullable(),
  currency: z.string().length(3).optional(),
});

export async function POST(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const parsed = await parseBody(req, bodySchema);
  if ("response" in parsed) return parsed.response;
  const currency = (parsed.data.currency ?? "EUR").toUpperCase();

  try {
    if (parsed.data.companyId) {
      const company = await prisma.company.findUnique({ where: { id: parsed.data.companyId } });
      if (!company) return domainError(new Error("Company not found"));
      if (company.ownerUserId !== user.id && user.role !== "ADMIN") return forbidden();
      // US-13 — the IBAN only opens once KYB has actually passed.
      if (company.kybStatus !== "APPROVED") {
        return domainError(new Error("KYB must be approved before an account can be opened"));
      }
      const account = await openCompanyAccount(prisma, company.id, currency);
      return ok({ account: { id: account.id, iban: account.iban, currency: account.currency } }, 201);
    }

    const account = await openUserAccount(prisma, user.id, currency);
    return ok({ account: { id: account.id, iban: account.iban, currency: account.currency } }, 201);
  } catch (err) {
    return domainError(err);
  }
}

export async function GET() {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const accounts = await prisma.settlementAccount.findMany({
    where: { OR: [{ userId: user.id }, { company: { ownerUserId: user.id } }] },
    include: { company: { select: { id: true, legalName: true } } },
  });

  return ok({
    accounts: accounts.map((a) => ({
      id: a.id,
      iban: publishableIban(a.iban),
      currency: a.currency,
      balance: num(a.balance),
      status: a.status,
      company: a.company,
      openedAt: a.openedAt.toISOString(),
    })),
  });
}
