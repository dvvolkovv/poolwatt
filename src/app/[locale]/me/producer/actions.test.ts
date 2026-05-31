import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/prisma";

let mockUserId: string | null = null;
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (mockUserId ? { user: { id: mockUserId } } : null)),
}));

import {
  updateProducerCard,
  updateProducerProfile,
  unlinkClaim,
} from "./actions";

const TEST_HANDLE = "test-cabinet-prod";
const TEST_USERNAME = "test_cabinet_user";
const OTHER_USERNAME = "test_cabinet_other";
let testProducerId: string;
let ownerUserId: string;
let otherUserId: string;

async function cleanup() {
  await prisma.producerProfile.deleteMany({ where: { producer: { handle: TEST_HANDLE } } });
  await prisma.producer.deleteMany({ where: { handle: TEST_HANDLE } });
  await prisma.user.deleteMany({ where: { username: { in: [TEST_USERNAME, OTHER_USERNAME] } } });
}

beforeAll(async () => {
  await cleanup();
  ownerUserId = (await prisma.user.create({
    data: { username: TEST_USERNAME, passwordHash: "x" },
  })).id;
  otherUserId = (await prisma.user.create({
    data: { username: OTHER_USERNAME, passwordHash: "x" },
  })).id;
  testProducerId = (await prisma.producer.create({
    data: {
      slug: TEST_HANDLE, handle: TEST_HANDLE, displayName: "Cabinet Test Co",
      country: "DE", primarySource: "SOLAR",
      capacityKwh: 100, inverterKw: 50, rank: 9993,
      claimedById: ownerUserId, claimedAt: new Date(),
    },
  })).id;
});

afterAll(cleanup);

beforeEach(async () => {
  mockUserId = ownerUserId;
  await prisma.producer.update({
    where: { id: testProducerId },
    data: {
      displayName: "Cabinet Test Co",
      bio: null, logoUrl: null, websiteUrl: null, twitterUrl: null,
      claimedById: ownerUserId, claimedAt: new Date(),
    },
  });
  await prisma.producerProfile.deleteMany({ where: { producerId: testProducerId } });
});

describe("updateProducerCard", () => {
  it("updates the editable card fields when caller is the owner", async () => {
    const r = await updateProducerCard({
      producerId: testProducerId,
      displayName: "Renamed Inc",
      bio: "New bio text",
      logoUrl: "https://example.com/logo.png",
      websiteUrl: "https://example.com",
      twitterUrl: "https://twitter.com/example",
    });
    expect(r.ok).toBe(true);

    const after = await prisma.producer.findUnique({ where: { id: testProducerId } });
    expect(after?.displayName).toBe("Renamed Inc");
    expect(after?.bio).toBe("New bio text");
    expect(after?.logoUrl).toBe("https://example.com/logo.png");
    expect(after?.websiteUrl).toBe("https://example.com");
    expect(after?.twitterUrl).toBe("https://twitter.com/example");
  });

  it("rejects when caller is not the owner", async () => {
    mockUserId = otherUserId;
    const r = await updateProducerCard({
      producerId: testProducerId,
      displayName: "Hostile rename",
    });
    expect(r.ok).toBe(false);

    const after = await prisma.producer.findUnique({ where: { id: testProducerId } });
    expect(after?.displayName).toBe("Cabinet Test Co");
  });

  it("rejects when not logged in", async () => {
    mockUserId = null;
    const r = await updateProducerCard({
      producerId: testProducerId,
      displayName: "Anonymous rename",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects when displayName is empty", async () => {
    const r = await updateProducerCard({
      producerId: testProducerId,
      displayName: "",
    });
    expect(r.ok).toBe(false);
    expect(r.fieldErrors?.displayName).toBeDefined();
  });

  it("accepts empty optional fields (sets DB nulls)", async () => {
    await updateProducerCard({
      producerId: testProducerId,
      displayName: "X",
      bio: "y",
      logoUrl: "https://example.com/l.png",
    });
    const r = await updateProducerCard({
      producerId: testProducerId,
      displayName: "X",
      bio: "",
      logoUrl: "",
    });
    expect(r.ok).toBe(true);
    const after = await prisma.producer.findUnique({ where: { id: testProducerId } });
    expect(after?.bio).toBeNull();
    expect(after?.logoUrl).toBeNull();
  });
});

describe("updateProducerProfile", () => {
  it("creates ProducerProfile on first call when none exists", async () => {
    const r = await updateProducerProfile({
      producerId: testProducerId,
      description: "We make panels.",
      founded: 1999,
      employees: "~100",
      website: "https://example.com",
      email: "ceo@example.com",
      phone: "+1 555 0000",
      address: "Berlin",
      ceo: "Jane Doe",
      stockTicker: "TST",
    });
    expect(r.ok).toBe(true);
    const profile = await prisma.producerProfile.findUnique({ where: { producerId: testProducerId } });
    expect(profile?.description).toBe("We make panels.");
    expect(profile?.founded).toBe(1999);
    expect(profile?.ceo).toBe("Jane Doe");
    expect(profile?.stockTicker).toBe("TST");
  });

  it("updates ProducerProfile on subsequent call", async () => {
    await updateProducerProfile({
      producerId: testProducerId,
      description: "First version",
    });
    const r = await updateProducerProfile({
      producerId: testProducerId,
      description: "Updated version",
    });
    expect(r.ok).toBe(true);
    const profile = await prisma.producerProfile.findUnique({ where: { producerId: testProducerId } });
    expect(profile?.description).toBe("Updated version");
  });

  it("rejects when caller is not the owner", async () => {
    mockUserId = otherUserId;
    const r = await updateProducerProfile({
      producerId: testProducerId,
      description: "Hostile bio",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects when founded is implausible (e.g. 1500 or future)", async () => {
    const r1 = await updateProducerProfile({
      producerId: testProducerId,
      founded: 1500,
    });
    expect(r1.ok).toBe(false);

    const r2 = await updateProducerProfile({
      producerId: testProducerId,
      founded: new Date().getFullYear() + 5,
    });
    expect(r2.ok).toBe(false);
  });
});

describe("unlinkClaim", () => {
  it("clears claimedById and claimedAt when caller is the owner", async () => {
    const r = await unlinkClaim({ producerId: testProducerId });
    expect(r.ok).toBe(true);
    const after = await prisma.producer.findUnique({ where: { id: testProducerId } });
    expect(after?.claimedById).toBeNull();
    expect(after?.claimedAt).toBeNull();
  });

  it("rejects when caller is not the owner", async () => {
    mockUserId = otherUserId;
    const r = await unlinkClaim({ producerId: testProducerId });
    expect(r.ok).toBe(false);
  });
});
