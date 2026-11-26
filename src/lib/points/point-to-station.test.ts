// Пин на карте показывает §27 «тип и доступность», а мини-карточка — цену в
// токенах и способы оплаты. Всё это есть у нашего пункта и нет у чужого
// пина, поэтому оно должно доехать до карты.

import { describe, it, expect } from "vitest";
import { pointToStation } from "./point-to-station";
import type { FoundPoint } from "./point-search";

const BASE: FoundPoint = {
  id: "p1",
  name: "Powerbank u Jozefa",
  operatorName: "Net",
  type: "POWERBANK",
  city: "Bratislava",
  country: "SK",
  addressLine: "Hlavná 1",
  latitude: 48.15,
  longitude: 17.11,
  energySource: "SOLAR",
  open24: true,
  priceFiat: 0.21,
  priceTokens: 1.05,
  currency: "EUR",
  idleFeePerMin: null,
  paymentMethods: ["TOKEN", "WHITE_LABEL_CARD"],
  priceZoneKnown: true,
  connectors: [{ type: "SCHUKO", powerKw: 3.7, quantity: 2, status: "FREE" }],
  distanceM: 400,
};

describe("pointToStation", () => {
  it("carries the point type, the payment methods and 24/7", () => {
    const s = pointToStation(BASE);
    expect(s.pointType).toBe("POWERBANK");
    expect(s.paymentMethods).toEqual(["TOKEN", "WHITE_LABEL_CARD"]);
    expect(s.open24).toBe(true);
    expect(s.distanceM).toBe(400);
  });

  it("keeps the price in tokens next to the price in money", () => {
    const s = pointToStation(BASE);
    expect(s.priceTokens).toBe(1.05);
    expect(s.costInfo).toBe("0.21 EUR/kWh");
  });

  it("says when the price was picked by UTC rather than by local hours", () => {
    const s = pointToStation({ ...BASE, country: null, priceZoneKnown: false });
    expect(s.priceZoneKnown).toBe(false);
  });
});
