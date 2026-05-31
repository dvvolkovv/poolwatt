import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/resend-producer-match", () => ({
  sendProducerInterestExpressedToOwner: vi.fn(async () => {}),
}));

let mockUserId: string | null = null;
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (mockUserId ? { user: { id: mockUserId } } : null)),
}));

import { expressProducerInterest, withdrawProducerClaim } from "./actions";
import { sendProducerInterestExpressedToOwner } from "@/lib/resend-producer-match";

const TEST_HANDLE = "test-r4-prod";
const OWNER_USERNAME = "test_r4_owner";
const OTHER_USERNAME = "test_r4_other";
const HOMEOWNER_USERNAME = "test_r4_homeowner";

let testProducerId: string;
let ownerUserId: string;
let otherUserId: string;
let homeownerUserId: string;
let testBuildRequestId: string;

async function cleanup() {
  await prisma.producerBuildRequestClaim.deleteMany({
    where: { producer: { handle: TEST_HANDLE } },
  });
  await prisma.buildRequest.deleteMany({
    where: { user: { username: HOMEOWNER_USERNAME } },
  });
  await prisma.producer.deleteMany({ where: { handle: TEST_HANDLE } });
  await prisma.user.deleteMany({
    where: { username: { in: [OWNER_USERNAME, OTHER_USERNAME, HOMEOWNER_USERNAME] } },
  });
}

beforeAll(async () => {
  await cleanup();
  ownerUserId = (await prisma.user.create({
    data: { username: OWNER_USERNAME, passwordHash: "x" },
  })).id;
  otherUserId = (await prisma.user.create({
    data: { username: OTHER_USERNAME, passwordHash: "x" },
  })).id;
  homeownerUserId = (await prisma.user.create({
    data: { username: HOMEOWNER_USERNAME, passwordHash: "x", name: "Homer", email: "h@example.com", phone: "+1" },
  })).id;
  testProducerId = (await prisma.producer.create({
    data: {
      slug: TEST_HANDLE, handle: TEST_HANDLE, displayName: "R4 Test Producer",
      country: "DE", primarySource: "SOLAR",
      capacityKwh: 100, inverterKw: 50, rank: 9994,
      claimedById: ownerUserId, claimedAt: new Date(),
    },
  })).id;
  testBuildRequestId = (await prisma.buildRequest.create({
    data: {
      userId: homeownerUserId,
      source: "SOLAR",
      peakKw: 10,
      city: "Berlin", country: "DE",
      addressLine: "Test 1",
      siteType: "PRIVATE_HOUSE",
      roofOrientation: "S",
      budget: "AWAITING_QUOTE",
      timeline: "EXPLORING",
      status: "OPEN",
    },
  })).id;
});

afterAll(cleanup);

beforeEach(async () => {
  mockUserId = ownerUserId;
  vi.mocked(sendProducerInterestExpressedToOwner).mockClear();
  await prisma.producerBuildRequestClaim.deleteMany({
    where: { producerId: testProducerId },
  });
});

describe("expressProducerInterest", () => {
  it("creates a PENDING claim when the owner submits", async () => {
    const r = await expressProducerInterest({
      buildRequestId: testBuildRequestId,
      producerId: testProducerId,
      message: "We can supply panels and inverters.",
    });
    expect(r.ok).toBe(true);
    expect(r.claimId).toBeDefined();

    const claims = await prisma.producerBuildRequestClaim.findMany({
      where: { producerId: testProducerId },
    });
    expect(claims).toHaveLength(1);
    expect(claims[0].status).toBe("PENDING");
    expect(claims[0].message).toBe("We can supply panels and inverters.");

    expect(sendProducerInterestExpressedToOwner).toHaveBeenCalledOnce();
  });

  it("rejects when caller is not the producer's claimedById owner", async () => {
    mockUserId = otherUserId;
    const r = await expressProducerInterest({
      buildRequestId: testBuildRequestId,
      producerId: testProducerId,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects when not logged in", async () => {
    mockUserId = null;
    const r = await expressProducerInterest({
      buildRequestId: testBuildRequestId,
      producerId: testProducerId,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects when build request is not OPEN", async () => {
    await prisma.buildRequest.update({
      where: { id: testBuildRequestId },
      data: { status: "CANCELLED" },
    });
    const r = await expressProducerInterest({
      buildRequestId: testBuildRequestId,
      producerId: testProducerId,
    });
    expect(r.ok).toBe(false);
    await prisma.buildRequest.update({
      where: { id: testBuildRequestId },
      data: { status: "OPEN" },
    });
  });

  it("rejects duplicate (same producer × same BR)", async () => {
    await expressProducerInterest({
      buildRequestId: testBuildRequestId,
      producerId: testProducerId,
    });
    const r = await expressProducerInterest({
      buildRequestId: testBuildRequestId,
      producerId: testProducerId,
    });
    expect(r.ok).toBe(false);
  });
});

describe("withdrawProducerClaim", () => {
  async function makeClaim(): Promise<string> {
    const r = await expressProducerInterest({
      buildRequestId: testBuildRequestId,
      producerId: testProducerId,
    });
    return r.claimId!;
  }

  it("marks claim WITHDRAWN when owner withdraws", async () => {
    const claimId = await makeClaim();
    const r = await withdrawProducerClaim({ claimId, producerId: testProducerId });
    expect(r.ok).toBe(true);
    const after = await prisma.producerBuildRequestClaim.findUnique({ where: { id: claimId } });
    expect(after?.status).toBe("WITHDRAWN");
    expect(after?.respondedAt).not.toBeNull();
  });

  it("rejects when caller is not the producer owner", async () => {
    const claimId = await makeClaim();
    mockUserId = otherUserId;
    const r = await withdrawProducerClaim({ claimId, producerId: testProducerId });
    expect(r.ok).toBe(false);
  });

  it("rejects when claim is not PENDING (already accepted)", async () => {
    const claimId = await makeClaim();
    await prisma.producerBuildRequestClaim.update({
      where: { id: claimId },
      data: { status: "ACCEPTED", respondedAt: new Date() },
    });
    const r = await withdrawProducerClaim({ claimId, producerId: testProducerId });
    expect(r.ok).toBe(false);
  });
});
