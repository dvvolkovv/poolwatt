// Найденный вид — это ссылка: фильтры живут в адресе, как в навигаторе на
// монитор. Мусор в адресе не ломает экран, он просто ничего не фильтрует.

import { describe, it, expect } from "vitest";
import {
  activeCount,
  EMPTY_FILTERS,
  oursOnly,
  parseMapFilters,
  toQuery,
  type MapFilters,
} from "./map-filters";

function parse(search: string): MapFilters {
  return parseMapFilters(new URLSearchParams(search));
}

describe("parseMapFilters", () => {
  it("reads every filter of §27", () => {
    const f = parse(
      "type=POWERBANK&connector=CCS2&power=dc_fast&free=1&maxFiat=0.25&maxTokens=1.1&open24=1&pay=WHITE_LABEL_CARD&green=1",
    );
    expect(f).toEqual({
      type: "POWERBANK",
      connector: "CCS2",
      power: "dc_fast",
      freeOnly: true,
      maxPriceFiat: 0.25,
      maxPriceTokens: 1.1,
      open24: true,
      paymentMethod: "WHITE_LABEL_CARD",
      greenOnly: true,
    });
  });

  it("ignores values outside the vocabulary", () => {
    expect(parse("type=MOON&connector=Banana&power=warp&pay=cash")).toEqual(EMPTY_FILTERS);
  });

  it("ignores a price that is not a positive number", () => {
    expect(parse("maxFiat=abc&maxTokens=-3").maxPriceFiat).toBeNull();
    expect(parse("maxFiat=abc&maxTokens=-3").maxPriceTokens).toBeNull();
  });

  it("treats anything but 1 as off for the switches", () => {
    const f = parse("free=yes&open24=true&green=0");
    expect(f.freeOnly).toBe(false);
    expect(f.open24).toBe(false);
    expect(f.greenOnly).toBe(false);
  });

  it("gives an empty address empty filters", () => {
    expect(parse("")).toEqual(EMPTY_FILTERS);
  });
});

describe("toQuery", () => {
  it("writes back exactly what was set, and nothing else", () => {
    const q = toQuery({ ...EMPTY_FILTERS, type: "POWERBANK", freeOnly: true });
    expect(q).toBe("type=POWERBANK&free=1");
  });

  it("survives a round trip", () => {
    const f = parse("connector=CCS2&maxFiat=0.25&green=1");
    expect(parseMapFilters(new URLSearchParams(toQuery(f)))).toEqual(f);
  });

  it("writes nothing for empty filters", () => {
    expect(toQuery(EMPTY_FILTERS)).toBe("");
  });
});

describe("activeCount", () => {
  it("counts nothing for empty filters", () => {
    expect(activeCount(EMPTY_FILTERS)).toBe(0);
  });

  it("counts what is set, switches included", () => {
    expect(activeCount({ ...EMPTY_FILTERS, type: "POWERBANK", freeOnly: true })).toBe(2);
  });
});

describe("oursOnly", () => {
  it("is false while nothing is filtered", () => {
    expect(oursOnly(EMPTY_FILTERS)).toBe(false);
  });

  it("is true for a filter an OpenStreetMap pin cannot answer", () => {
    expect(oursOnly({ ...EMPTY_FILTERS, freeOnly: true })).toBe(true);
    expect(oursOnly({ ...EMPTY_FILTERS, maxPriceTokens: 1 })).toBe(true);
    expect(oursOnly({ ...EMPTY_FILTERS, paymentMethod: "WHITE_LABEL_CARD" })).toBe(true);
    expect(oursOnly({ ...EMPTY_FILTERS, greenOnly: true })).toBe(true);
    expect(oursOnly({ ...EMPTY_FILTERS, type: "POWERBANK" })).toBe(true);
    expect(oursOnly({ ...EMPTY_FILTERS, open24: true })).toBe(true);
    expect(oursOnly({ ...EMPTY_FILTERS, maxPriceFiat: 0.3 })).toBe(true);
  });

  it("is false for the two filters a foreign pin can answer", () => {
    expect(oursOnly({ ...EMPTY_FILTERS, connector: "CCS2" })).toBe(false);
    expect(oursOnly({ ...EMPTY_FILTERS, power: "dc_fast" })).toBe(false);
  });
});
