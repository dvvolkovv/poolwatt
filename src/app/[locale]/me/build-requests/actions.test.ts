import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createBuildRequest, updateBuildRequest, cancelBuildRequest } from "./actions";

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
