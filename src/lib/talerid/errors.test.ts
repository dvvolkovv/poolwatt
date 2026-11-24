import { describe, expect, it } from "vitest";
import { TALERID_REFUSAL_CODE, talerIdErrorKey } from "./errors";

describe("talerIdErrorKey", () => {
  it("has a message for every refusal", () => {
    expect(talerIdErrorKey(TALERID_REFUSAL_CODE.email_taken)).toBe("emailTaken");
    expect(talerIdErrorKey(TALERID_REFUSAL_CODE.talerid_taken)).toBe("taken");
    expect(talerIdErrorKey(TALERID_REFUSAL_CODE.already_linked)).toBe("alreadyLinked");
  });

  it("maps provider errors to 'cancelled'", () => {
    expect(talerIdErrorKey("OAuthCallbackError")).toBe("cancelled");
    expect(talerIdErrorKey("AccessDenied")).toBe("cancelled");
  });

  it("maps everything else to the generic message", () => {
    expect(talerIdErrorKey("Configuration")).toBe("failed");
    expect(talerIdErrorKey("<script>")).toBe("failed");
    expect(talerIdErrorKey("constructor")).toBe("failed");
  });

  it("stays quiet without a code or for password errors", () => {
    expect(talerIdErrorKey(undefined)).toBeNull();
    expect(talerIdErrorKey("")).toBeNull();
    expect(talerIdErrorKey("CredentialsSignin")).toBeNull();
  });

  it("uses the first of repeated parameters", () => {
    expect(talerIdErrorKey(["AccessDenied", "x"])).toBe("cancelled");
  });
});
