import { NextRequest, NextResponse } from "next/server";
import {
  bboxFromCenter,
  fetchChargersInBBox,
  filterMockByBBox,
  type BBox,
} from "@/lib/overpass-chargers";
import { MOCK_CHARGERS } from "@/lib/chargers-mock";

const MAX_RADIUS_KM = 80;

// Accepts either ?lat=&lng=&radius= (legacy) or
// ?south=&west=&north=&east= (preferred — matches what the map already
// knows). The bbox path lets the client stop pretending its viewport is
// circular, so wide-zoom searches finally return data.
function parseBBox(sp: URLSearchParams): BBox | { error: string } {
  const south = sp.get("south");
  const west = sp.get("west");
  const north = sp.get("north");
  const east = sp.get("east");

  if (south && west && north && east) {
    const s = parseFloat(south);
    const w = parseFloat(west);
    const n = parseFloat(north);
    const e = parseFloat(east);
    if (![s, w, n, e].every(Number.isFinite)) {
      return { error: "bbox params must be numeric" };
    }
    if (n <= s || e <= w) {
      return { error: "bbox must satisfy north>south and east>west" };
    }
    return { south: s, west: w, north: n, east: e };
  }

  const lat = sp.get("lat");
  const lng = sp.get("lng");
  if (!lat || !lng) {
    return { error: "either bbox (south/west/north/east) or lat+lng required" };
  }
  const latF = parseFloat(lat);
  const lngF = parseFloat(lng);
  const radius = Math.min(parseFloat(sp.get("radius") ?? "25"), MAX_RADIUS_KM);
  return bboxFromCenter(latF, lngF, radius);
}

export async function GET(req: NextRequest) {
  const parsed = parseBBox(req.nextUrl.searchParams);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await fetchChargersInBBox(parsed, {
    mockFallback: () => filterMockByBBox(MOCK_CHARGERS, parsed),
  });

  const headers: Record<string, string> = {
    "X-Source": result.source,
    "X-Count": String(result.stations.length),
  };
  if (result.mirror) headers["X-Mirror"] = result.mirror;
  if (result.error) headers["X-Error"] = result.error.slice(0, 200);

  return NextResponse.json(result.stations, { headers });
}
