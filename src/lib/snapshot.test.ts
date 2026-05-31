import { describe, it, expect } from "vitest";
import { readTopProducers } from "./snapshot";

describe("readTopProducers (DB-backed)", () => {
  it("returns 100 rows ordered by rank ascending", async () => {
    const rows = await readTopProducers();
    expect(rows).toHaveLength(100);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].rank).toBeGreaterThanOrEqual(rows[i - 1].rank);
    }
  });

  it("returns rows shaped like ProducerRow with both card and snapshot fields", async () => {
    const rows = await readTopProducers();
    const r = rows[0];
    // card (from DB)
    expect(typeof r.handle).toBe("string");
    expect(typeof r.displayName).toBe("string");
    expect(typeof r.country).toBe("string");
    expect(typeof r.capacityKwh).toBe("number"); // Decimal → number
    expect(typeof r.inverterKw).toBe("number");
    // snapshot (from mock)
    expect(typeof r.stateOfChargePct).toBe("number");
    expect(typeof r.pricePerKwhUsd).toBe("number");
    expect(Array.isArray(r.weeklyOutput)).toBe(true);
    expect(r.weeklyOutput).toHaveLength(7);
    expect(typeof r.weatherCondition).toBe("string");
  });

  it("returns the rank-1 producer matching the seed (jinko-solar-haining)", async () => {
    const rows = await readTopProducers();
    const top = rows.find((r) => r.rank === 1);
    expect(top?.handle).toBe("jinko-solar-haining");
    expect(top?.displayName).toBe("JinkoSolar — Haining");
    expect(top?.country).toBe("CN");
    expect(top?.primarySource).toBe("SOLAR");
  });

  it("populates profile from DB when the producer has one (jinko has a PRODUCER_PROFILES entry)", async () => {
    const rows = await readTopProducers();
    const jinko = rows.find((r) => r.handle === "jinko-solar-haining");
    expect(jinko?.profile).toBeDefined();
    expect(jinko?.profile?.ceo).toBe("Xiande Li");
    expect(jinko?.profile?.founded).toBe(2006);
  });
});
