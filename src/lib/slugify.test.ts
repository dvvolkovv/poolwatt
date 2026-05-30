import { describe, it, expect } from "vitest";
import { slugify } from "./slugify";

describe("slugify", () => {
  it("lowercases", () => {
    expect(slugify("SolarCo")).toBe("solarco");
  });

  it("converts spaces to dashes", () => {
    expect(slugify("Solar Co Ltd")).toBe("solar-co-ltd");
  });

  it("strips non-alphanumeric except dash", () => {
    expect(slugify("Solar! Co. & Co.")).toBe("solar-co-co");
  });

  it("collapses multiple dashes", () => {
    expect(slugify("Solar  ---  Co")).toBe("solar-co");
  });

  it("trims leading/trailing dashes", () => {
    expect(slugify("---Solar---")).toBe("solar");
  });

  it("transliterates cyrillic", () => {
    expect(slugify("СолярКо")).toBe("solyarko");
  });

  it("handles slovak diacritics", () => {
    expect(slugify("Solárko s.r.o.")).toBe("solarko-sro");
  });

  it("caps at 60 chars", () => {
    const long = "a".repeat(100);
    expect(slugify(long).length).toBe(60);
  });

  it("returns 'x' for empty input", () => {
    expect(slugify("")).toBe("x");
    expect(slugify("!!!")).toBe("x");
  });
});
