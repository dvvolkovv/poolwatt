import { beforeEach, describe, expect, it, vi } from "vitest";

const { user, signIn, issue, limit } = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), create: vi.fn() },
  signIn: vi.fn(),
  issue: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { user } }));
vi.mock("@/lib/auth", () => ({ signIn }));
vi.mock("@/lib/password", () => ({ hashPassword: async () => "hash" }));
vi.mock("@/lib/email-verification", () => ({ issueEmailVerification: issue, verificationLimitReached: limit }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { registerAction } from "./actions";

function form(over: Record<string, string> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ username: "solar_jane", email: "Jane@Example.com", password: "Pass1234", locale: "uk", ...over })) f.set(k, v);
  return f;
}

beforeEach(() => {
  user.findUnique.mockResolvedValue(null);
  user.create.mockResolvedValue({ id: "u1" });
  issue.mockResolvedValue(true);
  limit.mockResolvedValue(false);
});

describe("registerAction", () => {
  it.each(["", "not-an-email"])("rejects email %j without creating a user", async (email) => {
    const r = await registerAction({}, form({ email }));
    expect(r.fieldErrors?.email).toBeTruthy();
    expect(user.create).not.toHaveBeenCalled();
  });

  it("creates the user in the page language and mails the confirmation", async () => {
    await registerAction({}, form());
    expect(user.create.mock.calls[0][0].data).toMatchObject({ username: "solar_jane", preferredLocale: "uk" });
    // Unconfirmed addresses must not land on the account.
    expect(user.create.mock.calls[0][0].data).not.toHaveProperty("email");
    expect(issue).toHaveBeenCalledWith("u1", "jane@example.com", "uk");
    expect(signIn).toHaveBeenCalledWith("credentials", expect.objectContaining({ redirectTo: "/uk/me?welcome=1" }));
  });

  it("still signs the user in when the mail fails", async () => {
    issue.mockResolvedValue(false);
    await registerAction({}, form());
    expect(signIn).toHaveBeenCalled();
  });

  it("rejects an email that belongs to another account", async () => {
    user.findUnique.mockImplementation(async ({ where }) => (where.email ? { id: "other" } : null));
    expect((await registerAction({}, form())).fieldErrors?.email).toBeTruthy();
    expect(user.create).not.toHaveBeenCalled();
  });

  it("stops repeated mails to one address", async () => {
    limit.mockResolvedValue(true);
    expect((await registerAction({}, form())).fieldErrors?.email).toBeTruthy();
    expect(user.create).not.toHaveBeenCalled();
  });

  it("ignores a forged locale", async () => {
    await registerAction({}, form({ locale: "//evil.test" }));
    expect(signIn).toHaveBeenCalledWith("credentials", expect.objectContaining({ redirectTo: "/en/me?welcome=1" }));
  });
});
