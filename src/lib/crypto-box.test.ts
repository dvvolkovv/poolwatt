import { describe, it, expect, afterEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import {
  MissingEncryptionKeyError,
  encryptionKeyConfigured,
  open,
  seal,
} from "./crypto-box";

const KEY = randomBytes(32).toString("base64");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("crypto-box", () => {
  it("round-trips a secret", () => {
    vi.stubEnv("API_KEY_ENC_KEY", KEY);
    const sealed = seal("pwt_signing_secret");
    expect(sealed.ciphertext).not.toContain("pwt_signing_secret");
    expect(open(sealed.ciphertext, sealed.iv)).toBe("pwt_signing_secret");
  });

  it("uses a fresh nonce every time", () => {
    vi.stubEnv("API_KEY_ENC_KEY", KEY);
    const a = seal("same");
    const b = seal("same");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("refuses to work without a key", () => {
    vi.stubEnv("API_KEY_ENC_KEY", "");
    expect(encryptionKeyConfigured()).toBe(false);
    expect(() => seal("x")).toThrow(MissingEncryptionKeyError);
  });

  it("refuses a key of the wrong length", () => {
    vi.stubEnv("API_KEY_ENC_KEY", Buffer.from("too short").toString("base64"));
    expect(encryptionKeyConfigured()).toBe(false);
    expect(() => seal("x")).toThrow(MissingEncryptionKeyError);
  });

  it("detects a tampered ciphertext instead of returning garbage", () => {
    vi.stubEnv("API_KEY_ENC_KEY", KEY);
    const sealed = seal("secret");
    const bytes = Buffer.from(sealed.ciphertext, "base64");
    bytes[0] ^= 0xff;
    expect(() => open(bytes.toString("base64"), sealed.iv)).toThrow();
  });

  it("cannot be opened with a different key", () => {
    vi.stubEnv("API_KEY_ENC_KEY", KEY);
    const sealed = seal("secret");
    vi.stubEnv("API_KEY_ENC_KEY", randomBytes(32).toString("base64"));
    expect(() => open(sealed.ciphertext, sealed.iv)).toThrow();
  });
});
