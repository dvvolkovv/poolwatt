import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/prisma";

let mockUserId: string | null = null;
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (mockUserId ? { user: { id: mockUserId } } : null)),
}));

import { verifyClaim } from "./actions";

const TEST_HANDLE = "test-claim-verify";
const TEST_USERNAME = "test_claim_verify_user";
let testProducerId: string;
let testUserId: string;

async function cleanup() {
  await prisma.claimToken.deleteMany({ where: { user: { username: TEST_USERNAME } } });
  await prisma.producer.deleteMany({ where: { handle: TEST_HANDLE } });
  await prisma.user.deleteMany({ where: { username: TEST_USERNAME } });
}

beforeAll(async () => {
  await cleanup();
  const user = await prisma.user.create({
    data: { username: TEST_USERNAME, passwordHash: "x" },
  });
  testUserId = user.id;
  const producer = await prisma.producer.create({
    data: {
      slug: TEST_HANDLE, handle: TEST_HANDLE, displayName: "VTest Co",
      country: "DE", primarySource: "SOLAR",
      capacityKwh: 100, inverterKw: 50, rank: 9992,
    },
  });
  testProducerId = producer.id;
});

afterAll(cleanup);

beforeEach(async () => {
  mockUserId = testUserId;
  await prisma.producer.update({
    where: { id: testProducerId },
    data: { claimedById: null, claimedAt: null },
  });
  await prisma.claimToken.deleteMany({ where: { userId: testUserId } });
});

async function createToken(opts: { token: string; expiresAt?: Date; consumedAt?: Date | null }) {
  await prisma.claimToken.create({
    data: {
      token: opts.token,
      entityType: "PRODUCER",
      entityId: testProducerId,
      email: "ceo@vtest.example",
      userId: testUserId,
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 30 * 60 * 1000),
      consumedAt: opts.consumedAt ?? null,
    },
  });
}

describe("verifyClaim", () => {
  it("on valid code: marks producer claimed and consumes token", async () => {
    await createToken({ token: "123456" });
    const result = await verifyClaim({
      entityType: "PRODUCER", entityId: testProducerId, code: "123456",
    });
    expect(result.ok).toBe(true);

    const producer = await prisma.producer.findUnique({ where: { id: testProducerId } });
    expect(producer?.claimedById).toBe(testUserId);
    expect(producer?.claimedAt).not.toBeNull();

    const token = await prisma.claimToken.findFirst({ where: { token: "123456" } });
    expect(token?.consumedAt).not.toBeNull();
  });

  it("rejects wrong code", async () => {
    await createToken({ token: "654321" });
    const result = await verifyClaim({
      entityType: "PRODUCER", entityId: testProducerId, code: "111111",
    });
    expect(result.ok).toBe(false);

    const producer = await prisma.producer.findUnique({ where: { id: testProducerId } });
    expect(producer?.claimedById).toBeNull();
  });

  it("rejects expired code", async () => {
    await createToken({ token: "222222", expiresAt: new Date(Date.now() - 1) });
    const result = await verifyClaim({
      entityType: "PRODUCER", entityId: testProducerId, code: "222222",
    });
    expect(result.ok).toBe(false);

    const producer = await prisma.producer.findUnique({ where: { id: testProducerId } });
    expect(producer?.claimedById).toBeNull();
  });

  it("rejects already-consumed code", async () => {
    await createToken({ token: "333333", consumedAt: new Date() });
    const result = await verifyClaim({
      entityType: "PRODUCER", entityId: testProducerId, code: "333333",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects when not logged in", async () => {
    await createToken({ token: "444444" });
    mockUserId = null;
    const result = await verifyClaim({
      entityType: "PRODUCER", entityId: testProducerId, code: "444444",
    });
    expect(result.ok).toBe(false);
  });
});
