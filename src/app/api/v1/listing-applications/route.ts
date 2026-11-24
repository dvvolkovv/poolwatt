// POST /v1/listing-applications — ТЗ §15, US-01.
import type { NextRequest } from "next/server";
import { z } from "zod";
import { domainError, forbidden, ok, parseBody, sessionUser, unauthorized } from "@/lib/exchange/api";
import { MAX_DOCUMENT_BYTES, submitApplication } from "@/lib/exchange/listing-service";
import { sendListingSubmittedToAdmin } from "@/lib/resend-listing";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  companyId: z.string().min(1),
  documents: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        url: z.string().url().max(1000),
        bytes: z.number().int().positive().max(MAX_DOCUMENT_BYTES),
        mime: z.enum(["application/pdf", "image/jpeg", "image/png"]),
      }),
    )
    .min(1)
    .max(30),
});

export async function POST(req: NextRequest) {
  const user = await sessionUser();
  if (!user) return unauthorized();

  const parsed = await parseBody(req, bodySchema);
  if ("response" in parsed) return parsed.response;

  const company = await prisma.company.findUnique({ where: { id: parsed.data.companyId } });
  if (!company) return domainError(new Error("Company not found"));
  if (company.ownerUserId !== user.id && user.role !== "ADMIN") return forbidden();

  try {
    const application = await submitApplication({
      companyId: parsed.data.companyId,
      documents: parsed.data.documents,
      actorUserId: user.id,
    });
    await sendListingSubmittedToAdmin({
      applicationId: application.id,
      legalName: company.legalName,
      country: company.country,
      type: company.type,
      documents: parsed.data.documents.length,
    });
    return ok(
      {
        application: {
          id: application.id,
          status: application.status,
          submittedAt: application.submittedAt?.toISOString() ?? null,
        },
      },
      201,
    );
  } catch (err) {
    return domainError(err);
  }
}
