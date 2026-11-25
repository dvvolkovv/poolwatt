import { describe, it, expect } from "vitest";
import {
  DEFAULT_LAYOUT,
  WIDGET_KEYS,
  isStorageWidget,
  parseLayout,
} from "./widgets";

describe("widget catalogue — ТЗ §30, US-27", () => {
  it("offers only widgets with real data behind them", () => {
    // Own consumption, the weather forecast and CO₂ have no source yet, so
    // they are not in the catalogue at all.
    expect(WIDGET_KEYS).not.toContain("consumption");
    expect(WIDGET_KEYS).not.toContain("weatherForecast");
    expect(WIDGET_KEYS).not.toContain("co2");
    expect(WIDGET_KEYS).toContain("nowKw");
    expect(WIDGET_KEYS).toContain("priceForecast");
  });

  it("has a built-in layout made of known widgets", () => {
    expect(DEFAULT_LAYOUT.length).toBeGreaterThan(3);
    for (const w of DEFAULT_LAYOUT) expect(WIDGET_KEYS).toContain(w.key);
  });

  it("knows which widgets only make sense with a storage", () => {
    expect(isStorageWidget("storageSoc")).toBe(true);
    expect(isStorageWidget("nowKw")).toBe(false);
  });
});

describe("parseLayout — US-27 'сохранение раскладок'", () => {
  it("accepts a layout of known widgets and sizes", () => {
    const layout = parseLayout([
      { key: "nowKw", size: "L" },
      { key: "revenue", size: "M" },
    ]);
    expect(layout).toEqual([
      { key: "nowKw", size: "L" },
      { key: "revenue", size: "M" },
    ]);
  });

  it("defaults a missing size to one cell", () => {
    expect(parseLayout([{ key: "today" }])).toEqual([{ key: "today", size: "S" }]);
  });

  it("refuses an empty layout — a panel with nothing on it is not a panel", () => {
    expect(() => parseLayout([])).toThrow(/empty|widget/i);
  });

  it("refuses a widget nobody can render", () => {
    expect(() => parseLayout([{ key: "co2", size: "S" }])).toThrow(/co2/);
  });

  it("refuses a size nobody can lay out", () => {
    expect(() => parseLayout([{ key: "today", size: "XXL" }])).toThrow(/size/i);
  });

  it("refuses the same widget twice", () => {
    expect(() =>
      parseLayout([
        { key: "today", size: "S" },
        { key: "today", size: "M" },
      ]),
    ).toThrow(/twice|duplicate/i);
  });

  it("refuses a layout longer than the catalogue", () => {
    const tooMany = [...WIDGET_KEYS, "today"].map((key) => ({ key, size: "S" }));
    expect(() => parseLayout(tooMany)).toThrow();
  });

  it("refuses what is not a list at all", () => {
    expect(() => parseLayout("today")).toThrow();
    expect(() => parseLayout(null)).toThrow();
    expect(() => parseLayout([{ size: "S" }])).toThrow();
  });
});
