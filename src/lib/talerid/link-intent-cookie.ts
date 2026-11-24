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
