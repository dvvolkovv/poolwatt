import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createBuildRequest } from "./actions";

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

describe("createBuildRequest", () => {
  beforeEach(async () => {
    await prisma.buildRequest.deleteMany({ where: { user: { username: { startsWith: "test_br_" } } } });
  });

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
