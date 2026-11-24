import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/password";

let mockUserId: string | null = null;
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (mockUserId ? { user: { id: mockUserId } } : null)),
  signOut: vi.fn(),
}));

import { changePasswordAction, setPasswordAction, unlinkTalerIdAction } from "./actions";

const PREFIX = "tid_settings_";

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

const cleanup = () => prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });

async function makeUser(name: string, passwordHash: string | null) {
  const user = await prisma.user.create({
    data: {
      username: PREFIX + name,
      passwordHash,
      accounts: {
        create: [
          { type: "oidc", provider: "talerid", providerAccountId: `${PREFIX}${name}` },
          { type: "oidc", provider: "other", providerAccountId: `${PREFIX}${name}` },
        ],
      },
    },
  });
  return user.id;
}

const hashOf = async (id: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id } })).passwordHash;

const providersOf = async (id: string) =>
  (await prisma.account.findMany({ where: { userId: id }, orderBy: { provider: "asc" } })).map(
    (a) => a.provider,
  );

beforeEach(async () => {
  mockUserId = null;
  await cleanup();
});
afterAll(cleanup);

describe("setPasswordAction", () => {
  it("sets a password on an account without one", async () => {
    mockUserId = await makeUser("a", null);
    expect(await setPasswordAction({}, form({ newPassword: "sunny-day-1" }))).toEqual({ ok: true });
    expect(await verifyPassword("sunny-day-1", (await hashOf(mockUserId))!)).toBe(true);
  });

  it("never replaces an existing password", async () => {
    const hash = await hashPassword("original-1");
    mockUserId = await makeUser("a", hash);
    const result = await setPasswordAction({}, form({ newPassword: "sunny-day-1" }));
    expect(result.ok).toBeUndefined();
    expect(result.formError).toBeTruthy();
    expect(await hashOf(mockUserId)).toBe(hash);
  });

  it("applies the registration password rules", async () => {
    mockUserId = await makeUser("a", null);
    for (const newPassword of ["", "short1", "onlyletters", "12345678"]) {
      const result = await setPasswordAction({}, form({ newPassword }));
      expect(result.fieldErrors?.newPassword, newPassword).toBeTruthy();
    }
    expect(await hashOf(mockUserId)).toBeNull();
  });

  it("needs a session", async () => {
    const id = await makeUser("a", null);
    expect((await setPasswordAction({}, form({ newPassword: "sunny-day-1" }))).formError).toBeTruthy();
    expect(await hashOf(id)).toBeNull();
  });
});

describe("changePasswordAction", () => {
  it("does not crash or set anything on an account without a password", async () => {
    mockUserId = await makeUser("a", null);
    const result = await changePasswordAction(
      {},
      form({ currentPassword: "anything", newPassword: "sunny-day-1" }),
    );
    expect(result.formError).toBeTruthy();
    expect(await hashOf(mockUserId)).toBeNull();
  });
});

describe("unlinkTalerIdAction", () => {
  it("removes only the caller's Taler ID link", async () => {
    const other = await makeUser("b", "x");
    mockUserId = await makeUser("a", "x");
    expect(await unlinkTalerIdAction()).toEqual({ ok: true });
    expect(await providersOf(mockUserId)).toEqual(["other"]);
    expect(await providersOf(other)).toEqual(["other", "talerid"]);
  });

  it("refuses when it would leave no way to sign in", async () => {
    mockUserId = await makeUser("a", null);
    expect((await unlinkTalerIdAction()).formError).toBe("password_required");
    expect(await providersOf(mockUserId)).toEqual(["other", "talerid"]);
  });

  it("needs a session", async () => {
    const id = await makeUser("a", "x");
    expect((await unlinkTalerIdAction()).formError).toBeTruthy();
    expect(await providersOf(id)).toEqual(["other", "talerid"]);
  });
});
