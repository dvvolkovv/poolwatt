// POST /v1/companies — ТЗ §15, US-01.
import type { NextRequest } from "next/server";
import { z } from "zod";
import { domainError, ok, parseBody, sessionUser, unauthorized } from "@/lib/exchange/api";
import { publishableIban } from "@/lib/exchange/gates";
import { createCompany } from "@/lib/exchange/listing-service";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  legalName: z.string().min(2).max(200),
  country: z.string().length(2),
  regNumber: z.string().min(1).max(50),
  vatNumber: z.string().max(50).optional().nullable(),
  type: z.enum(["PRODUCER", "WHOLESALE", "COOPERATIVE", "OPERATOR"]),
  website: z.string().url().max(300).optional().nullable(),
  contactName: z.string().max(120).optional().nullable(),
  contactEmail: z.string().email().max(200).optional().nullable(),
  contactPhone: z.string().max(40).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const parsed = await parseBody(req, bodySchema);
  if ("response" in parsed) return parsed.response;

  try {
    const company = await createCompany({ ...parsed.data, ownerUserId: user.id });
    return ok(
      {
        company: {
          id: company.id,
          legalName: company.legalName,
          country: company.country,
          type: company.type,
          kybStatus: company.kybStatus,
        },
      },
      201,
    );
  } catch (err) {
    return domainError(err);
  }
}

export async function GET() {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const companies = await prisma.company.findMany({
    where: { ownerUserId: user.id },
    include: {
      settlementAccount: { select: { id: true, iban: true, currency: true, status: true } },
      _count: { select: { assets: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return ok({
    companies: companies.map((c) => ({
      id: c.id,
      legalName: c.legalName,
      country: c.country,
      type: c.type,
      kybStatus: c.kybStatus,
      assets: c._count.assets,
      account: c.settlementAccount && {
        ...c.settlementAccount,
        iban: publishableIban(c.settlementAccount.iban),
      },
    })),
  });
}
