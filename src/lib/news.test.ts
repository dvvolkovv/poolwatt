import { describe, it, expect } from "vitest";
import { classifyTheme, dedupe, mergeAndRank, type NewsItem } from "./news";

describe("classifyTheme", () => {
  it("classifies pure-category headlines", () => {
    expect(classifyTheme("New rooftop solar installations top 2 GW")).toBe("solar");
    expect(classifyTheme("Offshore wind turbine project clears NEPA review")).toBe("wind");
    expect(classifyTheme("Tesla unveils Megapack 3 with 5 MWh storage capacity")).toBe("storage");
    expect(classifyTheme("Utility commissions new microgrid for rural customers")).toBe("grid");
    expect(classifyTheme("EPA finalizes new clean-energy tax credit regulations")).toBe("policy");
  });

  it("falls back to general when nothing matches", () => {
    expect(classifyTheme("Quarterly earnings beat analyst expectations")).toBe("general");
  });

  it("policy beats other buckets", () => {
    // "Solar permit" matches solar (panel? no — solar yes) AND policy (permit).
    // Policy is most specific.
    expect(classifyTheme("California EPA delays solar permitting rules")).toBe("policy");
  });

  it("storage beats grid when both keywords appear", () => {
    // "grid batteries" matches grid (grid) and storage (battery). Storage first.
    expect(classifyTheme("Utilities install 2 GWh of grid batteries in Texas")).toBe(
      "storage",
    );
  });

  it("wind beats solar when both keywords appear", () => {
    // "wind" listed before "solar" in priority order.
    expect(classifyTheme("Hybrid solar-and-wind plant breaks ground in Spain")).toBe(
      "wind",
    );
  });

  it("is case-insensitive", () => {
    expect(classifyTheme("OFFSHORE WIND project announced")).toBe("wind");
  });
});

describe("dedupe", () => {
  function mk(url: string, title = "x"): NewsItem {
    return {
      title,
      url,
      source: "test",
      publishedAt: 0,
      theme: "general",
      imageUrl: null,
    };
  }

  it("removes URL duplicates, preserves first occurrence", () => {
    const out = dedupe([mk("https://a.example", "first"), mk("https://a.example", "second")]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("first");
  });

  it("keeps distinct URLs", () => {
    const out = dedupe([mk("https://a.example"), mk("https://b.example")]);
    expect(out).toHaveLength(2);
  });
});

describe("mergeAndRank", () => {
  function mk(url: string, publishedAt: number): NewsItem {
    return {
      title: "x",
      url,
      source: "test",
      publishedAt,
      theme: "general",
      imageUrl: null,
    };
  }

  it("sorts newest-first then dedupes then truncates", () => {
    const out = mergeAndRank(
      [
        [mk("https://a.example", 100), mk("https://b.example", 200)],
        [mk("https://c.example", 300), mk("https://a.example", 150)],
      ],
      2,
    );
    expect(out.map((i) => i.url)).toEqual(["https://c.example", "https://b.example"]);
  });

  it("respects the limit", () => {
    const out = mergeAndRank([[mk("https://a", 1), mk("https://b", 2), mk("https://c", 3)]], 2);
    expect(out).toHaveLength(2);
  });
});
