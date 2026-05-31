"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { ClaimEntityType } from "@prisma/client";

export type VerifyClaimInput = {
  entityType: ClaimEntityType;
  entityId: string;
  code: string;
};

export type VerifyClaimResult = { ok: boolean; formError?: string };

export async function verifyClaim(input: VerifyClaimInput): Promise<VerifyClaimResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, formError: "Not authenticated." };
  if (input.entityType !== "PRODUCER") return { ok: false, formError: "Unsupported entity type." };

  const token = await prisma.claimToken.findFirst({
    where: {
      token: input.code,
      entityType: input.entityType,
      entityId: input.entityId,
      userId: session.user.id,
    },
  });

  if (!token) return { ok: false, formError: "Invalid code." };
  if (token.consumedAt) return { ok: false, formError: "Code already used." };
  if (token.expiresAt < new Date()) return { ok: false, formError: "Code expired." };

  const producer = await prisma.producer.findUnique({ where: { id: input.entityId } });
  if (!producer) return { ok: false, formError: "Producer not found." };
  if (producer.claimedById) return { ok: false, formError: "Already claimed by someone else." };

  await prisma.$transaction([
    prisma.producer.update({
      where: { id: input.entityId },
      data: { claimedById: session.user.id, claimedAt: new Date() },
    }),
    prisma.claimToken.update({
      where: { id: token.id },
      data: { consumedAt: new Date() },
    }),
  ]);

  return { ok: true };
}
