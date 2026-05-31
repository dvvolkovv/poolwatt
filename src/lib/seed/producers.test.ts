import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { seedProducers } from "./producers";
import type { ProducerRow } from "@/lib/producers";

const TEST_HANDLES = ["test-seed-a", "test-seed-b", "test-seed-c"];

const TEST_ROWS: ProducerRow[] = [
  {
    id: "p1", rank: 1, handle: "test-seed-a", displayName: "Test A",
    city: "X", country: "DE", primarySource: "SOLAR",
    capacityKwh: 100, inverterKw: 50, stateOfChargePct: 90, availableKwh: 90,
    pricePerKwhUsd: 0.04, delivered24hKwh: 100, deliveredLifetimeKwh: 1000,
    pctChange1h: 0, pctChange24h: 0, pctChange7d: 0, uptimePct: 99,
    weeklyOutput: [100, 100, 100, 100, 100, 100, 100],
    weatherCondition: "SUNNY", carbonOffsetKgCo2e: 50,
  },
  {
    id: "p2", rank: 2, handle: "test-seed-b", displayName: "Test B",
    city: "X", country: "DE", primarySource: "WIND",
    capacityKwh: 200, inverterKw: 80, stateOfChargePct: 80, availableKwh: 160,
    pricePerKwhUsd: 0.04, delivered24hKwh: 200, deliveredLifetimeKwh: 2000,
    pctChange1h: 0, pctChange24h: 0, pctChange7d: 0, uptimePct: 99,
    weeklyOutput: [200, 200, 200, 200, 200, 200, 200],
    weatherCondition: "WINDY", carbonOffsetKgCo2e: 100,
    equipment: ["X turbines"],
  },
  {
    id: "p3", rank: 3, handle: "test-seed-c", displayName: "Test C",
    city: "X", country: "DE", primarySource: "SOLAR",
    category: "EQUIPMENT_MANUFACTURER",
    capacityKwh: 50, inverterKw: 20, stateOfChargePct: 90, availableKwh: 45,
    pricePerKwhUsd: 0.05, delivered24hKwh: 50, deliveredLifetimeKwh: 500,
    pctChange1h: 0, pctChange24h: 0, pctChange7d: 0, uptimePct: 99,
    weeklyOutput: [50, 50, 50, 50, 50, 50, 50],
    weatherCondition: "SUNNY", carbonOffsetKgCo2e: 25,
    manufactures: ["Modules"],
  },
];

async function cleanup() {
  // Producer cascades to ProducerProfile via onDelete: Cascade,
  // but we keep this explicit so the test doesn't depend on cascade behavior.
  await prisma.producerProfile.deleteMany({
    where: { producer: { handle: { in: TEST_HANDLES } } },
  });
  await prisma.producer.deleteMany({
    where: { handle: { in: TEST_HANDLES } },
  });
}

let firstRunResult: { created: number; skipped: number };

beforeAll(async () => {
  await cleanup();
  firstRunResult = await seedProducers(prisma, TEST_ROWS);
});
afterAll(cleanup);

describe("seedProducers", () => {
  it("creates rows on first run and returns the count", async () => {
    expect(firstRunResult.created).toBe(3);
    expect(firstRunResult.skipped).toBe(0);
    const all = await prisma.producer.findMany({
      where: { handle: { in: TEST_HANDLES } },
      orderBy: { rank: "asc" },
    });
    expect(all).toHaveLength(3);
    expect(all.map((p) => p.handle)).toEqual([
      "test-seed-a", "test-seed-b", "test-seed-c",
    ]);
  });

  it("is idempotent on re-run (skipDuplicates)", async () => {
    const r = await seedProducers(prisma, TEST_ROWS);
    expect(r.created).toBe(0);
    expect(r.skipped).toBe(3);
    const all = await prisma.producer.findMany({
      where: { handle: { in: TEST_HANDLES } },
    });
    expect(all).toHaveLength(3);
  });

  it("derives category — explicit EQUIPMENT_MANUFACTURER preserved, default ENERGY_PRODUCER", async () => {
    const c = await prisma.producer.findUnique({ where: { handle: "test-seed-c" } });
    expect(c?.category).toBe("EQUIPMENT_MANUFACTURER");
    const a = await prisma.producer.findUnique({ where: { handle: "test-seed-a" } });
    expect(a?.category).toBe("ENERGY_PRODUCER");
  });

  it("copies equipment and manufactures arrays (empty array when absent)", async () => {
    const a = await prisma.producer.findUnique({ where: { handle: "test-seed-a" } });
    expect(a?.equipment).toEqual([]);
    expect(a?.manufactures).toEqual([]);

    const b = await prisma.producer.findUnique({ where: { handle: "test-seed-b" } });
    expect(b?.equipment).toEqual(["X turbines"]);
    expect(b?.manufactures).toEqual([]);

    const c = await prisma.producer.findUnique({ where: { handle: "test-seed-c" } });
    expect(c?.manufactures).toEqual(["Modules"]);
  });
});
