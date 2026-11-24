import { describe, expect, it } from "vitest";
import { LINK_INTENT_TTL_MS, signLinkIntent, verifyLinkIntent } from "./link-intent";

const SECRET = "test-secret";
const NOW = 1_800_000_000_000;

describe("link intent", () => {
  it("round-trips the user id", () => {
    expect(verifyLinkIntent(signLinkIntent("user1", SECRET, NOW), SECRET, NOW + 1000)).toBe("user1");
  });

  it("expires", () => {
    const token = signLinkIntent("user1", SECRET, NOW);
    expect(verifyLinkIntent(token, SECRET, NOW + LINK_INTENT_TTL_MS + 1)).toBeNull();
  });

  it("rejects another secret", () => {
    expect(verifyLinkIntent(signLinkIntent("user1", "other", NOW), SECRET, NOW)).toBeNull();
  });

  it("rejects a swapped user id or a stretched expiry", () => {
    const [, exp, sig] = signLinkIntent("user1", SECRET, NOW).split(".");
    expect(verifyLinkIntent(`user2.${exp}.${sig}`, SECRET, NOW)).toBeNull();
    expect(verifyLinkIntent(`user1.${Number(exp) + 1}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it("rejects junk", () => {
    for (const v of [undefined, "", "a", "a.b", "a.b.c", "a.b.c.d", "user1.NaN.x", `user1.${NOW + 1}.`]) {
      expect(verifyLinkIntent(v, SECRET, NOW)).toBeNull();
    }
  });
});
