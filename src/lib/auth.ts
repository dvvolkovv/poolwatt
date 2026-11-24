// Auth.js v5 configuration: Credentials (User.username + User.passwordHash) and
// Taler ID (OpenID Connect, when configured). JWT sessions (no per-request DB
// lookup). Server actions read the session via `auth()`; Next route handlers
// import { GET, POST } from "@/lib/auth"' export.
//
// No PrismaAdapter: it would create users without the mandatory username and
// store provider tokens. The signIn callback below finds, creates or links the
// local user itself (src/lib/talerid/resolve-user.ts).

import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { loginSchema } from "@/lib/validation";
import {
  TALERID_PROVIDER_ID,
  talerIdProvider,
  toTalerIdClaims,
  type TalerIdProfile,
} from "@/lib/talerid/config";
import { TALERID_REFUSAL_CODE } from "@/lib/talerid/errors";
import { takeLinkIntent } from "@/lib/talerid/link-intent-cookie";
import { findTalerIdUser, resolveTalerIdUser } from "@/lib/talerid/resolve-user";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      role: "USER" | "ADMIN";
      hasEmail: boolean;
    } & DefaultSession["user"];
  }
  // Set by Credentials.authorize(). A Taler ID sign-in starts from the provider
  // profile, which has none of these; the jwt callback reads the local user.
  interface User {
    username?: string;
    role?: "USER" | "ADMIN";
    hasEmail?: boolean;
  }
}

// The JWT type augmentation lives under "@auth/core/jwt" in Auth.js v5 (the
// core module is what holds the runtime types; "next-auth/jwt" is a re-export
// that doesn't expose the augmentation slot in this beta).
declare module "@auth/core/jwt" {
  interface JWT {
    userId: string;
    username: string;
    role: "USER" | "ADMIN";
    hasEmail: boolean;
  }
}

const talerId = talerIdProvider();

export const { handlers, auth, signIn, signOut } = NextAuth({
  // We sit behind nginx in production; Auth.js v5 rejects the forwarded host
  // unless told to trust the reverse-proxy chain. Equivalent to setting
  // AUTH_TRUST_HOST=true but kept in code so a missing env var doesn't break
  // the whole sign-in flow silently.
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },  // 30-day rolling
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { username, password } = parsed.data;
        const user = await prisma.user.findUnique({ where: { username } });
        // No hash: the account signs in with Taler ID only.
        if (!user?.passwordHash) return null;
        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return null;
        return {
          id: user.id,
          username: user.username,
          role: user.role,
          hasEmail: user.email != null,
          name: user.name ?? user.username,
        };
      },
    }),
    ...(talerId ? [talerId] : []),
  ],
  callbacks: {
    async signIn({ account, profile }): Promise<boolean | string> {
      if (account?.provider !== TALERID_PROVIDER_ID) return true;

      // Link only when the person signed in right now is the one who asked to.
      const intendedUserId = await takeLinkIntent();
      const currentUserId = intendedUserId ? (await auth())?.user?.id : undefined;
      const linkToUserId =
        intendedUserId && intendedUserId === currentUserId ? intendedUserId : undefined;

      const result = await resolveTalerIdUser(
        toTalerIdClaims(profile as unknown as TalerIdProfile),
        { linkToUserId },
      );
      if (result.ok) return true;
      // Returning a path makes Auth.js redirect there instead of signing in.
      return `${linkToUserId ? "/me/settings" : "/login"}?error=${TALERID_REFUSAL_CODE[result.reason]}`;
    },
    async jwt({ token, user, account }) {
      // user is only present on initial sign-in; afterwards we rehydrate from
      // the JWT itself.
      if (!user) return token;

      if (account?.provider === TALERID_PROVIDER_ID) {
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

      // authorize() always sets these, so the assertions hold for Credentials.
      token.userId = user.id!;
      token.username = user.username!;
      token.role = user.role!;
      token.hasEmail = user.hasEmail!;
      return token;
    },
    session({ session, token }) {
      session.user.id = token.userId;
      session.user.username = token.username;
      session.user.role = token.role;
      session.user.hasEmail = token.hasEmail;
      return session;
    },
  },
});
