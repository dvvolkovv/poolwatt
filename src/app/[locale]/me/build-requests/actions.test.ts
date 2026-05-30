import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createBuildRequest, updateBuildRequest, cancelBuildRequest, acceptClaim } from "./actions";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));
vi.mock("@/lib/resend-build-request", () => ({
  sendBuildRequestNewToAdmin: vi.fn(),
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

const formInput = {
  source: "SOLAR" as const,
  peakKw: 5,
  wantPowerbank: false,
  wantEvCharger: false,
  evPublicForSale: false,
  country: "SK",
  city: "Bratislava",
  addressLine: "Hlavná 1",
  siteType: "PRIVATE_HOUSE" as const,
  roofOrientation: "S" as const,
  budget: "AWAITING_QUOTE" as const,
  timeline: "EXPLORING" as const,
};

beforeEach(async () => {
  await prisma.buildRequest.deleteMany({ where: { user: { username: { startsWith: "test_br_" } } } });
});

describe("createBuildRequest", () => {
  it("rejects when not authenticated", async () => {
    mockedAuth.mockResolvedValueOnce(null as never);
    const r = await createBuildRequest(formInput);
    expect(r.ok).toBe(false);
    expect(r.formError).toMatch(/auth/i);
  });

  it("creates a request with status OPEN for an authed user", async () => {
    const u = await ensureUser("test_br_alice");
    mockedAuth.mockResolvedValueOnce({ user: { id: u.id, username: u.username, role: "USER" } } as never);

    const r = await createBuildRequest(formInput);

    expect(r.ok).toBe(true);
    expect(r.id).toBeDefined();
    const stored = await prisma.buildRequest.findUniqueOrThrow({ where: { id: r.id! } });
    expect(stored.status).toBe("OPEN");
    expect(stored.userId).toBe(u.id);
    expect(stored.peakKw.toNumber()).toBe(5);
  });

  it("returns fieldErrors on invalid input", async () => {
    const u = await ensureUser("test_br_bob");
    mockedAuth.mockResolvedValueOnce({ user: { id: u.id, username: u.username, role: "USER" } } as never);

    const r = await createBuildRequest({ ...formInput, peakKw: 0.1 });
    expect(r.ok).toBe(false);
    expect(r.fieldErrors?.peakKw).toBeDefined();
  });
});

describe("updateBuildRequest", () => {
  it("updates an OPEN request owned by the user", async () => {
    const u = await ensureUser("test_br_carol");
    mockedAuth.mockResolvedValue({ user: { id: u.id, username: u.username, role: "USER" } } as never);

    const created = await createBuildRequest(formInput);
    const r = await updateBuildRequest(created.id!, { ...formInput, peakKw: 8 });

    expect(r.ok).toBe(true);
    const reloaded = await prisma.buildRequest.findUniqueOrThrow({ where: { id: created.id! } });
    expect(reloaded.peakKw.toNumber()).toBe(8);
  });

  it("refuses to update a non-OPEN request", async () => {
    const u = await ensureUser("test_br_dave");
    mockedAuth.mockResolvedValue({ user: { id: u.id, username: u.username, role: "USER" } } as never);

    const created = await createBuildRequest(formInput);
    await prisma.buildRequest.update({
      where: { id: created.id! },
      data: { status: "MATCHED" },
    });

    const r = await updateBuildRequest(created.id!, { ...formInput, peakKw: 8 });
    expect(r.ok).toBe(false);
    expect(r.formError).toMatch(/cannot edit/i);
  });

  it("refuses to update someone else's request", async () => {
    const owner = await ensureUser("test_br_eve");
    mockedAuth.mockResolvedValueOnce({ user: { id: owner.id, username: owner.username, role: "USER" } } as never);
    const created = await createBuildRequest(formInput);

    const intruder = await ensureUser("test_br_frank");
    mockedAuth.mockResolvedValueOnce({ user: { id: intruder.id, username: intruder.username, role: "USER" } } as never);

    const r = await updateBuildRequest(created.id!, { ...formInput, peakKw: 8 });
    expect(r.ok).toBe(false);
    expect(r.formError).toMatch(/not found|forbidden/i);
  });
});

describe("cancelBuildRequest", () => {
  it("cancels an OPEN request", async () => {
    const u = await ensureUser("test_br_grace");
    mockedAuth.mockResolvedValue({ user: { id: u.id, username: u.username, role: "USER" } } as never);
    const created = await createBuildRequest(formInput);

    const r = await cancelBuildRequest(created.id!);
    expect(r.ok).toBe(true);
    const reloaded = await prisma.buildRequest.findUniqueOrThrow({ where: { id: created.id! } });
    expect(reloaded.status).toBe("CANCELLED");
    expect(reloaded.statusChangedById).toBe(u.id);
  });

  it("cancels a MATCHED request", async () => {
    const u = await ensureUser("test_br_henry");
    mockedAuth.mockResolvedValue({ user: { id: u.id, username: u.username, role: "USER" } } as never);
    const created = await createBuildRequest(formInput);
    await prisma.buildRequest.update({ where: { id: created.id! }, data: { status: "MATCHED" } });

    const r = await cancelBuildRequest(created.id!);
    expect(r.ok).toBe(true);
  });

  it("refuses to cancel a FULFILLED request", async () => {
    const u = await ensureUser("test_br_ivy");
    mockedAuth.mockResolvedValue({ user: { id: u.id, username: u.username, role: "USER" } } as never);
    const created = await createBuildRequest(formInput);
    await prisma.buildRequest.update({ where: { id: created.id! }, data: { status: "FULFILLED" } });

    const r = await cancelBuildRequest(created.id!);
    expect(r.ok).toBe(false);
  });
});

describe("acceptClaim", () => {
  async function setupBrAndClaims(opts: { count: number }) {
    const owner = await ensureUser("test_br_accept_owner");
    mockedAuth.mockResolvedValue({ user: { id: owner.id, username: owner.username, role: "USER" } } as never);
    const created = await createBuildRequest(formInput);
    const claimIds: string[] = [];
    for (let i = 0; i < opts.count; i++) {
      const ctrUser = await prisma.user.upsert({
        where: { username: `test_br_accept_ctr_${i}` },
        update: {},
        create: { username: `test_br_accept_ctr_${i}`, passwordHash: "x" },
      });
      const ctr = await prisma.contractor.create({
        data: {
          slug: `test_br_accept_slug_${Date.now()}_${i}`,
          entityType: "INDIVIDUAL",
          displayName: `AcceptCo ${i}`,
          country: "SK",
          city: "Bratislava",
          workCategories: ["INSTALLATION"],
          renewableTypes: ["SOLAR"],
          countriesServed: ["SK"],
          bio: "x".repeat(150),
          contactEmail: `c${i}@x.test`,
          contactPhone: "+421900000000",
          status: "APPROVED",
        },
      });
      await prisma.contractorMember.create({ data: { contractorId: ctr.id, userId: ctrUser.id, role: "OWNER" } });
      const claim = await prisma.buildRequestClaim.create({
        data: { buildRequestId: created.id!, contractorId: ctr.id, status: "PENDING" },
      });
      claimIds.push(claim.id);
    }
    return { owner, brId: created.id!, claimIds };
  }

  it("happy path: ACCEPTED claim + siblings REJECTED + BR MATCHED", async () => {
    const { brId, claimIds } = await setupBrAndClaims({ count: 3 });

    const r = await acceptClaim(claimIds[0]);
    expect(r.ok).toBe(true);

    const accepted = await prisma.buildRequestClaim.findUniqueOrThrow({ where: { id: claimIds[0] } });
    expect(accepted.status).toBe("ACCEPTED");
    expect(accepted.respondedAt).not.toBeNull();

    const rej1 = await prisma.buildRequestClaim.findUniqueOrThrow({ where: { id: claimIds[1] } });
    const rej2 = await prisma.buildRequestClaim.findUniqueOrThrow({ where: { id: claimIds[2] } });
    expect(rej1.status).toBe("REJECTED");
    expect(rej2.status).toBe("REJECTED");

    const br = await prisma.buildRequest.findUniqueOrThrow({ where: { id: brId } });
    expect(br.status).toBe("MATCHED");
  });

  it("rejects when caller is not the BR owner", async () => {
    const { claimIds } = await setupBrAndClaims({ count: 1 });
    const intruder = await ensureUser("test_br_accept_intruder");
    mockedAuth.mockResolvedValueOnce({ user: { id: intruder.id, username: intruder.username, role: "USER" } } as never);

    const r = await acceptClaim(claimIds[0]);
    expect(r.ok).toBe(false);
  });

  it("rejects when claim is not PENDING", async () => {
    const { claimIds } = await setupBrAndClaims({ count: 1 });
    await prisma.buildRequestClaim.update({ where: { id: claimIds[0] }, data: { status: "WITHDRAWN" } });

    const r = await acceptClaim(claimIds[0]);
    expect(r.ok).toBe(false);
  });

  it("rejects when BR is not OPEN", async () => {
    const { brId, claimIds } = await setupBrAndClaims({ count: 1 });
    await prisma.buildRequest.update({ where: { id: brId }, data: { status: "CANCELLED" } });

    const r = await acceptClaim(claimIds[0]);
    expect(r.ok).toBe(false);
  });
});
