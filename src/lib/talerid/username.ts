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
