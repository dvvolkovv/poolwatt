import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/prisma";

let mockUserId: string | null = null;
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (mockUserId ? { user: { id: mockUserId } } : null)),
}));

import { updateChargerOperatorCard, unlinkChargerOperatorClaim } from "./actions";

const TEST_SLUG = "test-co-cabinet";
const TEST_USERNAME = "test_co_user";
const OTHER_USERNAME = "test_co_other";

let testOpId: string;
let ownerUserId: string;
let otherUserId: string;

async function cleanup() {
  await prisma.chargerOperator.deleteMany({ where: { slug: TEST_SLUG } });
  await prisma.user.deleteMany({ where: { username: { in: [TEST_USERNAME, OTHER_USERNAME] } } });
}

beforeAll(async () => {
  await cleanup();
  ownerUserId = (await prisma.user.create({ data: { username: TEST_USERNAME, passwordHash: "x" } })).id;
  otherUserId = (await prisma.user.create({ data: { username: OTHER_USERNAME, passwordHash: "x" } })).id;
  testOpId = (await prisma.chargerOperator.create({
    data: {
      slug: TEST_SLUG, displayName: "Test Op", aliases: ["Test Op"],
      claimedById: ownerUserId, claimedAt: new Date(),
    },
  })).id;
});

afterAll(cleanup);

beforeEach(async () => {
  mockUserId = ownerUserId;
  await prisma.chargerOperator.update({
    where: { id: testOpId },
    data: {
      displayName: "Test Op",
      description: null, websiteUrl: null, logoUrl: null, email: null, phone: null,
      claimedById: ownerUserId, claimedAt: new Date(),
    },
  });
});

describe("updateChargerOperatorCard", () => {
  it("updates fields when caller is the owner", async () => {
    const r = await updateChargerOperatorCard({
      operatorId: testOpId,
      displayName: "Renamed Op",
      description: "We run fast chargers.",
      websiteUrl: "https://renamed.example",
      logoUrl: "https://renamed.example/l.png",
      email: "ops@renamed.example",
      phone: "+1",
    });
    expect(r.ok).toBe(true);
    const after = await prisma.chargerOperator.findUnique({ where: { id: testOpId } });
    expect(after?.displayName).toBe("Renamed Op");
    expect(after?.description).toBe("We run fast chargers.");
    expect(after?.email).toBe("ops@renamed.example");
  });

  it("rejects when caller is not the owner", async () => {
    mockUserId = otherUserId;
    const r = await updateChargerOperatorCard({
      operatorId: testOpId,
      displayName: "Hostile rename",
    });
    expect(r.ok).toBe(false);
    const after = await prisma.chargerOperator.findUnique({ where: { id: testOpId } });
    expect(after?.displayName).toBe("Test Op");
  });

  it("rejects when displayName is empty", async () => {
    const r = await updateChargerOperatorCard({
      operatorId: testOpId,
      displayName: "",
    });
    expect(r.ok).toBe(false);
    expect(r.fieldErrors?.displayName).toBeDefined();
  });
});

describe("unlinkChargerOperatorClaim", () => {
  it("clears claim when owner unlinks", async () => {
    const r = await unlinkChargerOperatorClaim({ operatorId: testOpId });
    expect(r.ok).toBe(true);
    const after = await prisma.chargerOperator.findUnique({ where: { id: testOpId } });
    expect(after?.claimedById).toBeNull();
  });

  it("rejects when caller is not the owner", async () => {
    mockUserId = otherUserId;
    const r = await unlinkChargerOperatorClaim({ operatorId: testOpId });
    expect(r.ok).toBe(false);
  });
});
