import { describe, it, expect } from "vitest";
import { planIntervalRouting } from "./routing";

describe("planIntervalRouting — ТЗ §16.4", () => {
  it("fills cooperative storage before the aggregator", () => {
    const plan = planIntervalRouting(
      [{ id: "t1", amountKwh: 30 }],
      [{ assetId: "bank-1", freeKwh: 50 }],
    );
    expect(plan.toStorage).toEqual([{ tokenId: "t1", assetId: "bank-1", amountKwh: 30 }]);
    expect(plan.toAggregator).toEqual([]);
    expect(plan.remainingCapacity["bank-1"]).toBe(20);
  });

  it("splits a batch that overflows the free capacity", () => {
    const plan = planIntervalRouting(
      [{ id: "t1", amountKwh: 80 }],
      [{ assetId: "bank-1", freeKwh: 50 }],
    );
    expect(plan.toStorage).toEqual([{ tokenId: "t1", assetId: "bank-1", amountKwh: 50 }]);
    expect(plan.toAggregator).toEqual([{ tokenId: "t1", amountKwh: 30 }]);
    expect(plan.storedKwh).toBe(50);
    expect(plan.routedKwh).toBe(30);
  });

  it("walks through several storages in the order given", () => {
    const plan = planIntervalRouting(
      [{ id: "t1", amountKwh: 100 }],
      [
        { assetId: "bank-1", freeKwh: 30 },
        { assetId: "bank-2", freeKwh: 40 },
      ],
    );
    expect(plan.toStorage).toEqual([
      { tokenId: "t1", assetId: "bank-1", amountKwh: 30 },
      { tokenId: "t1", assetId: "bank-2", amountKwh: 40 },
    ]);
    expect(plan.toAggregator).toEqual([{ tokenId: "t1", amountKwh: 30 }]);
  });

  it("sends everything to the aggregator when no storage is free", () => {
    const plan = planIntervalRouting([{ id: "t1", amountKwh: 10 }], []);
    expect(plan.toStorage).toEqual([]);
    expect(plan.toAggregator).toEqual([{ tokenId: "t1", amountKwh: 10 }]);
  });

  it("treats a full storage as absent", () => {
    const plan = planIntervalRouting(
      [{ id: "t1", amountKwh: 10 }],
      [{ assetId: "bank-1", freeKwh: 0 }],
    );
    expect(plan.toAggregator).toEqual([{ tokenId: "t1", amountKwh: 10 }]);
  });

  it("never allocates into negative free capacity", () => {
    const plan = planIntervalRouting(
      [{ id: "t1", amountKwh: 10 }],
      [{ assetId: "over-full", freeKwh: -5 }],
    );
    expect(plan.toStorage).toEqual([]);
    expect(plan.remainingCapacity["over-full"]).toBe(0);
  });

  it("shares one storage across several batches until it is full", () => {
    const plan = planIntervalRouting(
      [
        { id: "t1", amountKwh: 6 },
        { id: "t2", amountKwh: 6 },
      ],
      [{ assetId: "bank-1", freeKwh: 10 }],
    );
    expect(plan.toStorage).toEqual([
      { tokenId: "t1", assetId: "bank-1", amountKwh: 6 },
      { tokenId: "t2", assetId: "bank-1", amountKwh: 4 },
    ]);
    expect(plan.toAggregator).toEqual([{ tokenId: "t2", amountKwh: 2 }]);
  });

  it("conserves every kWh it was handed", () => {
    const tokens = [
      { id: "t1", amountKwh: 13.333 },
      { id: "t2", amountKwh: 7.777 },
    ];
    const plan = planIntervalRouting(tokens, [{ assetId: "bank-1", freeKwh: 15.5 }]);
    const planned = [...plan.toStorage, ...plan.toAggregator].reduce(
      (sum, a) => sum + a.amountKwh,
      0,
    );
    expect(planned).toBeCloseTo(13.333 + 7.777, 3);
  });

  it("skips dust batches instead of creating zero-kWh allocations", () => {
    const plan = planIntervalRouting(
      [{ id: "dust", amountKwh: 0.0004 }],
      [{ assetId: "bank-1", freeKwh: 10 }],
    );
    expect(plan.toStorage).toEqual([]);
    expect(plan.toAggregator).toEqual([]);
  });

  it("sums several slots belonging to the same asset", () => {
    const plan = planIntervalRouting(
      [{ id: "t1", amountKwh: 10 }],
      [
        { assetId: "bank-1", freeKwh: 4 },
        { assetId: "bank-1", freeKwh: 3 },
      ],
    );
    expect(plan.toStorage).toEqual([{ tokenId: "t1", assetId: "bank-1", amountKwh: 7 }]);
    expect(plan.toAggregator).toEqual([{ tokenId: "t1", amountKwh: 3 }]);
  });
});
