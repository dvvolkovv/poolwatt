import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it("keeps same-site paths", () => {
    expect(safeRedirectPath("/en/me/settings?x=1#a", "/en/me")).toBe("/en/me/settings?x=1#a");
  });

  it("falls back for anything that could leave the site", () => {
    for (const v of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "en/me", "", null, undefined, "/\tx", "/a\nb"]) {
      expect(safeRedirectPath(v, "/en/me")).toBe("/en/me");
    }
  });
});
