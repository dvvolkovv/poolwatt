import { describe, it, expect } from "vitest";
import { expressInterestInputSchema } from "./build-request-claim-schema";

describe("expressInterestInputSchema", () => {
  it("accepts no message", () => {
    expect(expressInterestInputSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a 10-char message", () => {
    expect(expressInterestInputSchema.safeParse({ message: "1234567890" }).success).toBe(true);
  });

  it("accepts a 500-char message", () => {
    expect(expressInterestInputSchema.safeParse({ message: "x".repeat(500) }).success).toBe(true);
  });

  it("rejects a 9-char message (when provided)", () => {
    const r = expressInterestInputSchema.safeParse({ message: "123456789" });
    expect(r.success).toBe(false);
  });

  it("rejects a 501-char message", () => {
    const r = expressInterestInputSchema.safeParse({ message: "x".repeat(501) });
    expect(r.success).toBe(false);
  });

  it("accepts empty-string message as omitted", () => {
    const r = expressInterestInputSchema.safeParse({ message: "" });
    expect(r.success).toBe(true);
  });
});
