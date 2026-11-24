import { describe, expect, it } from "vitest";
import { isTalerIdEnabled, talerIdProvider, toTalerIdClaims } from "./config";

const env = { TALERID_CLIENT_ID: "id", TALERID_CLIENT_SECRET: "secret" };

describe("talerIdProvider", () => {
  it("is off unless both credentials are set", () => {
    for (const e of [{}, { TALERID_CLIENT_ID: "id" }, { TALERID_CLIENT_SECRET: "s" }, { ...env, TALERID_CLIENT_ID: "" }]) {
      expect(isTalerIdEnabled(e)).toBe(false);
      expect(talerIdProvider(e)).toBeNull();
    }
  });

  it("asks for identity, profile and email with every replay check on", () => {
    const p = talerIdProvider(env)!;
    expect(p.id).toBe("talerid");
    expect(p.issuer).toBe("https://api.talerid.io/oauth");
    expect(p.checks).toEqual(["pkce", "state", "nonce"]);
    expect(p.authorization).toEqual({ params: { scope: "openid profile email" } });
    expect(p.idToken).toBe(false);
  });

  it("can point at another issuer", () => {
    expect(talerIdProvider({ ...env, TALERID_ISSUER: "http://localhost:4000" })!.issuer).toBe("http://localhost:4000");
  });
});

describe("toTalerIdClaims", () => {
  it("keeps a verified email, normalised", () => {
    expect(toTalerIdClaims({ sub: "s", name: " Ivan Petrov ", email: " Ivan@Example.COM ", email_verified: true }))
      .toEqual({ sub: "s", name: "Ivan Petrov", email: "ivan@example.com" });
  });

  it("drops an email that is not explicitly verified", () => {
    for (const email_verified of [false, null, undefined, "true" as unknown as boolean]) {
      expect(toTalerIdClaims({ sub: "s", email: "a@b.co", email_verified }).email).toBeNull();
    }
  });

  it("drops a malformed email", () => {
    expect(toTalerIdClaims({ sub: "s", email: "nope", email_verified: true }).email).toBeNull();
  });

  it("builds the name from parts when there is no full name", () => {
    expect(toTalerIdClaims({ sub: "s", name: "", given_name: "Ivan", family_name: "Petrov" }).name).toBe("Ivan Petrov");
    expect(toTalerIdClaims({ sub: "s" }).name).toBeNull();
  });

  it("caps the name at what settings allow", () => {
    expect(toTalerIdClaims({ sub: "s", name: "x".repeat(200) }).name).toHaveLength(80);
  });

  it("refuses a profile without a subject", () => {
    expect(() => toTalerIdClaims({ sub: "" })).toThrow();
  });
});
