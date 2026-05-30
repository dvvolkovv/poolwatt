import bcrypt from "bcryptjs";

// bcrypt cost factor. 12 → ~250ms on modern hardware, OWASP-recommended floor.
const ROUNDS = 12;

// bcrypt's input cap is 72 bytes (anything past is silently ignored), so we
// also enforce a max-length of 72 in validation to keep behaviour predictable.

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, ROUNDS);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
