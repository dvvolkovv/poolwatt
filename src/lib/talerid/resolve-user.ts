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
