// KYC lives on cooperative membership: there is no platform-wide KYC yet.

import { CoopMemberStatus, type Prisma } from "@prisma/client";
import type { Db } from "./audit";

const verified = (userId: string): Prisma.CoopMemberWhereInput => ({
  userId,
  status: CoopMemberStatus.ACTIVE,
  kycVerifiedAt: { not: null },
});

export async function hasVerifiedKyc(db: Db, userId: string): Promise<boolean> {
  return (await db.coopMember.findFirst({ where: verified(userId), select: { id: true } })) !== null;
}

/** §24.1 — both are KYC-verified members of one cooperative in this zone. */
export async function shareCooperative(
  db: Db,
  zoneId: string,
  userA: string,
  userB: string,
): Promise<boolean> {
  const coop = await db.cooperative.findFirst({
    where: {
      zoneId,
      AND: [{ members: { some: verified(userA) } }, { members: { some: verified(userB) } }],
    },
    select: { id: true },
  });
  return coop !== null;
}
