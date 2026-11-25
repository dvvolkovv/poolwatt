import { describe, it, expect } from "vitest";
import { qrSvg } from "./receipt-qr";

describe("qrSvg", () => {
  it("draws inline SVG with no XML prolog", async () => {
    const svg = await qrSvg("https://poolwatt.com/r/deadbeef");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toContain("<?xml");
    expect(svg).toContain("</svg>");
  });

  it("encodes different URLs differently", async () => {
    const a = await qrSvg("https://poolwatt.com/r/aaaa");
    const b = await qrSvg("https://poolwatt.com/r/bbbb");
    expect(a).not.toBe(b);
  });
});
