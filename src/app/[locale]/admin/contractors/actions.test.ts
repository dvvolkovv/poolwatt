import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { adminSetContractorStatus } from "./actions";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/resend-contractor", () => ({
  sendContractorNewToAdmin: vi.fn(),
  sendContractorStatusChangedToOwner: vi.fn(),
  sendContractorWithdrawnToAdmin: vi.fn(),
}));

import { auth } from "@/lib/auth";
const mockedAuth = vi.mocked(auth);

async function setupContractor() {
  const owner = await prisma.user.upsert({
    where: { username: "test_admin_ctr_owner" },
    update: {},
    create: { username: "test_admin_ctr_owner", passwordHash: "x" },
  });
  const c = await prisma.contractor.create({
    data: {
      slug: `test-admin-ctr-${Date.now()}`,
      entityType: "INDIVIDUAL",
      displayName: "Admin Test Contractor",
      country: "SK",
      city: "Bratislava",
      workCategories: ["INSTALLATION"],
      renewableTypes: ["SOLAR"],
      countriesServed: ["SK"],
      bio: "x".repeat(150),
      contactEmail: "info@admin-test.sk",
      contactPhone: "+421900000099",
    },
  });
  await prisma.contractorMember.create({
    data: { contractorId: c.id, userId: owner.id, role: "OWNER" },
  });
  return c;
}

async function seedAdmin() {
  return prisma.user.upsert({
    where: { username: "test_admin_ctr_user" },
    update: { role: "ADMIN" },
    create: { username: "test_admin_ctr_user", passwordHash: "x", role: "ADMIN" },
  });
}

beforeEach(async () => {
  await prisma.contractor.deleteMany({ where: { members: { some: { user: { username: { startsWith: "test_admin_ctr_" } } } } } });
});

describe("adminSetContractorStatus", () => {
  it("rejects non-admin sessions", async () => {
    const c = await setupContractor();
    mockedAuth.mockResolvedValueOnce({ user: { id: "x", username: "x", role: "USER" } } as never);

    const r = await adminSetContractorStatus(c.id, "APPROVED", "ok");
    expect(r.ok).toBe(false);
    expect(r.formError).toMatch(/admin/i);
  });

  it("transitions PENDING → APPROVED with adminNote", async () => {
    const c = await setupContractor();
    const admin = await seedAdmin();
    mockedAuth.mockResolvedValueOnce({ user: { id: admin.id, username: admin.username, role: "ADMIN" } } as never);

    const r = await adminSetContractorStatus(c.id, "APPROVED", "looks good");
    expect(r.ok).toBe(true);
    const reloaded = await prisma.contractor.findUniqueOrThrow({ where: { id: c.id } });
    expect(reloaded.status).toBe("APPROVED");
    expect(reloaded.adminNote).toBe("looks good");
    expect(reloaded.reviewedById).toBe(admin.id);
  });

  it("requires adminNote (non-empty after trim)", async () => {
    const c = await setupContractor();
    const admin = await seedAdmin();
    mockedAuth.mockResolvedValueOnce({ user: { id: admin.id, username: admin.username, role: "ADMIN" } } as never);

    const r = await adminSetContractorStatus(c.id, "APPROVED", "   ");
    expect(r.ok).toBe(false);
    expect(r.fieldErrors?.adminNote).toBeDefined();
  });

  it("rejects transition from APPROVED", async () => {
    const c = await setupContractor();
    await prisma.contractor.update({ where: { id: c.id }, data: { status: "APPROVED" } });
    const admin = await seedAdmin();
    mockedAuth.mockResolvedValueOnce({ user: { id: admin.id, username: admin.username, role: "ADMIN" } } as never);

    const r = await adminSetContractorStatus(c.id, "REJECTED", "changed mind");
    expect(r.ok).toBe(false);
    expect(r.formError).toMatch(/transition/i);
  });

  it("rejects unsupported transition target", async () => {
    const c = await setupContractor();
    const admin = await seedAdmin();
    mockedAuth.mockResolvedValueOnce({ user: { id: admin.id, username: admin.username, role: "ADMIN" } } as never);

    const r = await adminSetContractorStatus(c.id, "SUSPENDED" as never, "test");
    expect(r.ok).toBe(false);
  });
});
