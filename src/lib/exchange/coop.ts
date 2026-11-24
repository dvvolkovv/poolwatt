// Cooperative economics — ТЗ §16.10 ("доход кооператива делится
// пропорционально паям; голосование — один член, один голос"), US-10 and
// US-21.
//
// Two rules, both deliberately kept as pure arithmetic so the service layer
// can apply them to a payout period or to a closed vote without re-deriving
// them: money splits pro rata by shares and must stay whole to the cent, and
// votes count per member — never per share, so a large stake cannot outvote
// the cooperative.

import { roundMoney } from "./precision";

export interface MemberShares {
  memberId: string;
  shares: number;
}

export interface IncomeAllocation extends MemberShares {
  /** Member's cut of the period income, in fiat minor units. */
  amount: number;
}

/**
 * Split `amount` across members in proportion to their shares.
 *
 * The naive `amount * shares / total` rounds independently per member and so
 * pays out more or less than came in. Here every member gets their floored
 * cent share and the remaining cents go to the largest fractional remainders
 * (ties broken by share count, then by id, so the result is deterministic and
 * reproducible from the AuditLog).
 */
export function distributeIncome(
  amount: number,
  members: MemberShares[],
): IncomeAllocation[] {
  const zeroed = members.map((m) => ({ ...m, amount: 0 }));
  const totalShares = members.reduce((sum, m) => sum + Math.max(0, m.shares), 0);
  if (!(amount > 0) || totalShares <= 0) return zeroed;

  const cents = Math.round(roundMoney(amount) * 100);
  const exact = members.map((m, index) => {
    const share = Math.max(0, m.shares);
    const value = (cents * share) / totalShares;
    const floored = Math.floor(value);
    return { index, floored, remainder: value - floored, shares: share };
  });

  let left = cents - exact.reduce((sum, row) => sum + row.floored, 0);
  const byRemainder = [...exact].sort(
    (a, b) =>
      b.remainder - a.remainder ||
      b.shares - a.shares ||
      members[a.index].memberId.localeCompare(members[b.index].memberId),
  );
  for (const row of byRemainder) {
    if (left <= 0) break;
    if (row.shares <= 0) continue;
    row.floored += 1;
    left -= 1;
  }

  for (const row of exact) {
    zeroed[row.index].amount = roundMoney(row.floored / 100);
  }
  return zeroed;
}

/** Member's stake in percent, or null when no shares are issued (US-10). */
export function sharePercent(shares: number, totalShares: number): number | null {
  if (!(totalShares > 0)) return null;
  return roundMoney((Math.max(0, shares) * 100) / totalShares);
}

export interface Ballot {
  memberId: string;
  option: string;
}

export interface OptionTally {
  option: string;
  votes: number;
}

export interface VoteResult {
  tallies: OptionTally[];
  totalVotes: number;
  /** null on a tie or when nobody voted — US-21 shows results, not a decision. */
  winner: string | null;
}

/**
 * Count a closed vote. One member, one vote: a member who voted twice counts
 * once (their last ballot wins, which is how a "change my vote" UI behaves),
 * and a ballot for an option not on the paper is discarded rather than
 * silently creating a write-in option.
 */
export function tallyVotes(ballots: Ballot[], options: string[]): VoteResult {
  const valid = new Set(options);
  const lastByMember = new Map<string, string>();
  for (const ballot of ballots) {
    if (!valid.has(ballot.option)) continue;
    lastByMember.set(ballot.memberId, ballot.option);
  }

  const counts = new Map<string, number>(options.map((option) => [option, 0]));
  for (const option of lastByMember.values()) {
    counts.set(option, (counts.get(option) ?? 0) + 1);
  }

  const tallies = options.map((option) => ({ option, votes: counts.get(option) ?? 0 }));
  const totalVotes = lastByMember.size;
  const top = Math.max(0, ...tallies.map((t) => t.votes));
  const leaders = tallies.filter((t) => t.votes === top);
  return {
    tallies,
    totalVotes,
    winner: top > 0 && leaders.length === 1 ? leaders[0].option : null,
  };
}
