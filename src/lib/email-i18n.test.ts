import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "./locales";
import { emailLink, emailText, escapeHtml, toLocale } from "./email-i18n";

const AUTH_KEYS = [
  "greeting", "ignore",
  "verify.subject", "verify.body", "verify.cta",
  "reset.subject", "reset.body", "reset.cta",
  "claim.subject", "claim.body", "claim.expires",
];

function leaves(o: object, p = ""): string[] {
  return Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [p + k] : leaves(v, `${p}${k}.`)));
}

describe("email texts", () => {
  it.each(SUPPORTED_LOCALES)("%s has its own registration and reset texts", async (locale) => {
    const own = (await import(`../../messages/${locale}.json`)).default.emails;
    expect(leaves(own)).toEqual(expect.arrayContaining(AUTH_KEYS));
    const t = await emailText(locale);
    for (const key of ["claim.subject", "claim.body"]) {
      expect(t.text(key, { name: "ACME" })).toContain("ACME");
      expect(t.text(key, { name: "ACME" })).not.toMatch(/[{}]/);
    }
    expect(t.text("verify.subject")).toContain("Poolwatt");
    expect(t.text("reset.subject")).toContain("Poolwatt");
  });

  it.each(["ru", "sk"])("%s translates every notification with the same placeholders as English", async (locale) => {
    const en = (await import("../../messages/en.json")).default.emails;
    const own = (await import(`../../messages/${locale}.json`)).default.emails;
    expect(leaves(own).sort()).toEqual(leaves(en).sort());
    const get = (o: unknown, path: string) => path.split(".").reduce((a, s) => (a as Record<string, unknown>)[s], o) as string;
    const vars = (s: string) => [...new Set(s.match(/\{\w+\}/g) ?? [])].sort();
    for (const key of leaves(en)) expect(vars(get(own, key)), key).toEqual(vars(get(en, key)));
  });

  it("falls back to English per key for partial locales", async () => {
    const t = await emailText("uk");
    expect(t.text("verify.cta")).toBe("Підтвердити email");
    expect(t.text("notify.interest.cta")).toBe("Review and accept");
  });

  it("treats unknown locales as English", () => {
    expect(toLocale("xx")).toBe("en");
    expect(toLocale(null)).toBe("en");
    expect(toLocale("../../etc")).toBe("en");
  });

  it("escapes variables in bodies and keeps subjects on one line", async () => {
    const t = await emailText("en");
    expect(t.html("claim.body", { name: "<img src=x>" })).toContain("&lt;img src=x&gt;");
    expect(t.text("claim.subject", { name: "A\r\nBcc: x@y.z" })).not.toMatch(/[\r\n]/);
  });

  it("marks right-to-left languages", async () => {
    expect((await emailText("ar")).layout("x")).toContain('dir="rtl"');
    expect((await emailText("de")).layout("x")).toContain('dir="ltr"');
  });

  it("shows the bare URL next to the label", () => {
    expect(emailLink("https://x.test/?a=1&b=2", "Go").join("")).toContain(">https://x.test/?a=1&amp;b=2</a>");
    expect(escapeHtml('"&<>')).toBe("&quot;&amp;&lt;&gt;");
  });
});
