import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  ROAMING_AGREEMENT_SEED,
  seedRoamingAgreements,
  type RoamingAgreementSeedRow,
} from "./roaming";

const CODES = ["TESTROAMA", "TESTROAMB"];

const TEST_ROWS: RoamingAgreementSeedRow[] = [
  { homeZoneCode: "TESTROAMA", visitedZoneCode: "TESTROAMB", partnerName: "Partner AB", feePct: 3, dailyLimitKwh: 500 },
  { homeZoneCode: "TESTROAMB", visitedZoneCode: "TESTROAMA", partnerName: "Partner BA", feePct: 4, dailyLimitKwh: null },
];

async function cleanup() {
  const zones = await prisma.gridZone.findMany({ where: { code: { in: CODES } } });
  const ids = zones.map((z) => z.id);
  await prisma.roamingAgreement.deleteMany({
    where: { OR: [{ homeZoneId: { in: ids } }, { visitedZoneId: { in: ids } }] },
  });
  await prisma.gridZone.deleteMany({ where: { code: { in: CODES } } });
}

beforeAll(async () => {
  await cleanup();
  await prisma.gridZone.createMany({
    data: CODES.map((code) => ({ code, country: "SK", name: `Zone ${code}` })),
  });
});
afterAll(cleanup);

describe("seedRoamingAgreements", () => {
  it("creates one agreement per configured direction", async () => {
    const result = await seedRoamingAgreements(prisma, TEST_ROWS);
    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);

    const home = await prisma.gridZone.findUniqueOrThrow({ where: { code: "TESTROAMA" } });
    const agreement = await prisma.roamingAgreement.findFirst({
      where: { homeZoneId: home.id },
    });
    expect(agreement?.partnerName).toBe("Partner AB");
    expect(Number(agreement?.feePct)).toBe(3);
    expect(Number(agreement?.dailyLimitKwh)).toBe(500);
    expect(agreement?.enabled).toBe(true);
  });

  it("is idempotent on a second run", async () => {
    const result = await seedRoamingAgreements(prisma, TEST_ROWS);
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(2);
  });

  it("skips a direction whose zone is not seeded yet", async () => {
    const result = await seedRoamingAgreements(prisma, [
      { homeZoneCode: "TESTROAMA", visitedZoneCode: "NOSUCHZONE", partnerName: "x", feePct: 1, dailyLimitKwh: null },
    ]);
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
  });
});

describe("ROAMING_AGREEMENT_SEED", () => {
  it("never pairs a zone with itself", () => {
    for (const row of ROAMING_AGREEMENT_SEED) {
      expect(row.homeZoneCode).not.toBe(row.visitedZoneCode);
    }
  });

  it("has one row per direction", () => {
    const keys = ROAMING_AGREEMENT_SEED.map((r) => `${r.homeZoneCode}>${r.visitedZoneCode}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the clearing fee within a sane range", () => {
    for (const row of ROAMING_AGREEMENT_SEED) {
      expect(row.feePct).toBeGreaterThanOrEqual(0);
      expect(row.feePct).toBeLessThanOrEqual(20);
    }
  });
});
