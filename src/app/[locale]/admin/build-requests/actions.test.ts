import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { adminSetBuildRequestStatus } from "./actions";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/resend-build-request", () => ({
  sendBuildRequestStatusChangedToOwner: vi.fn(),
}));

import { auth } from "@/lib/auth";
const mockedAuth = vi.mocked(auth);

async function setupOwnerAndRequest() {
  const owner = await prisma.user.upsert({
    where: { username: "test_admin_owner" },
    update: {},
    create: { username: "test_admin_owner", passwordHash: "x" },
  });
  return prisma.buildRequest.create({
    data: {
      userId: owner.id,
      source: "SOLAR",
      peakKw: 5,
      country: "SK",
      city: "BA",
      addressLine: "Hlavná 1",
      siteType: "PRIVATE_HOUSE",
      roofOrientation: "S",
    },
  });
}

async function seedAdmin() {
  return prisma.user.upsert({
    where: { username: "test_admin_user" },
    update: { role: "ADMIN" },
    create: { username: "test_admin_user", passwordHash: "x", role: "ADMIN" },
  });
}

describe("adminSetBuildRequestStatus", () => {
  beforeEach(async () => {
    await prisma.buildRequest.deleteMany({ where: { user: { username: { startsWith: "test_admin_" } } } });
  });

  it("rejects non-admin sessions", async () => {
    const req = await setupOwnerAndRequest();
    mockedAuth.mockResolvedValueOnce({ user: { id: "x", username: "x", role: "USER" } } as never);

    const r = await adminSetBuildRequestStatus(req.id, "MATCHED", "contacted X");
    expect(r.ok).toBe(false);
    expect(r.formError).toMatch(/admin/i);
  });

  it("transitions OPEN → MATCHED with adminNote", async () => {
    const req = await setupOwnerAndRequest();
    const admin = await seedAdmin();
    mockedAuth.mockResolvedValueOnce({ user: { id: admin.id, username: admin.username, role: "ADMIN" } } as never);

    const r = await adminSetBuildRequestStatus(req.id, "MATCHED", "contacted SolarCo");
    expect(r.ok).toBe(true);
    const reloaded = await prisma.buildRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(reloaded.status).toBe("MATCHED");
    expect(reloaded.adminNote).toBe("contacted SolarCo");
    expect(reloaded.statusChangedById).toBe(admin.id);
  });

  it("requires adminNote for MATCHED transition", async () => {
    const req = await setupOwnerAndRequest();
    const admin = await seedAdmin();
    mockedAuth.mockResolvedValueOnce({ user: { id: admin.id, username: admin.username, role: "ADMIN" } } as never);

    const r = await adminSetBuildRequestStatus(req.id, "MATCHED");
    expect(r.ok).toBe(false);
    expect(r.fieldErrors?.adminNote).toBeDefined();
  });

  it("rejects FULFILLED → OPEN", async () => {
    const req = await setupOwnerAndRequest();
    await prisma.buildRequest.update({ where: { id: req.id }, data: { status: "FULFILLED" } });
    const admin = await seedAdmin();
    mockedAuth.mockResolvedValueOnce({ user: { id: admin.id, username: admin.username, role: "ADMIN" } } as never);

    const r = await adminSetBuildRequestStatus(req.id, "OPEN");
    expect(r.ok).toBe(false);
    expect(r.formError).toMatch(/transition/i);
  });
});
