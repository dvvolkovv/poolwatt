import { describe, expect, it } from "vitest";
import { operatorEmail } from "./operator-email";

describe("operatorEmail", () => {
  it("prefers an explicit ADMIN_EMAIL", () => {
    expect(
      operatorEmail({ ADMIN_EMAIL: "ops@poolwatt.com", EMAIL_REPLY_TO: "info@poolwatt.com" }),
    ).toBe("ops@poolwatt.com");
  });

  it("falls back to the reply-to inbox rather than dropping the notification", () => {
    expect(operatorEmail({ EMAIL_REPLY_TO: "info@poolwatt.com" })).toBe("info@poolwatt.com");
    expect(operatorEmail({ ADMIN_EMAIL: "  ", EMAIL_REPLY_TO: "info@poolwatt.com" })).toBe(
      "info@poolwatt.com",
    );
  });

  it("is null only when no inbox is configured at all", () => {
    expect(operatorEmail({})).toBeNull();
    expect(operatorEmail({ ADMIN_EMAIL: "", EMAIL_REPLY_TO: "" })).toBeNull();
  });
});
