// §52 last row — "Комиссия для своих субпартнёров (если партнёр — сеть с
// франчайзи)".
//
// A head network takes a percentage of what is earned at a franchisee's
// points. §53 puts the platform's own commission first, so the franchise fee
// is taken from what is left — otherwise two percentages of the same gross
// could add up past it.
//
// Both sides read the same agreement row, which is what makes §54's "расчёт
// комиссий … с отражением в облачной бухгалтерии обеих сторон" one number
// rather than two that might disagree.

import { prisma } from "@/lib/prisma";
import { num } from "@/lib/exchange/decimal";
import { ceilMoney, roundMoney } from "@/lib/exchange/precision";
import { recordPricingChange } from "./pricing-service";

export class SubpartnerError extends Error {}

export interface AgreementInput {
  headId: string;
  subId: string;
  actorId: string;
  chargeFeePct: number;
  active?: boolean;
  note?: string | null;
}

export async function saveSubpartnerAgreement(input: AgreementInput) {
  if (input.headId === input.subId) {
    throw new SubpartnerError("A network cannot take a commission from itself");
  }
  if (
    !Number.isFinite(input.chargeFeePct) ||
    input.chargeFeePct < 0 ||
    input.chargeFeePct > 100
  ) {
    throw new SubpartnerError(
      `The commission has to be a percentage between 0 and 100, got ${input.chargeFeePct}`,
    );
  }

  const [head, sub] = await Promise.all([
    prisma.chargerOperator.findUnique({
      where: { id: input.headId },
      select: { id: true, claimedById: true },
    }),
    prisma.chargerOperator.findUnique({ where: { id: input.subId }, select: { id: true } }),
  ]);
  if (!head) throw new SubpartnerError("No such head network");
  if (!sub) throw new SubpartnerError("No such franchisee network");
  // The head network writes the agreement; the franchisee can only read it.
  if (!head.claimedById || head.claimedById !== input.actorId) {
    throw new SubpartnerError("This network belongs to somebody else");
  }

  return prisma.$transaction(async (tx) => {
    const row = await tx.subpartnerAgreement.upsert({
      where: { headId_subId: { headId: input.headId, subId: input.subId } },
      update: {
        chargeFeePct: input.chargeFeePct,
        active: input.active ?? true,
        note: input.note?.trim() || null,
        activeFrom: new Date(),
      },
      create: {
        headId: input.headId,
        subId: input.subId,
        chargeFeePct: input.chargeFeePct,
        active: input.active ?? true,
        note: input.note?.trim() || null,
      },
    });

    // §54 — a franchise fee is a tariff, so a change to it is versioned like
    // every other. Kept against the franchisee: that is whose revenue it
    // comes out of, and whose history has to explain it.
    await recordPricingChange(tx, {
      scope: "SUBPARTNER_FEE",
      scopeId: input.subId,
      operatorId: input.headId,
      params: {
        headId: input.headId,
        subId: input.subId,
        chargeFeePct: input.chargeFeePct,
        active: input.active ?? true,
      },
      actorId: input.actorId,
      note: input.note ?? null,
    });

    return row;
  });
}

/**
 * The franchise commission that applies at one point, and who takes it.
 *
 * Read on the charging path, so it is one query on the point's own operator.
 */
export async function subpartnerFeePctFor(
  pointId: string | null,
): Promise<{ pct: number; headId: string | null }> {
  if (!pointId) return { pct: 0, headId: null };

  const point = await prisma.acceptancePoint.findUnique({
    where: { id: pointId },
    select: { operatorId: true },
  });
  if (!point) return { pct: 0, headId: null };

  const agreement = await prisma.subpartnerAgreement.findFirst({
    where: { subId: point.operatorId, active: true },
    orderBy: { activeFrom: "desc" },
    select: { headId: true, chargeFeePct: true },
  });
  if (!agreement) return { pct: 0, headId: null };

  return { pct: num(agreement.chargeFeePct), headId: agreement.headId };
}

export interface RevenueSplit {
  platformFee: number;
  subpartnerFee: number;
  /** What the network whose point it is actually keeps. */
  partnerNet: number;
}

/**
 * How one session's money divides — §53's order, §54's arithmetic.
 *
 * Both commissions round up to the cent, the way `fees.ts` does, and the
 * partner keeps the remainder: that is the only way the three shares add back
 * up to what the driver paid.
 */
export function splitSessionRevenue(args: {
  amountFiat: number;
  /** A rate, when the commission still has to be worked out. */
  platformFeePct?: number;
  /**
   * The commission the platform has already taken, in money. A charging
   * session is served by a market order that paid its own commission, so the
   * amount is known exactly and a second percentage of the same money would
   * be charging it twice.
   */
  platformFeeFiat?: number;
  subpartnerFeePct: number;
}): RevenueSplit {
  const gross = roundMoney(args.amountFiat);
  if (!(gross > 0)) return { platformFee: 0, subpartnerFee: 0, partnerNet: 0 };

  const platformFee =
    args.platformFeeFiat != null
      ? Math.min(gross, roundMoney(Math.max(0, args.platformFeeFiat)))
      : args.platformFeePct && args.platformFeePct > 0
        ? ceilMoney((gross * args.platformFeePct) / 100)
        : 0;
  const afterPlatform = roundMoney(gross - platformFee);
  const subpartnerFee =
    args.subpartnerFeePct > 0 ? ceilMoney((afterPlatform * args.subpartnerFeePct) / 100) : 0;

  return {
    platformFee,
    subpartnerFee,
    partnerNet: roundMoney(afterPlatform - subpartnerFee),
  };
}

export interface SubpartnerRow {
  id: string;
  partnerName: string;
  partnerId: string;
  chargeFeePct: number;
  active: boolean;
  activeFrom: Date;
  note: string | null;
}

/** What a network sees: its franchisees, and whose franchisee it is. */
export async function readSubpartners(
  operatorId: string,
): Promise<{ asHead: SubpartnerRow[]; asSub: SubpartnerRow[] }> {
  const [asHead, asSub] = await Promise.all([
    prisma.subpartnerAgreement.findMany({
      where: { headId: operatorId },
      orderBy: { activeFrom: "desc" },
      include: { sub: { select: { id: true, displayName: true } } },
    }),
    prisma.subpartnerAgreement.findMany({
      where: { subId: operatorId },
      orderBy: { activeFrom: "desc" },
      include: { head: { select: { id: true, displayName: true } } },
    }),
  ]);

  return {
    asHead: asHead.map((a) => ({
      id: a.id,
      partnerName: a.sub.displayName,
      partnerId: a.sub.id,
      chargeFeePct: num(a.chargeFeePct),
      active: a.active,
      activeFrom: a.activeFrom,
      note: a.note,
    })),
    asSub: asSub.map((a) => ({
      id: a.id,
      partnerName: a.head.displayName,
      partnerId: a.head.id,
      chargeFeePct: num(a.chargeFeePct),
      active: a.active,
      activeFrom: a.activeFrom,
      note: a.note,
    })),
  };
}
