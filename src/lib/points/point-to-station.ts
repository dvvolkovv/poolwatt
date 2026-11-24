// A Poolwatt point, in the shape the navigator already draws.
//
// The map, the sidebar and the station card all speak ChargerStation. Our
// points are richer — they know who owns them and how busy they are — so they
// are projected into that shape with the extra facts carried alongside,
// rather than giving the navigator a second kind of thing to render.

import type { ChargerStation, ConnectorType, Connection } from "@/lib/chargers";
import { classifyPower } from "@/lib/chargers";
import type { FoundPoint } from "./point-search";

const CONNECTOR_NAMES: Record<string, ConnectorType> = {
  CCS2: "CCS2",
  CHAdeMO: "CHAdeMO",
  TYPE2: "Type2",
  TYPE1: "Type1",
  TESLA: "Tesla",
  GB_T: "GB/T",
  SCHUKO: "Schuko",
};

const RENEWABLE = new Set(["SOLAR", "WIND", "BIOGAS", "HYDRO"]);

export function pointToStation(point: FoundPoint): ChargerStation {
  const connections: Connection[] = point.connectors.map((c) => ({
    connectorType: CONNECTOR_NAMES[c.type] ?? "Type2",
    powerKw: c.powerKw,
    voltageV: null,
    ampereA: null,
    currentType: c.powerKw > 43 ? "DC" : "AC",
    quantity: c.quantity,
    availability: c.status,
  }));

  const maxPowerKw = connections.reduce((max, c) => Math.max(max, c.powerKw), 0);

  return {
    id: point.id,
    title: point.name,
    operator: point.operatorName ?? "",
    address: point.addressLine ?? "",
    city: point.city ?? "",
    country: point.country ?? "",
    lat: point.latitude,
    lng: point.longitude,
    status: "operational",
    usageType: "public",
    connections,
    totalPoints: connections.reduce((n, c) => n + c.quantity, 0),
    maxPowerKw,
    powerLevel: classifyPower(maxPowerKw),
    costInfo:
      point.priceFiat != null ? `${point.priceFiat.toFixed(2)} ${point.currency}/kWh` : null,
    openHours: point.open24 ? "24/7" : null,
    rating: null,
    lastVerified: null,
    photoUrl: null,
    renewable: point.energySource ? RENEWABLE.has(point.energySource) : false,
    operatorPrice:
      point.priceFiat != null
        ? {
            pricePerKwh: point.priceFiat.toString(),
            currency: point.currency,
            updatedAt: new Date().toISOString(),
          }
        : null,
    poolwattPointId: point.id,
    priceTokens: point.priceTokens,
  };
}
