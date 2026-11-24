import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ru from "../../../messages/ru.json";
import sk from "../../../messages/sk.json";
import { talerIdErrorKey, TALERID_REFUSAL_CODE } from "./errors";

type Tree = { [key: string]: string | Tree };

const paths = (tree: Tree, prefix = ""): string[] =>
  Object.entries(tree)
    .flatMap(([k, v]) => (typeof v === "string" ? [prefix + k] : paths(v, `${prefix}${k}.`)))
    .sort();

const ours = (m: typeof en) =>
  ({
    auth: m.auth.talerId,
    settings: m.settings.talerId,
    password: m.settings.setPassword,
  }) as unknown as Tree;

// en/ru/sk are the locales kept complete; the rest fall back to English.
describe("Taler ID messages", () => {
  it.each([["ru", ru], ["sk", sk]] as const)("%s has the same keys as en", (_locale, m) => {
    expect(paths(ours(m as unknown as typeof en))).toEqual(paths(ours(en)));
  });

  it("has a text for every error key", () => {
    const codes = ["AccessDenied", "Configuration", ...Object.values(TALERID_REFUSAL_CODE)];
    for (const code of codes) {
      const key = talerIdErrorKey(code)!;
      expect(en.auth.talerId.errors[key], code).toBeTruthy();
    }
  });
});
