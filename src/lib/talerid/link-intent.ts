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
