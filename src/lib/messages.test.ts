// Переводы 26 языков из 29 неполны нарочно: английский, русский и словацкий
// держат все разделы, остальные переводчики добирают постепенно. На сервере
// недостающую строку подменял `getMessageFallback`, но он спасает только
// **строку**. Когда у языка нет целого раздела, клиентский компонент —
// например гамбургер с его `useTranslations("nav")` — получал
// `MISSING_MESSAGE: nav (zh)` и рисовал вместо названий разделов служебные
// ключи. Поэтому английский подкладывается основанием под каждый язык.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mergeMessages } from "./messages";
import { SUPPORTED_LOCALES, COMPLETE_LOCALES } from "./locales";

const DIR = join(process.cwd(), "messages");
const read = (locale: string) =>
  JSON.parse(readFileSync(join(DIR, `${locale}.json`), "utf8"));

describe("mergeMessages", () => {
  it("берёт перевод языка, когда он есть", () => {
    const merged = mergeMessages({ a: "en", b: "en" }, { a: "ru" });
    expect(merged.a).toBe("ru");
  });

  it("подставляет английский там, где перевода нет", () => {
    const merged = mergeMessages({ a: "en", b: "en" }, { a: "ru" });
    expect(merged.b).toBe("en");
  });

  it("добирает вглубь, а не только верхний уровень", () => {
    const merged = mergeMessages(
      { nav: { items: { chargers: "Chargers", hubs: "Hubs" } } },
      { nav: { items: { chargers: "Зарядки" } } },
    );
    expect(merged.nav).toEqual({
      items: { chargers: "Зарядки", hubs: "Hubs" },
    });
  });

  it("не трогает исходные объекты", () => {
    const base = { nav: { a: "en" } };
    const over = { nav: { b: "ru" } };
    mergeMessages(base, over);
    expect(base).toEqual({ nav: { a: "en" } });
    expect(over).toEqual({ nav: { b: "ru" } });
  });
});

describe("разделы есть у каждого языка", () => {
  const en = read("en");

  it("все файлы переводов на месте", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(SUPPORTED_LOCALES.length);
  });

  // Разделы, которые читают клиентские компоненты: у них нет серверной
  // подмены, и отсутствие раздела целиком — это ошибка в браузере.
  for (const locale of SUPPORTED_LOCALES) {
    it(`у «${locale}» есть разделы, которые нужны браузеру`, () => {
      const merged = mergeMessages(en, read(locale)) as Record<
        string,
        Record<string, unknown>
      >;
      for (const namespace of ["nav", "common", "cabinetTiles", "settings"]) {
        expect(merged[namespace], `${namespace} (${locale})`).toBeTruthy();
      }
      expect(
        (merged.nav as { items: Record<string, string> }).items.chargers,
      ).toBeTruthy();
      expect(
        (merged.cabinetTiles as { boards: Record<string, string> }).boards.root,
      ).toBeTruthy();
    });
  }
});

describe("список предлагаемых языков не врёт", () => {
  const en = read("en");
  const flatten = (tree: Record<string, unknown>, prefix = ""): string[] => {
    const out: string[] = [];
    for (const [key, value] of Object.entries(tree)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === "object") {
        out.push(...flatten(value as Record<string, unknown>, path));
      } else {
        out.push(path);
      }
    }
    return out;
  };
  const keys = flatten(en);

  const complete = SUPPORTED_LOCALES.filter((locale) => {
    const own = new Set(flatten(read(locale)));
    return keys.every((key) => own.has(key));
  });

  it("предлагаются ровно те языки, у которых переведено всё", () => {
    // Падение здесь — хорошая новость: словарь дособрали, и язык пора
    // добавить в `COMPLETE_LOCALES`. Или наоборот: из словаря что-то пропало.
    expect([...COMPLETE_LOCALES].sort()).toEqual([...complete].sort());
  });

  it("английский, русский и словацкий в списке всегда", () => {
    for (const locale of ["en", "ru", "sk"]) {
      expect(COMPLETE_LOCALES).toContain(locale);
    }
  });
});
