// Cooperative service — ТЗ §2 ("Кооператив — владелец накопителей"), §7,
// §16.10 (income pro rata, one member one vote), §24.1 (KYC gates use of
// received kWh), US-10 and US-21.
//
// The arithmetic lives in coop.ts; this layer is persistence, gating and the
// audit trail. Every state change a member can see in the app — joining,
// share changes, a payout, a closed vote — is written to AuditLog per §16.11.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Db } from "./audit";
import { writeAudit } from "./audit";
import { num } from "./decimal";
import { distributeIncome, sharePercent, tallyVotes, type OptionTally } from "./coop";
import { roundMoney } from "./precision";

export interface CreateCooperativeInput {
  companyId: string;
  zoneId: string;
  name: string;
  actorUserId: string;
}

export async function createCooperative(input: CreateCooperativeInput, db: Db = prisma) {
  const company = await db.company.findUnique({ where: { id: input.companyId } });
  if (!company) throw new Error(`Company not found: ${input.companyId}`);
  if (company.type !== "COOPERATIVE") {
    throw new Error(`Company ${company.legalName} is not of type COOPERATIVE`);
  }

  const coop = await db.cooperative.create({
    data: { companyId: input.companyId, zoneId: input.zoneId, name: input.name },
  });
  await writeAudit(db, {
    actor: input.actorUserId,
    entity: "Cooperative",
    entityId: coop.id,
    action: "coop.create",
    after: { name: coop.name, zoneId: coop.zoneId },
  });
  return coop;
}

export interface AddMemberInput {
  coopId: string;
  userId: string;
  shares: number;
  actorUserId: string;
}

/**
 * Admit a member, or return the existing membership unchanged. Shares are
 * never silently overwritten here — a stake change goes through
 * setMemberShares so it leaves an audit entry with its before/after.
 */
export async function addMember(input: AddMemberInput, db: Db = prisma) {
  const existing = await db.coopMember.findUnique({
    where: { coopId_userId: { coopId: input.coopId, userId: input.userId } },
  });
  if (existing) return existing;

  const shares = Math.max(0, Math.trunc(input.shares));
  const member = await db.coopMember.create({
    data: { coopId: input.coopId, userId: input.userId, shares },
  });
  await writeAudit(db, {
    actor: input.actorUserId,
    entity: "CoopMember",
    entityId: member.id,
    action: "coop.member.add",
    after: { userId: member.userId, shares: member.shares, status: member.status },
  });
  return member;
}

/** §24.1 — KYC is what turns a pending membership into a voting, trading one. */
export async function verifyMemberKyc(
  input: { memberId: string; actorUserId: string },
  db: Db = prisma,
) {
  const before = await db.coopMember.findUniqueOrThrow({ where: { id: input.memberId } });
  const member = await db.coopMember.update({
    where: { id: input.memberId },
    data: { status: "ACTIVE", kycVerifiedAt: new Date() },
  });
  await writeAudit(db, {
    actor: input.actorUserId,
    entity: "CoopMember",
    entityId: member.id,
    action: "coop.member.kyc",
    before: { status: before.status },
    after: { status: member.status },
  });
  return member;
}

export async function setMemberShares(
  input: { memberId: string; shares: number; actorUserId: string },
  db: Db = prisma,
) {
  const shares = Math.max(0, Math.trunc(input.shares));
  const before = await db.coopMember.findUniqueOrThrow({ where: { id: input.memberId } });
  const member = await db.coopMember.update({
    where: { id: input.memberId },
    data: { shares },
  });
  await writeAudit(db, {
    actor: input.actorUserId,
    entity: "CoopMember",
    entityId: member.id,
    action: "coop.member.shares",
    before: { shares: before.shares },
    after: { shares: member.shares },
  });
  return member;
}

export interface RecordPayoutInput {
  coopId: string;
  periodStart: Date;
  periodEnd: Date;
  incomeAmount: number;
  actorUserId: string;
  note?: string;
}

/**
 * Close an income period: split it across the active members by shares and
 * store the split. Stored rather than recomputed, so a later share change
 * cannot rewrite what a member was already told they earned (US-10
 * "история выплат").
 */
export async function recordPayout(input: RecordPayoutInput, db: Db = prisma) {
  const duplicate = await db.coopPayout.findUnique({
    where: {
      coopId_periodStart_periodEnd: {
        coopId: input.coopId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      },
    },
  });
  if (duplicate) {
    throw new Error(
      `Cooperative ${input.coopId} already has a payout for ${input.periodStart.toISOString()}..${input.periodEnd.toISOString()}`,
    );
  }

  const coop = await db.cooperative.findUniqueOrThrow({
    where: { id: input.coopId },
    include: { zone: { select: { currency: true } } },
  });
  const members = await db.coopMember.findMany({
    where: { coopId: input.coopId, status: "ACTIVE" },
    orderBy: { joinedAt: "asc" },
  });

  const allocations = distributeIncome(
    input.incomeAmount,
    members.map((m) => ({ memberId: m.id, shares: m.shares })),
  );
  const totalShares = members.reduce((sum, m) => sum + Math.max(0, m.shares), 0);

  const payout = await db.coopPayout.create({
    data: {
      coopId: input.coopId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      incomeAmount: new Prisma.Decimal(roundMoney(input.incomeAmount)),
      currency: coop.zone.currency,
      totalShares,
      note: input.note,
      allocations: {
        create: allocations.map((a) => ({
          memberId: a.memberId,
          shares: a.shares,
          amount: new Prisma.Decimal(a.amount),
        })),
      },
    },
  });

  await writeAudit(db, {
    actor: input.actorUserId,
    entity: "CoopPayout",
    entityId: payout.id,
    action: "coop.payout.record",
    after: {
      incomeAmount: roundMoney(input.incomeAmount),
      totalShares,
      allocations: allocations.map((a) => ({ memberId: a.memberId, amount: a.amount })),
    },
  });
  return payout;
}

export interface MemberPayoutView {
  payoutId: string;
  periodStart: Date;
  periodEnd: Date;
  shares: number;
  amount: number;
  currency: string;
  paidAt: Date | null;
}

export interface MemberSharesView {
  coopId: string;
  coopName: string;
  memberId: string;
  status: string;
  shares: number;
  totalShares: number;
  sharePercent: number | null;
  currency: string;
  /** Sum of every allocation ever made to this member. */
  incomeToDate: number;
  /** Allocations not yet marked paid out. */
  pendingIncome: number;
  payouts: MemberPayoutView[];
}

/** GET /v1/coop/{id}/shares/me — US-10. null when the user is not a member. */
export async function readMemberShares(
  coopId: string,
  userId: string,
  db: Db = prisma,
): Promise<MemberSharesView | null> {
  const member = await db.coopMember.findUnique({
    where: { coopId_userId: { coopId, userId } },
    include: {
      coop: { include: { zone: { select: { currency: true } } } },
      allocations: {
        include: { payout: true },
        orderBy: { payout: { periodStart: "desc" } },
      },
    },
  });
  if (!member) return null;

  const activeMembers = await db.coopMember.findMany({
    where: { coopId, status: "ACTIVE" },
    select: { shares: true },
  });
  const totalShares = activeMembers.reduce((sum, m) => sum + Math.max(0, m.shares), 0);

  const payouts: MemberPayoutView[] = member.allocations.map((a) => ({
    payoutId: a.payoutId,
    periodStart: a.payout.periodStart,
    periodEnd: a.payout.periodEnd,
    shares: a.shares,
    amount: num(a.amount),
    currency: a.payout.currency,
    paidAt: a.paidAt,
  }));

  return {
    coopId,
    coopName: member.coop.name,
    memberId: member.id,
    status: member.status,
    shares: member.shares,
    totalShares,
    sharePercent: sharePercent(member.shares, totalShares),
    currency: member.coop.zone.currency,
    incomeToDate: roundMoney(payouts.reduce((sum, p) => sum + p.amount, 0)),
    pendingIncome: roundMoney(
      payouts.filter((p) => p.paidAt == null).reduce((sum, p) => sum + p.amount, 0),
    ),
    payouts,
  };
}

export interface OpenVoteInput {
  coopId: string;
  question: string;
  options: string[];
  closesAt: Date;
  actorUserId: string;
}

export async function openVote(input: OpenVoteInput, db: Db = prisma) {
  const options = input.options.map((o) => o.trim()).filter((o) => o.length > 0);
  if (options.length < 2) throw new Error("A vote needs at least two options");

  const vote = await db.coopVote.create({
    data: {
      coopId: input.coopId,
      question: input.question,
      options,
      closesAt: input.closesAt,
    },
  });
  await writeAudit(db, {
    actor: input.actorUserId,
    entity: "CoopVote",
    entityId: vote.id,
    action: "coop.vote.open",
    after: { question: vote.question, options, closesAt: vote.closesAt },
  });
  return vote;
}

/**
 * Cast or change a ballot. One member, one vote: the (voteId, memberId)
 * unique constraint means a second ballot updates the first rather than
 * adding a second voice, and shares are deliberately not consulted.
 */
export async function castBallot(
  input: { voteId: string; userId: string; option: string },
  db: Db = prisma,
) {
  const vote = await db.coopVote.findUniqueOrThrow({ where: { id: input.voteId } });
  if (vote.status === "CLOSED") throw new Error(`Vote ${vote.id} is closed`);
  if (vote.closesAt.getTime() <= Date.now()) throw new Error(`Vote ${vote.id} is closed`);
  if (!vote.options.includes(input.option)) {
    throw new Error(`"${input.option}" is not an option on this vote`);
  }

  const member = await db.coopMember.findUnique({
    where: { coopId_userId: { coopId: vote.coopId, userId: input.userId } },
  });
  if (!member) throw new Error("Only members of the cooperative may vote");
  if (member.status !== "ACTIVE") {
    throw new Error("Only KYC-verified (ACTIVE) members may vote");
  }

  return db.coopBallot.upsert({
    where: { voteId_memberId: { voteId: vote.id, memberId: member.id } },
    update: { option: input.option },
    create: { voteId: vote.id, memberId: member.id, option: input.option },
  });
}

export interface VoteOutcome {
  voteId: string;
  tallies: OptionTally[];
  totalVotes: number;
  winner: string | null;
}

/** US-21 — "результаты видны после закрытия голосования". */
export async function closeVote(
  input: { voteId: string; actorUserId: string },
  db: Db = prisma,
): Promise<VoteOutcome> {
  const vote = await db.coopVote.findUniqueOrThrow({
    where: { id: input.voteId },
    include: { ballots: { orderBy: { castAt: "asc" } } },
  });

  const result = tallyVotes(
    vote.ballots.map((b) => ({ memberId: b.memberId, option: b.option })),
    vote.options,
  );

  await db.coopVote.update({
    where: { id: vote.id },
    data: { status: "CLOSED", closedAt: new Date(), winner: result.winner },
  });
  await writeAudit(db, {
    actor: input.actorUserId,
    entity: "CoopVote",
    entityId: vote.id,
    action: "coop.vote.close",
    after: { tallies: result.tallies, totalVotes: result.totalVotes, winner: result.winner },
  });

  return { voteId: vote.id, ...result };
}

/** Read a closed vote's published result; null while it is still open. */
export async function readVoteOutcome(voteId: string, db: Db = prisma): Promise<VoteOutcome | null> {
  const vote = await db.coopVote.findUniqueOrThrow({
    where: { id: voteId },
    include: { ballots: true },
  });
  if (vote.status !== "CLOSED") return null;
  const result = tallyVotes(
    vote.ballots.map((b) => ({ memberId: b.memberId, option: b.option })),
    vote.options,
  );
  return { voteId: vote.id, ...result };
}
