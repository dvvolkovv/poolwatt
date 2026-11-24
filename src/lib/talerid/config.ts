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
