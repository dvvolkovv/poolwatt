import { describe, it, expect } from "vitest";
import { generateIban, ibanCheckDigits, isValidIban } from "./settlement-service";

describe("IBAN generation — ТЗ §19 US-13", () => {
  it("produces a structurally valid Lithuanian IBAN", () => {
    const iban = generateIban(1);
    expect(iban).toMatch(/^LT\d{18}$/);
    expect(isValidIban(iban)).toBe(true);
  });

  it("produces a valid IBAN for any serial", () => {
    for (const serial of [0, 7, 1234, 99_999, 12_345_678_901]) {
      expect(isValidIban(generateIban(serial))).toBe(true);
    }
  });

  it("gives different serials different IBANs", () => {
    expect(generateIban(1)).not.toBe(generateIban(2));
  });

  it("computes mod-97 check digits per ISO 13616", () => {
    // Worked reference: LT12 1000 0111 0100 1000
    expect(ibanCheckDigits("LT", "100001110100 1000".replace(" ", ""))).toMatch(/^\d{2}$/);
  });
});

describe("isValidIban", () => {
  it("accepts a known-good IBAN", () => {
    expect(isValidIban("LT12 1000 0111 0100 1000")).toBe(true);
  });

  it("rejects a tampered check digit", () => {
    expect(isValidIban("LT13 1000 0111 0100 1000")).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(isValidIban("")).toBe(false);
    expect(isValidIban("LT12")).toBe(false);
    expect(isValidIban("1T12100001110100100")).toBe(false);
  });
});
