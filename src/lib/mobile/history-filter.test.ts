import { describe, it, expect } from "vitest";
import { HISTORY_FILTERS, kindsForFilter, parseHistoryFilter } from "./history-filter";

describe("parseHistoryFilter", () => {
  it("defaults to everything", () => {
    expect(parseHistoryFilter(undefined)).toBe("all");
    expect(parseHistoryFilter("")).toBe("all");
  });

  it("reads a known chip", () => {
    expect(parseHistoryFilter("charge")).toBe("charge");
    expect(parseHistoryFilter("gift")).toBe("gift");
  });

  it("does not break on rubbish in the address", () => {
    expect(parseHistoryFilter("../etc/passwd")).toBe("all");
    expect(parseHistoryFilter("CHARGE")).toBe("all");
  });
});

describe("kindsForFilter", () => {
  it("asks for no filter at all when everything is wanted", () => {
    expect(kindsForFilter("all")).toBeUndefined();
  });

  it("maps a chip onto the kinds of the service", () => {
    expect(kindsForFilter("buy")).toEqual(["BUY"]);
    expect(kindsForFilter("sell")).toEqual(["SELL"]);
    expect(kindsForFilter("charge")).toEqual(["CHARGE"]);
    expect(kindsForFilter("gift")).toEqual(["GIFT"]);
  });

  it("puts both directions of a transfer under one chip", () => {
    expect(kindsForFilter("transfer")).toEqual(["TRANSFER_IN", "TRANSFER_OUT"]);
  });

  it("offers every chip exactly once, 'all' first", () => {
    expect(HISTORY_FILTERS[0]).toBe("all");
    expect(new Set(HISTORY_FILTERS).size).toBe(HISTORY_FILTERS.length);
  });
});
