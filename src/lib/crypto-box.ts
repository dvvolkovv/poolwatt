// Sealed secrets at rest — AES-256-GCM under one server key.
//
// Most credentials in Poolwatt are stored as a hash, because the server only
// ever has to recognise them. A few cannot be: an HMAC signature (ТЗ §15) is
// verified by recomputing it, so the server must hold the signing secret
// itself. Those are sealed with this module instead of stored in the clear, so
// a leaked database dump does not hand over the ability to forge telemetry.
//
// The key lives in `API_KEY_ENC_KEY` — 32 random bytes, base64. Generate one
// with `openssl rand -base64 32`. Losing it loses the signing secrets, which
// means re-issuing equipment keys; it does not lose any readings.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

export class MissingEncryptionKeyError extends Error {
  constructor() {
    super("API_KEY_ENC_KEY is not set to 32 base64-encoded bytes");
  }
}

function keyMaterial(): Buffer | null {
  const raw = process.env.API_KEY_ENC_KEY?.trim();
  if (!raw) return null;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(raw, "base64");
  } catch {
    return null;
  }
  return bytes.length === 32 ? bytes : null;
}

/** True when this deployment can hold sealed secrets at all. */
export function encryptionKeyConfigured(): boolean {
  return keyMaterial() !== null;
}

export interface Sealed {
  /** Base64 of ciphertext followed by the 16-byte GCM tag. */
  ciphertext: string;
  /** Base64 of the nonce; fresh on every call. */
  iv: string;
}

export function seal(plaintext: string): Sealed {
  const key = keyMaterial();
  if (!key) throw new MissingEncryptionKeyError();

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: Buffer.concat([body, cipher.getAuthTag()]).toString("base64"),
    iv: iv.toString("base64"),
  };
}

export function open(ciphertext: string, iv: string): string {
  const key = keyMaterial();
  if (!key) throw new MissingEncryptionKeyError();

  const raw = Buffer.from(ciphertext, "base64");
  if (raw.length <= 16) throw new Error("Sealed value is too short to contain a tag");
  const body = raw.subarray(0, raw.length - 16);
  const tag = raw.subarray(raw.length - 16);

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(tag);
  // final() throws on a wrong key or a tampered ciphertext — by design.
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}
