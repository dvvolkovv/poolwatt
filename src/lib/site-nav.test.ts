// Разделы сайта как данные. Главный тест здесь — не поведение `visibleNav`,
// а то, что в меню нет адреса, которого нет в продукте: до этой работы три
// ссылки из семи в шапке и три в подвале отдавали 404 на живой сборке.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SITE_NAV, visibleNav, type NavItem } from "./site-nav";

const APP_DIR = join(process.cwd(), "src", "app", "[locale]");

/** Путь из меню → файл страницы на диске. `/` — это сам `[locale]`. */
function pageFileFor(href: string): string {
  const segments = href.split("/").filter(Boolean);
  return join(APP_DIR, ...segments, "page.tsx");
}

function allItems(): NavItem[] {
  return SITE_NAV.flatMap((group) => group.items);
}

describe("SITE_NAV", () => {
  it("каждый адрес ведёт на страницу, которая есть на диске", () => {
    const dead = allItems()
      .filter((item) => !existsSync(pageFileFor(item.href)))
      .map((item) => `${item.key} → ${item.href}`);
    expect(dead).toEqual([]);
  });

  it("адреса начинаются со слэша и не несут язык", () => {
    for (const item of allItems()) {
      expect(item.href.startsWith("/")).toBe(true);
      expect(item.href).not.toMatch(/^\/(ru|sk|en|de|uk|cs|pl)(\/|$)/);
    }
  });

  it("один адрес не встречается в меню дважды", () => {
    const hrefs = allItems().map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("у каждой группы есть разделы", () => {
    for (const group of SITE_NAV) {
      expect(group.items.length).toBeGreaterThan(0);
    }
  });
});

describe("visibleNav", () => {
  const keys = (ctx: { signedIn: boolean; operator: boolean }) =>
    visibleNav(ctx).map((g) => g.key);

  it("гость видит общие группы и не видит своих разделов", () => {
    const groups = keys({ signedIn: false, operator: false });
    expect(groups).toContain("energy");
    expect(groups).toContain("apps");
    expect(groups).not.toContain("mine");
    expect(groups).not.toContain("operator");
  });

  it("вошедший видит свои разделы", () => {
    expect(keys({ signedIn: true, operator: false })).toContain("mine");
  });

  it("админка только у оператора", () => {
    expect(keys({ signedIn: true, operator: false })).not.toContain("operator");
    expect(keys({ signedIn: true, operator: true })).toContain("operator");
  });

  it("группа гостя не содержит разделов для вошедших", () => {
    const guest = visibleNav({ signedIn: false, operator: false });
    for (const group of guest) {
      for (const item of group.items) {
        expect(item.audience).toBe("anyone");
      }
    }
  });

  it("пустых групп не отдаёт", () => {
    for (const ctx of [
      { signedIn: false, operator: false },
      { signedIn: true, operator: false },
      { signedIn: true, operator: true },
    ]) {
      for (const group of visibleNav(ctx)) {
        expect(group.items.length).toBeGreaterThan(0);
      }
    }
  });
});
