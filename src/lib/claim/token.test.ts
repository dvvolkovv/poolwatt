import { describe, it, expect } from "vitest";
import { generateClaimToken } from "./token";

describe("generateClaimToken", () => {
  it("returns a 6-digit string", () => {
    const t = generateClaimToken();
    expect(t).toMatch(/^\d{6}$/);
  });

  it("zero-pads small values", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 1000; i++) tokens.add(generateClaimToken());
    for (const t of tokens) expect(t).toHaveLength(6);
  });

  it("produces high variety (rough uniqueness check)", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 1000; i++) tokens.add(generateClaimToken());
    expect(tokens.size).toBeGreaterThan(995);
  });
});
