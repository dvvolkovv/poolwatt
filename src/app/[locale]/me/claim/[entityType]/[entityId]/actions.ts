"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { matchesDomain } from "@/lib/claim/domain-match";
import { generateClaimToken } from "@/lib/claim/token";
import { sendClaimVerificationEmail } from "@/lib/resend-claim";
import type { ClaimEntityType } from "@prisma/client";

export type SubmitClaimInput = {
  entityType: ClaimEntityType;
  entityId: string;
  email: string;
};

export type SubmitClaimResult = {
  ok: boolean;
  fieldErrors?: Record<string, string>;
  formError?: string;
};

const TOKEN_TTL_MS = 30 * 60 * 1000;

export async function submitClaim(input: SubmitClaimInput): Promise<SubmitClaimResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, formError: "Not authenticated." };
  }

  let entity: { displayName: string; website: string | null; claimedById: string | null } | null = null;
  if (input.entityType === "PRODUCER") {
    const producer = await prisma.producer.findUnique({
      where: { id: input.entityId },
      include: { profile: true },
    });
    if (producer) {
      entity = {
        displayName: producer.displayName,
        website: producer.profile?.website ?? null,
        claimedById: producer.claimedById,
      };
    }
  } else if (input.entityType === "CHARGER_OPERATOR") {
    const op = await prisma.chargerOperator.findUnique({
      where: { id: input.entityId },
      select: { displayName: true, websiteUrl: true, claimedById: true },
    });
    if (op) {
      entity = {
        displayName: op.displayName,
        website: op.websiteUrl,
        claimedById: op.claimedById,
      };
    }
  } else {
    return { ok: false, formError: "Unsupported entity type." };
  }

  if (!entity) return { ok: false, formError: "Entity not found." };
  if (entity.claimedById) return { ok: false, formError: "Already claimed." };

  const website = entity.website;
  if (!matchesDomain(input.email, website)) {
    return { ok: false, fieldErrors: { email: "Email must match the company's website domain." } };
  }

  const token = generateClaimToken();
  await prisma.claimToken.create({
    data: {
      token,
      entityType: input.entityType,
      entityId: input.entityId,
      email: input.email,
      userId: session.user.id,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });

  await sendClaimVerificationEmail(input.email, token, entity.displayName);
  return { ok: true };
}
