import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createContractor, updateContractor, withdrawContractor } from "./actions";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/resend-contractor", () => ({
  sendContractorNewToAdmin: vi.fn(),
  sendContractorStatusChangedToOwner: vi.fn(),
  sendContractorWithdrawnToAdmin: vi.fn(),
}));

import { auth } from "@/lib/auth";
const mockedAuth = vi.mocked(auth);

async function ensureUser(username: string) {
  return prisma.user.upsert({
    where: { username },
    update: {},
    create: { username, passwordHash: "x" },
  });
}

const baseInput = {
  entityType: "LEGAL_ENTITY" as const,
  displayName: "TestCo s.r.o.",
  legalName: "TestCo Renewable Energy s.r.o.",
  registrationNumber: "12345678",
  country: "SK",
  city: "Bratislava",
  foundedYear: 2020,
  workCategories: ["DESIGN", "INSTALLATION"] as const,
  renewableTypes: ["SOLAR"] as const,
  countriesServed: ["SK", "CZ"] as const,
  bio: "We design and install solar power stations across Slovakia and Czech Republic. ".repeat(3),
  contactEmail: "info@testco.sk",
  contactPhone: "+421900000001",
};

beforeEach(async () => {
  await prisma.contractor.deleteMany({ where: { members: { some: { user: { username: { startsWith: "test_ctr_" } } } } } });
});

describe("createContractor", () => {
  it("rejects when not authenticated", async () => {
    mockedAuth.mockResolvedValueOnce(null as never);
    const r = await createContractor(baseInput);
    expect(r.ok).toBe(false);
    expect(r.formError).toMatch(/auth/i);
  });

  it("creates a contractor with status PENDING and OWNER member for an authed user", async () => {
    const u = await ensureUser("test_ctr_alice");
    mockedAuth.mockResolvedValueOnce({ user: { id: u.id, username: u.username, role: "USER" } } as never);

    const r = await createContractor(baseInput);
    expect(r.ok).toBe(true);
    expect(r.id).toBeDefined();

    const stored = await prisma.contractor.findUniqueOrThrow({
      where: { id: r.id! },
      include: { members: true },
    });
    expect(stored.status).toBe("PENDING");
    expect(stored.displayName).toBe("TestCo s.r.o.");
    expect(stored.slug).toMatch(/^testco/);
    expect(stored.members).toHaveLength(1);
    expect(stored.members[0].userId).toBe(u.id);
    expect(stored.members[0].role).toBe("OWNER");
  });

  it("generates collision-suffixed slug if displayName collides", async () => {
    const u1 = await ensureUser("test_ctr_bob");
    mockedAuth.mockResolvedValueOnce({ user: { id: u1.id, username: u1.username, role: "USER" } } as never);
    const r1 = await createContractor(baseInput);
    expect(r1.ok).toBe(true);
    const c1 = await prisma.contractor.findUniqueOrThrow({ where: { id: r1.id! } });

    const u2 = await ensureUser("test_ctr_carol");
    mockedAuth.mockResolvedValueOnce({ user: { id: u2.id, username: u2.username, role: "USER" } } as never);
    const r2 = await createContractor(baseInput);
    expect(r2.ok).toBe(true);
    const c2 = await prisma.contractor.findUniqueOrThrow({ where: { id: r2.id! } });

    expect(c2.slug).not.toBe(c1.slug);
    expect(c2.slug).toMatch(/-2$/);
  });

  it("returns fieldErrors on invalid input", async () => {
    const u = await ensureUser("test_ctr_dave");
    mockedAuth.mockResolvedValueOnce({ user: { id: u.id, username: u.username, role: "USER" } } as never);

    const r = await createContractor({ ...baseInput, bio: "too short" });
    expect(r.ok).toBe(false);
    expect(r.fieldErrors?.bio).toBeDefined();
  });
});

describe("updateContractor", () => {
  it("updates a PENDING contractor when caller is OWNER", async () => {
    const u = await ensureUser("test_ctr_eve");
    mockedAuth.mockResolvedValue({ user: { id: u.id, username: u.username, role: "USER" } } as never);
    const created = await createContractor(baseInput);

    const r = await updateContractor(created.id!, { ...baseInput, displayName: "TestCo Renamed s.r.o." });
    expect(r.ok).toBe(true);
    const reloaded = await prisma.contractor.findUniqueOrThrow({ where: { id: created.id! } });
    expect(reloaded.displayName).toBe("TestCo Renamed s.r.o.");
  });

  it("refuses to update a non-PENDING contractor", async () => {
    const u = await ensureUser("test_ctr_frank");
    mockedAuth.mockResolvedValue({ user: { id: u.id, username: u.username, role: "USER" } } as never);
    const created = await createContractor(baseInput);
    await prisma.contractor.update({ where: { id: created.id! }, data: { status: "APPROVED" } });

    const r = await updateContractor(created.id!, { ...baseInput, displayName: "Should fail" });
    expect(r.ok).toBe(false);
    expect(r.formError).toMatch(/cannot edit/i);
  });

  it("refuses to update when caller is not OWNER", async () => {
    const owner = await ensureUser("test_ctr_grace");
    mockedAuth.mockResolvedValueOnce({ user: { id: owner.id, username: owner.username, role: "USER" } } as never);
    const created = await createContractor(baseInput);

    const intruder = await ensureUser("test_ctr_henry");
    mockedAuth.mockResolvedValueOnce({ user: { id: intruder.id, username: intruder.username, role: "USER" } } as never);

    const r = await updateContractor(created.id!, { ...baseInput, displayName: "Stealing" });
    expect(r.ok).toBe(false);
    expect(r.formError).toMatch(/not found|forbidden/i);
  });
});

describe("withdrawContractor", () => {
  it("deletes a PENDING contractor and its members", async () => {
    const u = await ensureUser("test_ctr_ivy");
    mockedAuth.mockResolvedValue({ user: { id: u.id, username: u.username, role: "USER" } } as never);
    const created = await createContractor(baseInput);

    const r = await withdrawContractor(created.id!);
    expect(r.ok).toBe(true);

    const reloaded = await prisma.contractor.findUnique({ where: { id: created.id! } });
    expect(reloaded).toBeNull();
    const memberRows = await prisma.contractorMember.findMany({
      where: { contractorId: created.id! },
    });
    expect(memberRows).toHaveLength(0);
  });

  it("refuses to withdraw a non-PENDING contractor", async () => {
    const u = await ensureUser("test_ctr_jake");
    mockedAuth.mockResolvedValue({ user: { id: u.id, username: u.username, role: "USER" } } as never);
    const created = await createContractor(baseInput);
    await prisma.contractor.update({ where: { id: created.id! }, data: { status: "APPROVED" } });

    const r = await withdrawContractor(created.id!);
    expect(r.ok).toBe(false);
  });

  it("refuses to withdraw when caller is not OWNER", async () => {
    const owner = await ensureUser("test_ctr_kara");
    mockedAuth.mockResolvedValueOnce({ user: { id: owner.id, username: owner.username, role: "USER" } } as never);
    const created = await createContractor(baseInput);

    const intruder = await ensureUser("test_ctr_liam");
    mockedAuth.mockResolvedValueOnce({ user: { id: intruder.id, username: intruder.username, role: "USER" } } as never);

    const r = await withdrawContractor(created.id!);
    expect(r.ok).toBe(false);
  });
});
