import { describe, it, expect } from "vitest";
import { distributeIncome, sharePercent, tallyVotes } from "./coop";

describe("distributeIncome — ТЗ §16.10 'доход кооператива делится пропорционально паям'", () => {
  it("splits income pro rata by shares", () => {
    const out = distributeIncome(100, [
      { memberId: "a", shares: 3 },
      { memberId: "b", shares: 1 },
    ]);
    expect(out).toEqual([
      { memberId: "a", shares: 3, amount: 75 },
      { memberId: "b", shares: 1, amount: 25 },
    ]);
  });

  it("never creates or destroys money when the split is not exact", () => {
    const out = distributeIncome(100, [
      { memberId: "a", shares: 1 },
      { memberId: "b", shares: 1 },
      { memberId: "c", shares: 1 },
    ]);
    const total = out.reduce((sum, row) => sum + row.amount, 0);
    expect(Math.round(total * 100) / 100).toBe(100);
    expect(out.map((row) => row.amount).sort()).toEqual([33.33, 33.33, 33.34]);
  });

  it("gives the leftover cents to the largest fractional remainders", () => {
    const out = distributeIncome(10, [
      { memberId: "big", shares: 2 },
      { memberId: "small", shares: 1 },
    ]);
    expect(out).toEqual([
      { memberId: "big", shares: 2, amount: 6.67 },
      { memberId: "small", shares: 1, amount: 3.33 },
    ]);
  });

  it("allocates nothing to members without shares", () => {
    const out = distributeIncome(50, [
      { memberId: "a", shares: 5 },
      { memberId: "b", shares: 0 },
      { memberId: "c", shares: -3 },
    ]);
    expect(out).toEqual([
      { memberId: "a", shares: 5, amount: 50 },
      { memberId: "b", shares: 0, amount: 0 },
      { memberId: "c", shares: -3, amount: 0 },
    ]);
  });

  it("allocates nothing when there are no shares at all", () => {
    expect(distributeIncome(100, [{ memberId: "a", shares: 0 }])).toEqual([
      { memberId: "a", shares: 0, amount: 0 },
    ]);
    expect(distributeIncome(100, [])).toEqual([]);
  });

  it("allocates nothing for a non-positive income", () => {
    const out = distributeIncome(0, [{ memberId: "a", shares: 1 }]);
    expect(out).toEqual([{ memberId: "a", shares: 1, amount: 0 }]);
    expect(distributeIncome(-10, [{ memberId: "a", shares: 1 }])).toEqual([
      { memberId: "a", shares: 1, amount: 0 },
    ]);
  });
});

describe("sharePercent — US-10 'количество паёв, доход за период'", () => {
  it("reports the member's stake in percent", () => {
    expect(sharePercent(25, 100)).toBe(25);
    expect(sharePercent(1, 3)).toBe(33.33);
  });

  it("has no answer when the cooperative has no shares issued", () => {
    expect(sharePercent(0, 0)).toBeNull();
    expect(sharePercent(5, -1)).toBeNull();
  });
});

describe("tallyVotes — ТЗ §16.10 'один член, один голос'", () => {
  it("counts one vote per member regardless of shares", () => {
    const result = tallyVotes(
      [
        { memberId: "a", option: "site-1" },
        { memberId: "b", option: "site-1" },
        { memberId: "c", option: "site-2" },
      ],
      ["site-1", "site-2"],
    );
    expect(result.tallies).toEqual([
      { option: "site-1", votes: 2 },
      { option: "site-2", votes: 1 },
    ]);
    expect(result.totalVotes).toBe(3);
    expect(result.winner).toBe("site-1");
  });

  it("keeps only a member's last ballot", () => {
    const result = tallyVotes(
      [
        { memberId: "a", option: "site-1" },
        { memberId: "a", option: "site-2" },
      ],
      ["site-1", "site-2"],
    );
    expect(result.totalVotes).toBe(1);
    expect(result.winner).toBe("site-2");
  });

  it("ignores ballots for options that are not on the paper", () => {
    const result = tallyVotes(
      [
        { memberId: "a", option: "site-1" },
        { memberId: "b", option: "write-in" },
      ],
      ["site-1", "site-2"],
    );
    expect(result.totalVotes).toBe(1);
    expect(result.tallies).toEqual([
      { option: "site-1", votes: 1 },
      { option: "site-2", votes: 0 },
    ]);
  });

  it("declares no winner on a tie or with no votes cast", () => {
    expect(
      tallyVotes(
        [
          { memberId: "a", option: "site-1" },
          { memberId: "b", option: "site-2" },
        ],
        ["site-1", "site-2"],
      ).winner,
    ).toBeNull();
    expect(tallyVotes([], ["site-1"]).winner).toBeNull();
  });
});
