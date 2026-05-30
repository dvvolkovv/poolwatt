import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { expressInterest, withdrawClaim } from "./actions";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/resend-match", () => ({
  sendInterestExpressedToOwner: vi.fn(),
  sendClaimAcceptedToContractor: vi.fn(),
  sendClaimRejectedToContractor: vi.fn(),
}));

import { auth } from "@/lib/auth";
const mockedAuth = vi.mocked(auth);

const PREFIX = "test_match_";

async function ensureUser(username: string) {
  return prisma.user.upsert({
    where: { username }, update: {}, create: { username, passwordHash: "x" },
  });
}

async function seedHomeowner() {
  const u = await ensureUser(`${PREFIX}home`);
  const br = await prisma.buildRequest.create({
    data: {
      userId: u.id,
      source: "SOLAR",
      peakKw: 10,
      country: "SK",
      city: "Bratislava",
      addressLine: "Hlavná 1",
      siteType: "PRIVATE_HOUSE",
      roofOrientation: "S",
    },
  });
  return { user: u, br };
}

async function seedContractor(opts: {
  username: string;
  status?: "PENDING" | "APPROVED";
  countries?: string[];
  renewables?: ("SOLAR" | "WIND")[];
}) {
  const u = await ensureUser(opts.username);
  const c = await prisma.contractor.create({
    data: {
      slug: `${PREFIX}${opts.username}`,
      entityType: "INDIVIDUAL",
      displayName: `Test ${opts.username}`,
      country: "SK",
      city: "Bratislava",
      workCategories: ["INSTALLATION"],
      renewableTypes: opts.renewables ?? ["SOLAR"],
      countriesServed: opts.countries ?? ["SK"],
      bio: "x".repeat(150),
      contactEmail: `${opts.username}@x.test`,
      contactPhone: "+421900000000",
      status: opts.status ?? "APPROVED",
    },
  });
  await prisma.contractorMember.create({
    data: { contractorId: c.id, userId: u.id, role: "OWNER" },
  });
  return { user: u, contractor: c };
}

beforeEach(async () => {
  // Claims cascade from both BR and Contractor (onDelete: Cascade), so deleting
  // those is enough — no global claim wipe (which would race with other test
  // files in the parallel vitest suite).
  await prisma.buildRequest.deleteMany({ where: { user: { username: { startsWith: PREFIX } } } });
  await prisma.contractor.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("expressInterest", () => {
  it("rejects when not authenticated", async () => {
    const { br } = await seedHomeowner();
    const { contractor } = await seedContractor({ username: "ctr1" });
    mockedAuth.mockResolvedValueOnce(null as never);

    const r = await expressInterest({ buildRequestId: br.id, contractorId: contractor.id });
    expect(r.ok).toBe(false);
    expect(r.formError).toMatch(/auth/i);
  });

  it("rejects when caller is not an OWNER of the contractor", async () => {
    const { br } = await seedHomeowner();
    const { contractor } = await seedContractor({ username: "ctr2" });
    const intruder = await ensureUser(`${PREFIX}intruder`);
    mockedAuth.mockResolvedValueOnce({ user: { id: intruder.id, username: intruder.username, role: "USER" } } as never);

    const r = await expressInterest({ buildRequestId: br.id, contractorId: contractor.id });
    expect(r.ok).toBe(false);
  });

  it("rejects when contractor is not APPROVED", async () => {
    const { br } = await seedHomeowner();
    const { user, contractor } = await seedContractor({ username: "ctr3", status: "PENDING" });
    mockedAuth.mockResolvedValueOnce({ user: { id: user.id, username: user.username, role: "USER" } } as never);

    const r = await expressInterest({ buildRequestId: br.id, contractorId: contractor.id });
    expect(r.ok).toBe(false);
    expect(r.formError).toMatch(/approved/i);
  });

  it("rejects when BuildRequest is not OPEN", async () => {
    const { br } = await seedHomeowner();
    await prisma.buildRequest.update({ where: { id: br.id }, data: { status: "MATCHED" } });
    const { user, contractor } = await seedContractor({ username: "ctr4" });
    mockedAuth.mockResolvedValueOnce({ user: { id: user.id, username: user.username, role: "USER" } } as never);

    const r = await expressInterest({ buildRequestId: br.id, contractorId: contractor.id });
    expect(r.ok).toBe(false);
  });

  it("creates a PENDING claim on happy path", async () => {
    const { br } = await seedHomeowner();
    const { user, contractor } = await seedContractor({ username: "ctr5" });
    mockedAuth.mockResolvedValueOnce({ user: { id: user.id, username: user.username, role: "USER" } } as never);

    const r = await expressInterest({
      buildRequestId: br.id,
      contractorId: contractor.id,
      message: "We can build this in 8 weeks.",
    });
    expect(r.ok).toBe(true);
    expect(r.claimId).toBeDefined();
    const stored = await prisma.buildRequestClaim.findUniqueOrThrow({ where: { id: r.claimId! } });
    expect(stored.status).toBe("PENDING");
    expect(stored.buildRequestId).toBe(br.id);
    expect(stored.contractorId).toBe(contractor.id);
    expect(stored.message).toBe("We can build this in 8 weeks.");
  });

  it("rejects duplicate claim by same contractor on same BR", async () => {
    const { br } = await seedHomeowner();
    const { user, contractor } = await seedContractor({ username: "ctr6" });
    mockedAuth.mockResolvedValue({ user: { id: user.id, username: user.username, role: "USER" } } as never);

    const first = await expressInterest({ buildRequestId: br.id, contractorId: contractor.id });
    expect(first.ok).toBe(true);

    const second = await expressInterest({ buildRequestId: br.id, contractorId: contractor.id });
    expect(second.ok).toBe(false);
    expect(second.formError).toMatch(/already/i);
  });
});

describe("withdrawClaim", () => {
  it("withdraws a PENDING claim when caller is OWNER", async () => {
    const { br } = await seedHomeowner();
    const { user, contractor } = await seedContractor({ username: "ctr_wd1" });
    mockedAuth.mockResolvedValue({ user: { id: user.id, username: user.username, role: "USER" } } as never);

    const c = await expressInterest({ buildRequestId: br.id, contractorId: contractor.id });
    expect(c.ok).toBe(true);

    const r = await withdrawClaim({ claimId: c.claimId!, contractorId: contractor.id });
    expect(r.ok).toBe(true);
    const reloaded = await prisma.buildRequestClaim.findUniqueOrThrow({ where: { id: c.claimId! } });
    expect(reloaded.status).toBe("WITHDRAWN");
    expect(reloaded.respondedAt).not.toBeNull();
  });

  it("refuses if caller is not OWNER", async () => {
    const { br } = await seedHomeowner();
    const { user, contractor } = await seedContractor({ username: "ctr_wd2" });
    mockedAuth.mockResolvedValueOnce({ user: { id: user.id, username: user.username, role: "USER" } } as never);
    const c = await expressInterest({ buildRequestId: br.id, contractorId: contractor.id });

    const intruder = await ensureUser(`${PREFIX}wd_intruder`);
    mockedAuth.mockResolvedValueOnce({ user: { id: intruder.id, username: intruder.username, role: "USER" } } as never);

    const r = await withdrawClaim({ claimId: c.claimId!, contractorId: contractor.id });
    expect(r.ok).toBe(false);
  });

  it("refuses if claim not PENDING", async () => {
    const { br } = await seedHomeowner();
    const { user, contractor } = await seedContractor({ username: "ctr_wd3" });
    mockedAuth.mockResolvedValue({ user: { id: user.id, username: user.username, role: "USER" } } as never);
    const c = await expressInterest({ buildRequestId: br.id, contractorId: contractor.id });
    await prisma.buildRequestClaim.update({ where: { id: c.claimId! }, data: { status: "ACCEPTED" } });

    const r = await withdrawClaim({ claimId: c.claimId!, contractorId: contractor.id });
    expect(r.ok).toBe(false);
  });
});
