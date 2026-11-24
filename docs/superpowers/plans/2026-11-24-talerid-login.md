# Taler ID login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sign in to and register on poolwatt.com with Taler ID, next to nickname + password.

**Architecture:** Auth.js v5 OIDC provider; our own `resolveTalerIdUser()` finds, creates or links the local user from the `signIn` callback. JWT sessions, no adapter, no stored provider tokens. Spec: `docs/superpowers/specs/2026-11-24-talerid-login-design.md`.

**Tech Stack:** Next.js 16, next-auth 5.0.0-beta.31, Prisma 5 / Postgres 16, next-intl 4, vitest 4.

**Never run the tests against production.** Vitest loads `.env.local`, so work in a clone without env files and pass a throwaway database:
`export DATABASE_URL=postgresql://poolwatt@127.0.0.1:54329/poolwatt_test OPENAI_API_KEY=unused`

---

## Files

| File | Responsibility |
|---|---|
| `src/lib/talerid/config.ts` | Provider definition, on/off switch, claim mapping |
| `src/lib/talerid/username.ts` | Nickname candidates for new accounts |
| `src/lib/talerid/link-intent.ts` | Sign / verify the "I asked to link" token (pure) |
| `src/lib/talerid/link-intent-cookie.ts` | Put that token in a cookie, take it out |
| `src/lib/talerid/resolve-user.ts` | Find / create / link the local user |
| `src/lib/talerid/errors.ts` | Error codes → message keys |
| `src/lib/safe-redirect.ts` | Accept only same-site paths as a return URL |
| `src/lib/auth.ts` | Wiring |
| `src/app/actions/talerid.ts` | Start sign-in, start linking |
| `src/app/[locale]/me/settings/actions.ts` | Unlink, set password |
| `src/components/talerid-panel.tsx`, `talerid-submit.tsx` | Button, hint, divider |
| `src/components/settings/talerid-section.tsx`, `set-password-section.tsx` | Settings UI |

---

### Task 1: Schema

**Files:** Modify `prisma/schema.prisma`; create `prisma/migrations/20261124123500_talerid_login/migration.sql`

- [ ] **Step 1:** In `model User` change `passwordHash String // bcryptjs hash` to `passwordHash String? // bcryptjs hash; null = signs in with Taler ID only`. In `model Account` add `@@unique([userId, provider])` after the existing unique.
- [ ] **Step 2:** Migration:

```sql
-- Accounts created through Taler ID have no password.
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- One linked identity per provider per user.
CREATE UNIQUE INDEX "Account_userId_provider_key" ON "Account"("userId", "provider");
```

- [ ] **Step 3:** `npx prisma migrate deploy && npx prisma generate && npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <empty db> --exit-code` → "No difference detected".
- [ ] **Step 4:** Guard the three places that read the hash (tsc lists them): credentials `authorize` returns null for a null hash, `changePasswordAction` returns `{ formError }`.
- [ ] **Step 5:** Commit `feat(auth): allow accounts without a password`.

### Task 2: Pure units

- [ ] **Step 1: failing tests**

```ts file=src/lib/talerid/username.test.ts
import { describe, expect, it } from "vitest";
import { usernameCandidates } from "./username";
import { usernameSchema } from "@/lib/validation";

const first = (name: string | null | undefined) => [...usernameCandidates(name)][0];

describe("usernameCandidates", () => {
  it("slugifies the name", () => {
    expect(first("Ivan Petrov")).toBe("ivan-petrov");
  });

  it("transliterates cyrillic", () => {
    expect(first("Иван Петров")).toBe("ivan-petrov");
  });

  it("adds random suffixes after the plain slug", () => {
    const all = [...usernameCandidates("Ivan Petrov")];
    expect(all[1]).toMatch(/^ivan-petrov-[0-9a-f]{6}$/);
    expect(new Set(all).size).toBe(all.length);
  });

  it("never offers a reserved nickname or one derived from it", () => {
    for (const c of usernameCandidates("Admin")) {
      expect(c).toMatch(/^user-[0-9a-f]{6}$/);
    }
  });

  it("falls back to user-<random> when the name has nothing usable", () => {
    for (const name of [null, undefined, "", "   ", "გიორგი", "🙂"]) {
      expect(first(name)).toMatch(/^user-[0-9a-f]{6}$/);
    }
  });

  it("suffixes names too short to stand alone", () => {
    expect(first("Li")).toMatch(/^li-[0-9a-f]{6}$/);
  });

  it("only yields nicknames the login form accepts", () => {
    const names = ["Ivan Petrov", "Li", "Admin", null, "A".repeat(200), "-- __ --", "Jean-Luc d'Été"];
    for (const name of names) {
      for (const c of usernameCandidates(name)) {
        expect(usernameSchema.safeParse(c).success, `${name} → ${c}`).toBe(true);
      }
    }
  });
});
```

```ts file=src/lib/talerid/config.test.ts
import { describe, expect, it } from "vitest";
import { isTalerIdEnabled, talerIdProvider, toTalerIdClaims } from "./config";

const env = { TALERID_CLIENT_ID: "id", TALERID_CLIENT_SECRET: "secret" };

describe("talerIdProvider", () => {
  it("is off unless both credentials are set", () => {
    for (const e of [{}, { TALERID_CLIENT_ID: "id" }, { TALERID_CLIENT_SECRET: "s" }, { ...env, TALERID_CLIENT_ID: "" }]) {
      expect(isTalerIdEnabled(e)).toBe(false);
      expect(talerIdProvider(e)).toBeNull();
    }
  });

  it("asks for identity, profile and email with every replay check on", () => {
    const p = talerIdProvider(env)!;
    expect(p.id).toBe("talerid");
    expect(p.issuer).toBe("https://api.talerid.io/oauth");
    expect(p.checks).toEqual(["pkce", "state", "nonce"]);
    expect(p.authorization).toEqual({ params: { scope: "openid profile email" } });
    expect(p.idToken).toBe(false);
  });

  it("can point at another issuer", () => {
    expect(talerIdProvider({ ...env, TALERID_ISSUER: "http://localhost:4000" })!.issuer).toBe("http://localhost:4000");
  });
});

describe("toTalerIdClaims", () => {
  it("keeps a verified email, normalised", () => {
    expect(toTalerIdClaims({ sub: "s", name: " Ivan Petrov ", email: " Ivan@Example.COM ", email_verified: true }))
      .toEqual({ sub: "s", name: "Ivan Petrov", email: "ivan@example.com" });
  });

  it("drops an email that is not explicitly verified", () => {
    for (const email_verified of [false, null, undefined, "true" as unknown as boolean]) {
      expect(toTalerIdClaims({ sub: "s", email: "a@b.co", email_verified }).email).toBeNull();
    }
  });

  it("drops a malformed email", () => {
    expect(toTalerIdClaims({ sub: "s", email: "nope", email_verified: true }).email).toBeNull();
  });

  it("builds the name from parts when there is no full name", () => {
    expect(toTalerIdClaims({ sub: "s", name: "", given_name: "Ivan", family_name: "Petrov" }).name).toBe("Ivan Petrov");
    expect(toTalerIdClaims({ sub: "s" }).name).toBeNull();
  });

  it("caps the name at what settings allow", () => {
    expect(toTalerIdClaims({ sub: "s", name: "x".repeat(200) }).name).toHaveLength(80);
  });

  it("refuses a profile without a subject", () => {
    expect(() => toTalerIdClaims({ sub: "" })).toThrow();
  });
});
```

```ts file=src/lib/talerid/link-intent.test.ts
import { describe, expect, it } from "vitest";
import { LINK_INTENT_TTL_MS, signLinkIntent, verifyLinkIntent } from "./link-intent";

const SECRET = "test-secret";
const NOW = 1_800_000_000_000;

describe("link intent", () => {
  it("round-trips the user id", () => {
    expect(verifyLinkIntent(signLinkIntent("user1", SECRET, NOW), SECRET, NOW + 1000)).toBe("user1");
  });

  it("expires", () => {
    const token = signLinkIntent("user1", SECRET, NOW);
    expect(verifyLinkIntent(token, SECRET, NOW + LINK_INTENT_TTL_MS + 1)).toBeNull();
  });

  it("rejects another secret", () => {
    expect(verifyLinkIntent(signLinkIntent("user1", "other", NOW), SECRET, NOW)).toBeNull();
  });

  it("rejects a swapped user id or a stretched expiry", () => {
    const [, exp, sig] = signLinkIntent("user1", SECRET, NOW).split(".");
    expect(verifyLinkIntent(`user2.${exp}.${sig}`, SECRET, NOW)).toBeNull();
    expect(verifyLinkIntent(`user1.${Number(exp) + 1}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it("rejects junk", () => {
    for (const v of [undefined, "", "a", "a.b", "a.b.c", "a.b.c.d", "user1.NaN.x", `user1.${NOW + 1}.`]) {
      expect(verifyLinkIntent(v, SECRET, NOW)).toBeNull();
    }
  });
});
```

```ts file=src/lib/talerid/errors.test.ts
import { describe, expect, it } from "vitest";
import { TALERID_REFUSAL_CODE, talerIdErrorKey } from "./errors";

describe("talerIdErrorKey", () => {
  it("has a message for every refusal", () => {
    expect(talerIdErrorKey(TALERID_REFUSAL_CODE.email_taken)).toBe("emailTaken");
    expect(talerIdErrorKey(TALERID_REFUSAL_CODE.talerid_taken)).toBe("taken");
    expect(talerIdErrorKey(TALERID_REFUSAL_CODE.already_linked)).toBe("alreadyLinked");
  });

  it("maps provider errors to 'cancelled'", () => {
    expect(talerIdErrorKey("OAuthCallbackError")).toBe("cancelled");
    expect(talerIdErrorKey("AccessDenied")).toBe("cancelled");
  });

  it("maps everything else to the generic message", () => {
    expect(talerIdErrorKey("Configuration")).toBe("failed");
    expect(talerIdErrorKey("<script>")).toBe("failed");
    expect(talerIdErrorKey("constructor")).toBe("failed");
  });

  it("stays quiet without a code or for password errors", () => {
    expect(talerIdErrorKey(undefined)).toBeNull();
    expect(talerIdErrorKey("")).toBeNull();
    expect(talerIdErrorKey("CredentialsSignin")).toBeNull();
  });

  it("uses the first of repeated parameters", () => {
    expect(talerIdErrorKey(["AccessDenied", "x"])).toBe("cancelled");
  });
});
```

```ts file=src/lib/safe-redirect.test.ts
import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it("keeps same-site paths", () => {
    expect(safeRedirectPath("/en/me/settings?x=1#a", "/en/me")).toBe("/en/me/settings?x=1#a");
  });

  it("falls back for anything that could leave the site", () => {
    for (const v of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "en/me", "", null, undefined, "/\tx", "/a\nb"]) {
      expect(safeRedirectPath(v, "/en/me")).toBe("/en/me");
    }
  });
});
```

- [ ] **Step 2:** `npx vitest run src/lib/talerid src/lib/safe-redirect.test.ts` → FAIL, modules not found.
- [ ] **Step 3: implementation**

```ts file=src/lib/talerid/config.ts
// Taler ID as an OpenID Connect provider for Auth.js.
// Integration guide: https://talerid.io/oauth-guide.html

import type { OIDCConfig } from "next-auth/providers";
import { emailSchema } from "@/lib/validation";

export const TALERID_PROVIDER_ID = "talerid";

/** Where a person without a Taler ID gets one — the sign-in page has no sign-up. */
export const TALERID_SIGNUP_URL = "https://talerid.io/download/";

const DEFAULT_ISSUER = "https://api.talerid.io/oauth";

/** Longest name the settings form accepts (nameSchema). */
const MAX_NAME = 80;

/** What /oauth/me returns for `openid profile email`. */
export interface TalerIdProfile {
  sub: string;
  name?: string | null;
  given_name?: string | null;
  family_name?: string | null;
  email?: string | null;
  email_verified?: boolean | null;
}

/** The part of a Taler ID profile we act on. */
export interface TalerIdClaims {
  sub: string;
  name: string | null;
  /** Non-null only when Taler ID says it is verified. */
  email: string | null;
}

type Env = Record<string, string | undefined>;

export function isTalerIdEnabled(env: Env = process.env): boolean {
  return Boolean(env.TALERID_CLIENT_ID && env.TALERID_CLIENT_SECRET);
}

export function talerIdProvider(env: Env = process.env): OIDCConfig<TalerIdProfile> | null {
  if (!isTalerIdEnabled(env)) return null;
  return {
    id: TALERID_PROVIDER_ID,
    name: "Taler ID",
    type: "oidc",
    issuer: env.TALERID_ISSUER || DEFAULT_ISSUER,
    clientId: env.TALERID_CLIENT_ID,
    clientSecret: env.TALERID_CLIENT_SECRET,
    authorization: { params: { scope: "openid profile email" } },
    checks: ["pkce", "state", "nonce"],
    // Read claims from /oauth/me: the ID token need not carry name and email.
    idToken: false,
    profile: (profile) => ({ id: profile.sub, name: profile.name ?? null }),
  };
}

export function toTalerIdClaims(profile: TalerIdProfile): TalerIdClaims {
  if (!profile.sub) throw new Error("[talerid] profile without sub");
  const parts = [profile.given_name, profile.family_name].filter(Boolean).join(" ");
  const name = (profile.name?.trim() || parts.trim()).slice(0, MAX_NAME) || null;
  const email = emailSchema.safeParse(profile.email?.trim().toLowerCase());
  return {
    sub: profile.sub,
    name,
    email: profile.email_verified === true && email.success ? email.data : null,
  };
}
```

```ts file=src/lib/talerid/username.ts
import { randomBytes } from "node:crypto";
import { slugify } from "@/lib/slugify";
import { usernameSchema } from "@/lib/validation";

const ATTEMPTS = 5;
// 23 + "-" + 6 hex = 30, the nickname limit.
const MAX_BASE = 23;

const suffix = () => randomBytes(3).toString("hex");

function baseFrom(name: string | null | undefined): string | null {
  const slug = slugify(name ?? "").slice(0, MAX_BASE).replace(/-+$/, "");
  // slugify() returns "x" when nothing survives.
  if (slug === "x") return null;
  // Long enough yet rejected means reserved: "admin-3f2a1c" would still mislead.
  if (slug.length >= 3 && !usernameSchema.safeParse(slug).success) return null;
  return slug;
}

/** Nicknames to try for a new account, best first. */
export function* usernameCandidates(name: string | null | undefined): Generator<string> {
  const base = baseFrom(name);
  if (base) {
    if (usernameSchema.safeParse(base).success) yield base;
    for (let i = 0; i < ATTEMPTS; i++) yield `${base}-${suffix()}`;
  }
  for (let i = 0; i < ATTEMPTS; i++) yield `user-${suffix()}`;
}
```

```ts file=src/lib/talerid/link-intent.ts
// "The signed-in user asked to link a Taler ID." Signed, so a cookie planted
// from a sibling host cannot attach somebody else's Taler ID to an account.

import { createHmac, timingSafeEqual } from "node:crypto";

export const LINK_INTENT_TTL_MS = 10 * 60 * 1000;

function hmac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`talerid-link:${payload}`).digest("base64url");
}

export function signLinkIntent(userId: string, secret: string, now = Date.now()): string {
  const payload = `${userId}.${now + LINK_INTENT_TTL_MS}`;
  return `${payload}.${hmac(payload, secret)}`;
}

/** The user id the token was issued for, or null if it is not valid now. */
export function verifyLinkIntent(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): string | null {
  const parts = token?.split(".") ?? [];
  if (parts.length !== 3) return null;
  const [userId, expiry, signature] = parts;
  const expected = Buffer.from(hmac(`${userId}.${expiry}`, secret));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return Number(expiry) > now ? userId : null;
}
```

```ts file=src/lib/talerid/errors.ts
import type { TalerIdRefusal } from "./resolve-user";

/** `?error=` codes for the refusals our own code produces. */
export const TALERID_REFUSAL_CODE: Record<TalerIdRefusal, string> = {
  email_taken: "TalerIdEmailTaken",
  talerid_taken: "TalerIdTaken",
  already_linked: "TalerIdAlreadyLinked",
};

/** Keys under `auth.talerId.errors` in messages/*.json. */
export type TalerIdErrorKey = "cancelled" | "emailTaken" | "taken" | "alreadyLinked" | "failed";

const KEYS = new Map<string, TalerIdErrorKey>([
  ["OAuthCallbackError", "cancelled"],
  ["AccessDenied", "cancelled"],
  [TALERID_REFUSAL_CODE.email_taken, "emailTaken"],
  [TALERID_REFUSAL_CODE.talerid_taken, "taken"],
  [TALERID_REFUSAL_CODE.already_linked, "alreadyLinked"],
]);

/** Message key for an `?error=` value; null when there is nothing to show. */
export function talerIdErrorKey(code: string | string[] | undefined): TalerIdErrorKey | null {
  const value = Array.isArray(code) ? code[0] : code;
  if (!value || value === "CredentialsSignin") return null;
  return KEYS.get(value) ?? "failed";
}
```

```ts file=src/lib/safe-redirect.ts
/** `value` if it is a path on this site, otherwise `fallback`. */
export function safeRedirectPath(value: string | null | undefined, fallback: string): string {
  return value && /^\/(?![/\\])[^\s\\]*$/.test(value) ? value : fallback;
}
```

- [ ] **Step 4:** same command → all pass (after Task 3 adds the `TalerIdRefusal` type; vitest erases type imports, so tests pass already).
- [ ] **Step 5:** Commit `feat(talerid): provider config, nicknames, link intent, error codes`.

### Task 3: resolveTalerIdUser

- [ ] **Step 1: failing test**

```ts file=src/lib/talerid/resolve-user.test.ts
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
```

- [ ] **Step 2:** `npx vitest run src/lib/talerid/resolve-user.test.ts` → FAIL, module not found.
- [ ] **Step 3: implementation**

```ts file=src/lib/talerid/resolve-user.ts
// Turns a Taler ID profile into a local user: finds, creates or links one.
// Called from the Auth.js signIn callback.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TALERID_PROVIDER_ID, type TalerIdClaims } from "./config";
import { usernameCandidates } from "./username";

export type TalerIdRefusal = "email_taken" | "talerid_taken" | "already_linked";

export type TalerIdResult =
  | { ok: true; userId: string }
  | { ok: false; reason: TalerIdRefusal };

const done = (userId: string): TalerIdResult => ({ ok: true, userId });
const refuse = (reason: TalerIdRefusal): TalerIdResult => ({ ok: false, reason });

const link = (sub: string) => ({
  type: "oidc",
  provider: TALERID_PROVIDER_ID,
  providerAccountId: sub,
});

/** Columns of the unique constraint that failed, or null for any other error. */
function uniqueViolation(err: unknown): string[] | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return null;
  const target = err.meta?.target;
  return Array.isArray(target) ? target.map(String) : [String(target ?? "")];
}

/** The local user a Taler ID is linked to. */
export async function findTalerIdUser(sub: string) {
  const account = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: { provider: TALERID_PROVIDER_ID, providerAccountId: sub },
    },
    select: { user: { select: { id: true, username: true, name: true, email: true, role: true } } },
  });
  return account?.user ?? null;
}

export async function resolveTalerIdUser(
  claims: TalerIdClaims,
  { linkToUserId }: { linkToUserId?: string } = {},
): Promise<TalerIdResult> {
  const owner = await findTalerIdUser(claims.sub);
  if (linkToUserId) {
    if (!owner) return attach(claims.sub, linkToUserId);
    return owner.id === linkToUserId ? done(owner.id) : refuse("talerid_taken");
  }
  return owner ? done(owner.id) : register(claims);
}

async function attach(sub: string, userId: string): Promise<TalerIdResult> {
  try {
    await prisma.account.create({ data: { ...link(sub), userId } });
    return done(userId);
  } catch (err) {
    if (!uniqueViolation(err)) throw err;
    // Either this Taler ID was linked a moment ago or the account has another.
    const owner = await findTalerIdUser(sub);
    if (!owner) return refuse("already_linked");
    return owner.id === userId ? done(userId) : refuse("talerid_taken");
  }
}

async function register(claims: TalerIdClaims): Promise<TalerIdResult> {
  // A clash may be a parallel callback for the same person that got here
  // first, so every clash checks the link before it counts as a refusal.
  const emailTaken = async () => {
    const owner = await findTalerIdUser(claims.sub);
    return owner ? done(owner.id) : refuse("email_taken");
  };

  if (claims.email) {
    const holder = await prisma.user.findUnique({
      where: { email: claims.email },
      select: { id: true },
    });
    if (holder) return emailTaken();
  }

  for (const username of usernameCandidates(claims.name)) {
    try {
      const user = await prisma.user.create({
        data: {
          username,
          name: claims.name,
          email: claims.email,
          emailVerified: claims.email ? new Date() : null,
          accounts: { create: link(claims.sub) },
        },
        select: { id: true },
      });
      return done(user.id);
    } catch (err) {
      const columns = uniqueViolation(err);
      if (!columns) throw err;
      if (columns.includes("username")) continue;
      if (columns.includes("email")) return emailTaken();
      const owner = await findTalerIdUser(claims.sub);
      if (owner) return done(owner.id);
      throw err;
    }
  }
  throw new Error("[talerid] no free nickname");
}
```

- [ ] **Step 4:** same command → PASS.
- [ ] **Step 5:** Commit `feat(talerid): find, create or link the local user`.

### Task 4: Auth.js wiring

- [ ] **Step 1:** cookie wrapper

```ts file=src/lib/talerid/link-intent-cookie.ts
import { cookies } from "next/headers";
import { LINK_INTENT_TTL_MS, signLinkIntent, verifyLinkIntent } from "./link-intent";

// Same precedence as Auth.js.
function secret(): string {
  const value = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!value) throw new Error("[talerid] AUTH_SECRET is not set");
  return value;
}

function cookie() {
  const site = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "";
  const secure = site.startsWith("https://");
  return {
    // __Host- needs Secure, so plain-http development goes without the prefix.
    name: secure ? "__Host-talerid-link" : "talerid-link",
    options: { httpOnly: true, sameSite: "lax", secure, path: "/" } as const,
  };
}

export async function setLinkIntent(userId: string): Promise<void> {
  const { name, options } = cookie();
  (await cookies()).set(name, signLinkIntent(userId, secret()), {
    ...options,
    maxAge: LINK_INTENT_TTL_MS / 1000,
  });
}

/** Reads the intent and clears it: one callback gets one chance to link. */
export async function takeLinkIntent(): Promise<string | null> {
  const { name, options } = cookie();
  const jar = await cookies();
  const value = jar.get(name)?.value;
  if (!value) return null;
  // Not delete(): a __Host- cookie is only replaced by one with Secure set.
  jar.set(name, "", { ...options, maxAge: 0 });
  return verifyLinkIntent(value, secret());
}
```

- [ ] **Step 2:** `src/lib/auth.ts`: make the augmented `User` fields optional; add the provider; `pages: { signIn: "/login", error: "/login" }`; callbacks:

```ts
async signIn({ account, profile }): Promise<boolean | string> {
  if (account?.provider !== TALERID_PROVIDER_ID) return true;
  const intendedUserId = await takeLinkIntent();
  const currentUserId = intendedUserId ? (await auth())?.user?.id : undefined;
  const linkToUserId = intendedUserId && intendedUserId === currentUserId ? intendedUserId : undefined;
  const result = await resolveTalerIdUser(
    toTalerIdClaims(profile as unknown as TalerIdProfile),
    { linkToUserId },
  );
  if (result.ok) return true;
  return `${linkToUserId ? "/me/settings" : "/login"}?error=${TALERID_REFUSAL_CODE[result.reason]}`;
},
async jwt({ token, user, account }) {
  if (!user) return token;
  if (account?.provider === TALERID_PROVIDER_ID) {
    // `user` is the Taler ID profile; the signIn callback has linked it already.
    const local = await findTalerIdUser(account.providerAccountId);
    if (!local) throw new Error("[talerid] signed in without a linked account");
    token.sub = local.id;
    token.name = local.name ?? local.username;
    token.userId = local.id;
    token.username = local.username;
    token.role = local.role;
    token.hasEmail = local.email != null;
    return token;
  }
  token.userId = user.id!;
  token.username = user.username!;
  token.role = user.role!;
  token.hasEmail = user.hasEmail!;
  return token;
},
```

- [ ] **Step 3:** `npx tsc --noEmit` → clean. Commit `feat(auth): Taler ID provider`.

### Task 5: Actions

- [ ] **Step 1: failing tests** in `src/app/[locale]/me/settings/actions.test.ts` for `setPasswordAction` (sets when null, refuses when a password exists, validates) and `unlinkTalerIdAction` (removes only the Taler ID link of the caller, refuses without a password, needs a session).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement both in `settings/actions.ts`; add `setPasswordSchema` to `validation.ts`; create `src/app/actions/talerid.ts`:

```ts file=src/app/actions/talerid.ts
"use server";

import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from "@/lib/locales";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { TALERID_PROVIDER_ID } from "@/lib/talerid/config";
import { setLinkIntent } from "@/lib/talerid/link-intent-cookie";

function localeFrom(formData: FormData): string {
  const value = String(formData.get("locale") ?? "");
  return (SUPPORTED_LOCALES as readonly string[]).includes(value) ? value : DEFAULT_LOCALE;
}

/** Sends the visitor to Taler ID; on failure back to `errorPath` with a message. */
async function goToTalerId(redirectTo: string, errorPath: string): Promise<never> {
  // Auth.js logs its own failures (say, Taler ID is down) and answers with the
  // error page's URL, which has no locale and knows nothing about settings.
  const url: string = await signIn(TALERID_PROVIDER_ID, { redirectTo, redirect: false });
  const failed = new URL(url, "http://localhost").searchParams.has("error");
  redirect(failed ? `${errorPath}?error=Configuration` : url);
}

export async function signInWithTalerId(formData: FormData): Promise<void> {
  const locale = localeFrom(formData);
  const callbackUrl = formData.get("callbackUrl");
  await goToTalerId(
    safeRedirectPath(typeof callbackUrl === "string" ? callbackUrl : null, `/${locale}/me`),
    `/${locale}/login`,
  );
}

export async function linkTalerId(formData: FormData): Promise<void> {
  const locale = localeFrom(formData);
  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/me/settings`);
  await setLinkIntent(session.user.id);
  await goToTalerId(`/${locale}/me/settings?talerid=linked`, `/${locale}/me/settings`);
}
```

- [ ] **Step 4:** run → PASS. Commit `feat(talerid): start, link, unlink; set a password`.

### Task 6: Interface

- [ ] `talerid-submit.tsx` (client, `useFormStatus`), `talerid-panel.tsx`; `LoginForm` and `RegisterForm` take `children` rendered between the heading and their `<form>`; `/login` reads `searchParams`, shows the message, sends signed-in visitors with an error to settings; `talerid-section.tsx`, `set-password-section.tsx`; settings page picks between "set" and "change" password.
- [ ] Strings `auth.talerId.*`, `settings.talerId.*`, `settings.setPassword.*` in en, ru, sk. Test: the three files have the same keys under those paths.
- [ ] `npx tsc --noEmit`, `npx eslint` on changed files → clean. Commit `feat(talerid): sign-in button and settings section`.

### Task 7: Docs

- [ ] `.env.example`, `README.md` (auth row, env table), `CLAUDE.md` (short Taler ID section). Commit `docs: Taler ID login`.

### Task 8: Full flow

- [ ] Production build in the clone against the throwaway database with an `oidc-provider` stub as issuer; drive Chrome through: register, sign out, sign in again, link a password account, refuse a taken Taler ID, refuse a taken email, cancel, unlink, set password then password sign-in, password registration unchanged.
- [ ] `tests/e2e/talerid-login.spec.ts`: button on `/en/login` and `/en/register`; it leads to the issuer with `code_challenge_method=S256`, `scope=openid profile email` and the right `redirect_uri`.

### Task 9: Rollout

- [ ] Server: `pgrep -x claude` empty, tree clean, `git log` unchanged since branching, otherwise rebase.
- [ ] `pg_dump` backup, copy `.next`.
- [ ] `git merge --ff-only feat/talerid-login`, `npm ci` only if the lockfile changed, `prisma migrate deploy`, `prisma generate`, `npm run build`, `pm2 restart poolwatt-web`.
- [ ] nginx www → apex 308, `nginx -t`, reload.
- [ ] Verify from outside; human signs in with a real Taler ID; `git push`.
