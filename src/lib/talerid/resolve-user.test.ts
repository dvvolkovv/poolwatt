import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { findTalerIdUser, resolveTalerIdUser } from "./resolve-user";

const P = "talerid-resolve-test";
const sub = (n: string | number) => `${P}-${n}`;
const mail = (n: string) => `${n}@${P}.example`;
const claims = (n: string | number, over: { name?: string | null; email?: string | null } = {}) => ({
  sub: sub(n),
  name: `Tid Resolve ${n}`,
  email: null,
  ...over,
});

async function cleanup() {
  await prisma.user.deleteMany({
    where: {
      OR: [
        { accounts: { some: { providerAccountId: { startsWith: P } } } },
        { email: { endsWith: `@${P}.example` } },
        { username: { startsWith: "tid-" } },
      ],
    },
  });
}

const localUser = (username: string, email: string | null = null) =>
  prisma.user.create({
    data: { username, passwordHash: "x", email, emailVerified: email ? new Date() : null },
  });

const load = (id: string) =>
  prisma.user.findUniqueOrThrow({ where: { id }, include: { accounts: true } });

function idOf(result: Awaited<ReturnType<typeof resolveTalerIdUser>>): string {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.userId;
}

beforeEach(cleanup);
afterAll(cleanup);

describe("register", () => {
  it("creates a passwordless account with a verified email", async () => {
    const user = await load(idOf(await resolveTalerIdUser(claims(1, { email: mail("a") }))));
    expect(user).toMatchObject({
      username: "tid-resolve-1",
      name: "Tid Resolve 1",
      email: mail("a"),
      passwordHash: null,
      role: "USER",
    });
    expect(user.emailVerified).toBeInstanceOf(Date);
  });

  it("stores the link and no tokens", async () => {
    const user = await load(idOf(await resolveTalerIdUser(claims(1))));
    expect(user.accounts).toHaveLength(1);
    expect(user.accounts[0]).toMatchObject({
      provider: "talerid",
      providerAccountId: sub(1),
      access_token: null,
      refresh_token: null,
      id_token: null,
    });
  });

  it("creates an account without email when there is no verified one", async () => {
    const user = await load(idOf(await resolveTalerIdUser(claims(1))));
    expect(user.email).toBeNull();
    expect(user.emailVerified).toBeNull();
  });

  it("suffixes a nickname that is taken", async () => {
    await localUser("tid-resolve-1");
    const user = await load(idOf(await resolveTalerIdUser(claims(1))));
    expect(user.username).toMatch(/^tid-resolve-1-[0-9a-f]{6}$/);
  });

  it("refuses an email that belongs to another account and creates nothing", async () => {
    await localUser("tid-owner", mail("a"));
    const result = await resolveTalerIdUser(claims(1, { email: mail("a") }));
    expect(result).toEqual({ ok: false, reason: "email_taken" });
    expect(await findTalerIdUser(sub(1))).toBeNull();
  });
});

describe("sign in", () => {
  it("returns the same account every time", async () => {
    const first = idOf(await resolveTalerIdUser(claims(1)));
    const second = idOf(await resolveTalerIdUser(claims(1, { name: "Renamed", email: mail("new") })));
    expect(second).toBe(first);
  });

  it("leaves local name and email alone on later sign-ins", async () => {
    const id = idOf(await resolveTalerIdUser(claims(1)));
    await resolveTalerIdUser(claims(1, { name: "Renamed", email: mail("new") }));
    expect(await load(id)).toMatchObject({ name: "Tid Resolve 1", email: null });
  });

  it("still works when the Taler ID email is later taken here", async () => {
    const id = idOf(await resolveTalerIdUser(claims(1)));
    await localUser("tid-owner", mail("a"));
    expect(idOf(await resolveTalerIdUser(claims(1, { email: mail("a") })))).toBe(id);
  });

  it("gives concurrent first sign-ins one account", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => resolveTalerIdUser(claims(1, { email: mail("a") }))),
    );
    expect(new Set(results.map(idOf)).size).toBe(1);
    expect(await prisma.user.count({ where: { username: { startsWith: "tid-resolve-1" } } })).toBe(1);
  });

  it("gives different people with one name different accounts", async () => {
    const results = await Promise.all(
      [1, 2, 3, 4].map((n) => resolveTalerIdUser(claims(n, { name: "Tid Same" }))),
    );
    expect(new Set(results.map(idOf)).size).toBe(4);
  });
});

describe("link", () => {
  it("attaches a Taler ID and leaves the account as it was", async () => {
    const me = await localUser("tid-me");
    const result = await resolveTalerIdUser(claims(1, { email: mail("a") }), { linkToUserId: me.id });
    expect(idOf(result)).toBe(me.id);
    const after = await load(me.id);
    expect(after).toMatchObject({ username: "tid-me", name: null, email: null, passwordHash: "x" });
    expect(after.accounts.map((a) => a.providerAccountId)).toEqual([sub(1)]);
  });

  it("is idempotent", async () => {
    const me = await localUser("tid-me");
    await resolveTalerIdUser(claims(1), { linkToUserId: me.id });
    expect(idOf(await resolveTalerIdUser(claims(1), { linkToUserId: me.id }))).toBe(me.id);
  });

  it("works when the email is my own", async () => {
    const me = await localUser("tid-me", mail("a"));
    expect(idOf(await resolveTalerIdUser(claims(1, { email: mail("a") }), { linkToUserId: me.id }))).toBe(me.id);
  });

  it("refuses a Taler ID that belongs to someone else", async () => {
    const other = idOf(await resolveTalerIdUser(claims(1)));
    const me = await localUser("tid-me");
    const result = await resolveTalerIdUser(claims(1), { linkToUserId: me.id });
    expect(result).toEqual({ ok: false, reason: "talerid_taken" });
    expect((await findTalerIdUser(sub(1)))?.id).toBe(other);
  });

  it("refuses a second Taler ID on one account", async () => {
    const me = await localUser("tid-me");
    await resolveTalerIdUser(claims(1), { linkToUserId: me.id });
    const result = await resolveTalerIdUser(claims(2), { linkToUserId: me.id });
    expect(result).toEqual({ ok: false, reason: "already_linked" });
  });

  it("never creates an account", async () => {
    const before = await prisma.user.count();
    await expect(resolveTalerIdUser(claims(1), { linkToUserId: "no-such-user" })).rejects.toThrow();
    expect(await prisma.user.count()).toBe(before);
  });
});
