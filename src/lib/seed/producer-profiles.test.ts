import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { seedProducers } from "./producers";
import { seedProducerProfiles } from "./producer-profiles";
import type { ProducerRow, ProducerProfile } from "@/lib/producers";

const TEST_HANDLES = ["test-prof-a", "test-prof-b"];

const ROWS: ProducerRow[] = [
  {
    id: "x1", rank: 901, handle: "test-prof-a", displayName: "Prof A",
    city: "X", country: "DE", primarySource: "SOLAR",
    capacityKwh: 100, inverterKw: 50, stateOfChargePct: 90, availableKwh: 90,
    pricePerKwhUsd: 0.04, delivered24hKwh: 100, deliveredLifetimeKwh: 1000,
    pctChange1h: 0, pctChange24h: 0, pctChange7d: 0, uptimePct: 99,
    weeklyOutput: [100, 100, 100, 100, 100, 100, 100],
    weatherCondition: "SUNNY", carbonOffsetKgCo2e: 50,
  },
  {
    id: "x2", rank: 902, handle: "test-prof-b", displayName: "Prof B",
    city: "X", country: "DE", primarySource: "WIND",
    capacityKwh: 100, inverterKw: 50, stateOfChargePct: 90, availableKwh: 90,
    pricePerKwhUsd: 0.04, delivered24hKwh: 100, deliveredLifetimeKwh: 1000,
    pctChange1h: 0, pctChange24h: 0, pctChange7d: 0, uptimePct: 99,
    weeklyOutput: [100, 100, 100, 100, 100, 100, 100],
    weatherCondition: "WINDY", carbonOffsetKgCo2e: 50,
  },
];

// Only "test-prof-a" has a profile; "test-prof-b" intentionally omitted
// to verify the seed gracefully skips producers without a matching profile.
const PROFILES: Record<string, ProducerProfile> = {
  "test-prof-a": {
    description: "A test company",
    founded: 1999,
    employees: "~10",
    website: "https://test-a.example",
    email: "ceo@test-a.example",
    phone: "+49 30 0000000",
    address: "Berlin, DE",
    ceo: "Jane Doe",
    certifications: ["ISO 9001"],
    keyProducts: ["Test panels"],
  },
};

async function cleanup() {
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
  await seedProducers(prisma, ROWS); // arrange: producers must exist first
  firstRunResult = await seedProducerProfiles(prisma, PROFILES);
});
afterAll(cleanup);

describe("seedProducerProfiles", () => {
  it("creates profiles for matching producers only", async () => {
    expect(firstRunResult.created).toBe(1);
    expect(firstRunResult.skipped).toBe(0);

    const profA = await prisma.producerProfile.findFirst({
      where: { producer: { handle: "test-prof-a" } },
    });
    expect(profA?.description).toBe("A test company");
    expect(profA?.founded).toBe(1999);
    expect(profA?.certifications).toEqual(["ISO 9001"]);
    expect(profA?.keyProducts).toEqual(["Test panels"]);

    const profB = await prisma.producerProfile.findFirst({
      where: { producer: { handle: "test-prof-b" } },
    });
    expect(profB).toBeNull(); // no PROFILES entry → no row
  });

  it("is idempotent on re-run", async () => {
    const r = await seedProducerProfiles(prisma, PROFILES);
    expect(r.created).toBe(0);
    expect(r.skipped).toBe(1);

    const count = await prisma.producerProfile.count({
      where: { producer: { handle: { in: TEST_HANDLES } } },
    });
    expect(count).toBe(1);
  });

  it("silently skips profiles whose handle has no producer in DB", async () => {
    const r = await seedProducerProfiles(prisma, {
      ...PROFILES,
      "test-prof-nonexistent": PROFILES["test-prof-a"],
    });
    // "test-prof-a" already exists (skipped); nonexistent has no producer (skipped before insert).
    expect(r.created).toBe(0);
    expect(r.skipped).toBe(1); // only the existing one shows up; the nonexistent never enters `data`
  });
});
