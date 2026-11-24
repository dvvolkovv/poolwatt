// §20 "Статусы пользователя" — the badge shown on the main screen and in the
// profile.
//
// The tiers are cumulative, so the answer is the highest one reached. KYC
// lives on cooperative membership, the same place `membership.ts` reads it
// from: there is no platform-wide KYC until a provider exists (US-16).

import { CoopMemberStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Db } from "./audit";

export type UserStatus = "GUEST" | "CONSUMER" | "PROSUMER" | "COOP_MEMBER";

export async function readUserStatus(userId: string, db: Db = prisma): Promise<UserStatus> {
  const [withShares, verified, asset] = await Promise.all([
    db.coopMember.findFirst({
      where: {
        userId,
        status: CoopMemberStatus.ACTIVE,
        kycVerifiedAt: { not: null },
        shares: { gt: 0 },
      },
      select: { id: true },
    }),
    db.coopMember.findFirst({
      where: { userId, status: CoopMemberStatus.ACTIVE, kycVerifiedAt: { not: null } },
      select: { id: true },
    }),
    db.asset.findFirst({
      where: { company: { ownerUserId: userId } },
      select: { id: true },
    }),
  ]);

  if (withShares) return "COOP_MEMBER";
  if (asset) return "PROSUMER";
  if (verified) return "CONSUMER";
  return "GUEST";
}
