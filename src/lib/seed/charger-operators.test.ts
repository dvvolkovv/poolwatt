import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { seedChargerOperators, type ChargerOperatorSeedRow } from "./charger-operators";

const TEST_SLUGS = ["test-cop-a", "test-cop-b"];

const TEST_ROWS: ChargerOperatorSeedRow[] = [
  { slug: "test-cop-a", displayName: "Test Op A", aliases: ["Test Op A", "Op A"], websiteUrl: "https://opa.example" },
  { slug: "test-cop-b", displayName: "Test Op B", aliases: ["Test Op B"], websiteUrl: null },
];

async function cleanup() {
  await prisma.chargerOperator.deleteMany({ where: { slug: { in: TEST_SLUGS } } });
}

beforeAll(cleanup);
afterAll(cleanup);

describe("seedChargerOperators", () => {
  it("creates rows on first run with correct fields", async () => {
    const r = await seedChargerOperators(prisma, TEST_ROWS);
    expect(r.created).toBe(2);
    expect(r.skipped).toBe(0);

    const a = await prisma.chargerOperator.findUnique({ where: { slug: "test-cop-a" } });
    expect(a?.displayName).toBe("Test Op A");
    expect(a?.aliases).toEqual(["Test Op A", "Op A"]);
    expect(a?.websiteUrl).toBe("https://opa.example");

    const b = await prisma.chargerOperator.findUnique({ where: { slug: "test-cop-b" } });
    expect(b?.websiteUrl).toBeNull();
  });

  it("is idempotent on re-run", async () => {
    const r = await seedChargerOperators(prisma, TEST_ROWS);
    expect(r.created).toBe(0);
    expect(r.skipped).toBe(2);
  });
});
