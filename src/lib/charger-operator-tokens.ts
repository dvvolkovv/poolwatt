import { createHash, randomBytes } from "node:crypto";

const TOKEN_PREFIX = "pwco_";

// Plaintext token format: pwco_<43 chars base64url> ≈ 256 bits of entropy.
// Stored as SHA-256; the plaintext is shown to the operator exactly once
// at creation and cannot be retrieved later.
export function generateToken(): { plaintext: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  const plaintext = `${TOKEN_PREFIX}${raw}`;
  return { plaintext, hash: hashToken(plaintext) };
}

export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function looksLikeToken(s: string): boolean {
  return s.startsWith(TOKEN_PREFIX) && s.length >= TOKEN_PREFIX.length + 30;
}
