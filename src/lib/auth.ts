// Auth.js v5 configuration. V1 ships a single Credentials provider backed by
// our User.username + User.passwordHash. JWT sessions (no per-request DB
// lookup). Server actions read the session via `auth()`; Next route handlers
// import { GET, POST } from "@/lib/auth"' export.
//
// Future-proofing: V2 may add OAuth providers (Google, Telegram). The
// PrismaAdapter is already a dep but isn't wired here — Credentials doesn't
// use account-linking. When we add OAuth, add the adapter + providers in
// this file; existing username/password users keep working unchanged.

import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { loginSchema } from "@/lib/validation";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      role: "USER" | "ADMIN";
      hasEmail: boolean;
    } & DefaultSession["user"];
  }
  interface User {
    username: string;
    role: "USER" | "ADMIN";
    hasEmail: boolean;
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

export const { handlers, auth, signIn, signOut } = NextAuth({
  // We sit behind nginx in production; Auth.js v5 rejects the forwarded host
  // unless told to trust the reverse-proxy chain. Equivalent to setting
  // AUTH_TRUST_HOST=true but kept in code so a missing env var doesn't break
  // the whole sign-in flow silently.
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },  // 30-day rolling
  pages: {
    signIn: "/login",
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
        if (!user) return null;
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
  ],
  callbacks: {
    jwt({ token, user }) {
      // user is only present on initial sign-in; afterwards we rehydrate from
      // the JWT itself. authorize() always sets these fields, so the non-null
      // assertion holds for our Credentials provider.
      if (user) {
        token.userId = user.id!;
        token.username = user.username;
        token.role = user.role;
        token.hasEmail = user.hasEmail;
      }
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
