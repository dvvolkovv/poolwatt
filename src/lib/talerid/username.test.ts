import { describe, expect, it } from "vitest";
import { usernameCandidates } from "./username";
import { usernameSchema } from "@/lib/validation";

const first = (name: string | null | undefined) => [...usernameCandidates(name)][0];

describe("usernameCandidates", () => {
  it("slugifies the name", () => {
    expect(first("Ivan Petrov")).toBe("ivan-petrov");
  });

  it("transliterates cyrillic", () => {
    expect(first("Иван Петров")).toBe("ivan-petrov");
  });

  it("adds random suffixes after the plain slug", () => {
    const all = [...usernameCandidates("Ivan Petrov")];
    expect(all[1]).toMatch(/^ivan-petrov-[0-9a-f]{6}$/);
    expect(new Set(all).size).toBe(all.length);
  });

  it("never offers a reserved nickname or one derived from it", () => {
    for (const c of usernameCandidates("Admin")) {
      expect(c).toMatch(/^user-[0-9a-f]{6}$/);
    }
  });

  it("falls back to user-<random> when the name has nothing usable", () => {
    for (const name of [null, undefined, "", "   ", "გიორგი", "🙂"]) {
      expect(first(name)).toMatch(/^user-[0-9a-f]{6}$/);
    }
  });

  it("suffixes names too short to stand alone", () => {
    expect(first("Li")).toMatch(/^li-[0-9a-f]{6}$/);
  });

  it("only yields nicknames the login form accepts", () => {
    const names = ["Ivan Petrov", "Li", "Admin", null, "A".repeat(200), "-- __ --", "Jean-Luc d'Été"];
    for (const name of names) {
      for (const c of usernameCandidates(name)) {
        expect(usernameSchema.safeParse(c).success, `${name} → ${c}`).toBe(true);
      }
    }
  });
});
