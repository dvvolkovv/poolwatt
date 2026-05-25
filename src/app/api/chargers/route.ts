import { NextRequest, NextResponse } from "next/server";
import { classifyPower, type ChargerStation, type Connection, type ConnectorType, type ChargerStatus, type PowerLevel } from "@/lib/chargers";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

const cache = new Map<string, { data: ChargerStation[]; ts: number }>();
const TTL_MS = 10 * 60 * 1000;

function osmToCharger(el: OsmElement): ChargerStation {
  const t = el.tags ?? {};
  const connections: Connection[] = [];

  if (t["socket:type2"] || t["socket:type2:output"]) connections.push({ connectorType: "Type2", powerKw: parseKw(t["socket:type2:output"]) || 22, voltageV: 400, ampereA: 32, currentType: "AC", quantity: parseInt(t["socket:type2"] || "1") || 1 });
  if (t["socket:ccs2"] || t["socket:type2_combo"]) connections.push({ connectorType: "CCS2", powerKw: parseKw(t["socket:type2_combo:output"] || t["socket:ccs2:output"]) || 50, voltageV: 400, ampereA: 125, currentType: "DC", quantity: parseInt(t["socket:ccs2"] || t["socket:type2_combo"] || "1") || 1 });
  if (t["socket:chademo"]) connections.push({ connectorType: "CHAdeMO", powerKw: parseKw(t["socket:chademo:output"]) || 50, voltageV: 400, ampereA: 125, currentType: "DC", quantity: parseInt(t["socket:chademo"] || "1") || 1 });
  if (t["socket:tesla_supercharger"]) connections.push({ connectorType: "Tesla", powerKw: parseKw(t["socket:tesla_supercharger:output"]) || 150, voltageV: 400, ampereA: 375, currentType: "DC", quantity: parseInt(t["socket:tesla_supercharger"] || "1") || 1 });
  if (t["socket:schuko"]) connections.push({ connectorType: "Schuko", powerKw: 3.7, voltageV: 230, ampereA: 16, currentType: "AC", quantity: parseInt(t["socket:schuko"] || "1") || 1 });
  if (t["socket:type1"]) connections.push({ connectorType: "Type1", powerKw: parseKw(t["socket:type1:output"]) || 7, voltageV: 230, ampereA: 32, currentType: "AC", quantity: parseInt(t["socket:type1"] || "1") || 1 });

  if (connections.length === 0) {
    connections.push({ connectorType: "Type2", powerKw: parseKw(t["charging_station:output"]) || 22, voltageV: 400, ampereA: 32, currentType: "AC", quantity: parseInt(t["capacity"] || "1") || 1 });
  }

  const maxPowerKw = Math.max(...connections.map((c) => c.powerKw), 0);
  const totalPoints = connections.reduce((s, c) => s + c.quantity, 0) || parseInt(t["capacity"] || "1") || 1;

  let status: ChargerStatus = "operational";
  if (t["disused"] === "yes" || t["operational_status"] === "broken") status = "temporarily_unavailable";
  if (t["construction"] === "yes" || t["planned"] === "yes") status = "planned";

  const operator = t["operator"] || t["network"] || t["brand"] || "Unknown";
  const renewable = detectRenewable(t, operator);

  return {
    id: String(el.id),
    title: t["name"] || operator || "Charging Station",
    operator,
    address: [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ") || "",
    city: t["addr:city"] || "",
    country: t["addr:country"] || "",
    lat: el.lat,
    lng: el.lon,
    status,
    usageType: t["access"] === "private" ? "private" : t["fee"] === "yes" ? "pay_at_location" : "public",
    connections,
    totalPoints,
    maxPowerKw,
    powerLevel: classifyPower(maxPowerKw),
    costInfo: t["fee:description"] || t["charge"] || (t["fee"] === "no" ? "Free" : null),
    openHours: t["opening_hours"] || null,
    rating: null,
    lastVerified: null,
    photoUrl: null,
    renewable,
  };
}

const GREEN_OPERATORS = new Set([
  "IONITY", "GreenWay", "Mer", "Circle K / Mer", "Greenway",
  "InCharge", "Vattenfall InCharge", "Grønn Kontakt",
  "EWE Go", "Naturstrom", "Lichtblick", "Polyfazer",
]);

function detectRenewable(tags: Record<string, string>, operator: string): boolean {
  if (tags["power_supply"] === "solar" || tags["power_supply"] === "wind" || tags["power_supply"] === "renewable") return true;
  if (tags["energy_source"] === "solar" || tags["energy_source"] === "wind" || tags["energy_source"] === "renewable") return true;
  if (tags["solar_panel"] === "yes" || tags["covered"] === "solar") return true;
  if (tags["renewable"] === "yes" || tags["green_energy"] === "yes") return true;
  if (tags["electricity:source"] === "renewable" || tags["electricity:source"] === "solar") return true;
  if (GREEN_OPERATORS.has(operator)) return true;
  return false;
}

function parseKw(v: string | undefined): number {
  if (!v) return 0;
  const m = v.match(/([\d.]+)\s*kW/i);
  return m ? parseFloat(m[1]) : 0;
}

type OsmElement = { id: number; lat: number; lon: number; tags?: Record<string, string> };

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const lat = sp.get("lat");
  const lng = sp.get("lng");
  const radius = sp.get("radius") ?? "25";

  if (!lat || !lng) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }

  const latF = parseFloat(lat);
  const lngF = parseFloat(lng);
  const rKm = Math.min(parseFloat(radius), 50);

  const cacheKey = `${latF.toFixed(2)},${lngF.toFixed(2)},${rKm.toFixed(0)}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TTL_MS) {
    return NextResponse.json(cached.data, { headers: { "X-Cache": "HIT" } });
  }

  const dLat = rKm / 111;
  const dLng = rKm / (111 * Math.cos(latF * Math.PI / 180));
  const south = (latF - dLat).toFixed(5);
  const north = (latF + dLat).toFixed(5);
  const west = (lngF - dLng).toFixed(5);
  const east = (lngF + dLng).toFixed(5);

  const query = `[out:json][timeout:15];node["amenity"="charging_station"](${south},${west},${north},${east});out body 300;`;

  try {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Poolwatt/0.1 (https://poolwatt.energy)",
        "Accept": "application/json",
      },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Overpass API error", status: res.status }, { status: 502 });
    }

    const data = await res.json();
    const elements: OsmElement[] = data.elements ?? [];
    const stations = elements.map(osmToCharger);

    cache.set(cacheKey, { data: stations, ts: Date.now() });
    return NextResponse.json(stations, { headers: { "X-Cache": "MISS", "X-Count": String(stations.length) } });
  } catch (e) {
    return NextResponse.json({ error: "Failed to fetch stations", detail: String(e) }, { status: 500 });
  }
}
