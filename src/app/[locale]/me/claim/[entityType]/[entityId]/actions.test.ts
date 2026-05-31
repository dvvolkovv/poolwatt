import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Mock the email sender so tests don't hit Resend
vi.mock("@/lib/resend-claim", () => ({
  sendClaimVerificationEmail: vi.fn(async () => {}),
}));

// Mock auth so test can run without a real session
let mockUserId: string | null = null;
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (mockUserId ? { user: { id: mockUserId } } : null)),
}));

import { submitClaim } from "./actions";
import { sendClaimVerificationEmail } from "@/lib/resend-claim";

const TEST_HANDLE = "test-claim-submit";
const TEST_USERNAME = "test_claim_submit_user";
let testProducerId: string;
let testUserId: string;

beforeAll(async () => {
  await prisma.claimToken.deleteMany({ where: { user: { username: TEST_USERNAME } } });
  await prisma.producer.deleteMany({ where: { handle: TEST_HANDLE } });
  await prisma.user.deleteMany({ where: { username: TEST_USERNAME } });

  const user = await prisma.user.create({
    data: { username: TEST_USERNAME, passwordHash: "x" },
  });
  testUserId = user.id;

  const producer = await prisma.producer.create({
    data: {
      slug: TEST_HANDLE, handle: TEST_HANDLE, displayName: "Test Co",
      country: "DE", primarySource: "SOLAR",
      capacityKwh: 100, inverterKw: 50, rank: 9991,
    },
  });
  testProducerId = producer.id;
  await prisma.producerProfile.create({
    data: { producerId: producer.id, website: "https://testco.example" },
  });
});

afterAll(async () => {
  await prisma.claimToken.deleteMany({ where: { user: { username: TEST_USERNAME } } });
  await prisma.producerProfile.deleteMany({ where: { producer: { handle: TEST_HANDLE } } });
  await prisma.producer.deleteMany({ where: { handle: TEST_HANDLE } });
  await prisma.user.deleteMany({ where: { username: TEST_USERNAME } });
});

beforeEach(() => {
  mockUserId = testUserId;
  vi.mocked(sendClaimVerificationEmail).mockClear();
});

describe("submitClaim", () => {
  it("creates a ClaimToken and sends email when email domain matches website", async () => {
    const result = await submitClaim({
      entityType: "PRODUCER", entityId: testProducerId, email: "ceo@testco.example",
    });
    expect(result.ok).toBe(true);

    const tokens = await prisma.claimToken.findMany({
      where: { entityId: testProducerId, userId: testUserId },
    });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].email).toBe("ceo@testco.example");
    expect(tokens[0].token).toMatch(/^\d{6}$/);
    expect(tokens[0].consumedAt).toBeNull();
    expect(tokens[0].expiresAt.getTime()).toBeGreaterThan(Date.now());

    expect(sendClaimVerificationEmail).toHaveBeenCalledOnce();
    expect(sendClaimVerificationEmail).toHaveBeenCalledWith(
      "ceo@testco.example",
      tokens[0].token,
      "Test Co",
    );

    await prisma.claimToken.deleteMany({ where: { id: tokens[0].id } });
  });

  it("rejects email that doesn't match website domain", async () => {
    const result = await submitClaim({
      entityType: "PRODUCER", entityId: testProducerId, email: "attacker@evil.com",
    });
    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.email).toBeDefined();
    expect(sendClaimVerificationEmail).not.toHaveBeenCalled();

    const tokens = await prisma.claimToken.count({ where: { entityId: testProducerId } });
    expect(tokens).toBe(0);
  });

  it("rejects when not logged in", async () => {
    mockUserId = null;
    const result = await submitClaim({
      entityType: "PRODUCER", entityId: testProducerId, email: "ceo@testco.example",
    });
    expect(result.ok).toBe(false);
    expect(result.formError).toBeDefined();
    expect(sendClaimVerificationEmail).not.toHaveBeenCalled();
  });

  it("rejects when entity is already claimed", async () => {
    await prisma.producer.update({
      where: { id: testProducerId },
      data: { claimedById: testUserId, claimedAt: new Date() },
    });

    const result = await submitClaim({
      entityType: "PRODUCER", entityId: testProducerId, email: "ceo@testco.example",
    });
    expect(result.ok).toBe(false);
    expect(result.formError).toBeDefined();

    await prisma.producer.update({
      where: { id: testProducerId },
      data: { claimedById: null, claimedAt: null },
    });
  });
});
