import { describe, it, expect } from "vitest";
import { matchesDomain } from "./domain-match";

describe("matchesDomain", () => {
  it("accepts exact-domain email", () => {
    expect(matchesDomain("ceo@tesla.com", "https://tesla.com")).toBe(true);
  });

  it("accepts subdomain email", () => {
    expect(matchesDomain("sales@subsidiary.tesla.com", "https://tesla.com")).toBe(true);
  });

  it("rejects unrelated domain", () => {
    expect(matchesDomain("ceo@example.com", "https://tesla.com")).toBe(false);
  });

  it("rejects suffix-attack domain (tesla.com.evil.com)", () => {
    expect(matchesDomain("attacker@tesla.com.evil.com", "https://tesla.com")).toBe(false);
  });

  it("strips www. from website host", () => {
    expect(matchesDomain("ceo@tesla.com", "https://www.tesla.com")).toBe(true);
  });

  it("handles website without protocol", () => {
    expect(matchesDomain("ceo@tesla.com", "tesla.com")).toBe(true);
  });

  it("handles website with path / query", () => {
    expect(matchesDomain("ceo@tesla.com", "https://tesla.com/about")).toBe(true);
  });

  it("returns false when website is empty / null", () => {
    expect(matchesDomain("ceo@tesla.com", "")).toBe(false);
    expect(matchesDomain("ceo@tesla.com", null)).toBe(false);
  });

  it("returns false when email is malformed (no @)", () => {
    expect(matchesDomain("not-an-email", "https://tesla.com")).toBe(false);
  });

  it("is case-insensitive on domain", () => {
    expect(matchesDomain("CEO@Tesla.COM", "https://tesla.com")).toBe(true);
  });
});
