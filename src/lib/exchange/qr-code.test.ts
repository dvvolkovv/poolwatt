import { describe, expect, it } from "vitest";
import { buildConnectorCode, parseConnectorCode } from "./qr-code";

describe("parseConnectorCode", () => {
  it("reads the compact form", () => {
    expect(parseConnectorCode("PW1:point123:conn456")).toEqual({
      pointId: "point123",
      connectorId: "conn456",
    });
  });

  it("reads a point without a connector", () => {
    expect(parseConnectorCode("PW1:point123")).toEqual({
      pointId: "point123",
      connectorId: null,
    });
  });

  it("reads the address form a camera sees on a printed sticker", () => {
    expect(
      parseConnectorCode("https://poolwatt.com/ru/app/charge/start?p=point123&c=conn456"),
    ).toEqual({ pointId: "point123", connectorId: "conn456" });
  });

  it("ignores case and spaces around the code", () => {
    expect(parseConnectorCode("  pw1:point123:conn456  ")).toEqual({
      pointId: "point123",
      connectorId: "conn456",
    });
  });

  it("refuses a code of somebody else's network", () => {
    expect(parseConnectorCode("https://example.com/charge/42")).toBeNull();
    expect(parseConnectorCode("OCPI:FR*ABC*E1234")).toBeNull();
    expect(parseConnectorCode("")).toBeNull();
    expect(parseConnectorCode(null)).toBeNull();
  });

  it("refuses identifiers that cannot be ours", () => {
    expect(parseConnectorCode("PW1:no spaces allowed")).toBeNull();
    expect(parseConnectorCode(`PW1:${"x".repeat(41)}`)).toBeNull();
  });

  it("builds what it can read", () => {
    const code = buildConnectorCode("point123", "conn456");
    expect(code).toBe("PW1:point123:conn456");
    expect(parseConnectorCode(code)).toEqual({
      pointId: "point123",
      connectorId: "conn456",
    });
    expect(parseConnectorCode(buildConnectorCode("point123"))).toEqual({
      pointId: "point123",
      connectorId: null,
    });
  });
});
