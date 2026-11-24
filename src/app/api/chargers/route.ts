import { NextRequest, NextResponse } from "next/server";
import {
  bboxFromCenter,
  fetchChargersInBBox,
  filterMockByBBox,
  type BBox,
} from "@/lib/overpass-chargers";
import { MOCK_CHARGERS } from "@/lib/chargers-mock";
import { searchPoints } from "@/lib/points/point-search";
import { pointToStation } from "@/lib/points/point-to-station";
import { prisma } from "@/lib/prisma";
import type { ChargerStation } from "@/lib/chargers";

type OperatorPriceRow = {
  aliases: string[];
  pricePerKwh: { toString(): string };
  priceCurrency: string;
  priceUpdatedAt: Date;
};

// Pull every operator that has a published tariff and build an alias lookup.
// At Phase-1 scale this is a handful of rows; cache only if it ever shows up
// in profiles.
async function fetchOperatorPriceIndex(): Promise<
  Map<string, ChargerStation["operatorPrice"]>
> {
  const rows = (await prisma.chargerOperator.findMany({
    where: { pricePerKwh: { not: null }, priceCurrency: { not: null }, priceUpdatedAt: { not: null } },
    select: { aliases: true, pricePerKwh: true, priceCurrency: true, priceUpdatedAt: true },
  })) as unknown as OperatorPriceRow[];

  const index = new Map<string, ChargerStation["operatorPrice"]>();
  for (const r of rows) {
    const entry = {
      pricePerKwh: r.pricePerKwh.toString(),
      currency: r.priceCurrency,
      updatedAt: r.priceUpdatedAt.toISOString(),
    };
    for (const alias of r.aliases) {
      index.set(alias.toLowerCase(), entry);
    }
  }
  return index;
}

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

  const [result, priceIndex, ours] = await Promise.all([
    fetchChargersInBBox(parsed, {
      mockFallback: () => filterMockByBBox(MOCK_CHARGERS, parsed),
    }),
    fetchOperatorPriceIndex().catch(() => new Map()),
    // Our own points (§28): moderated cards with live occupancy. A failure
    // here must not take the map down with it.
    searchPoints({ bbox: parsed }).catch((err) => {
      console.error("[chargers] point search failed", err);
      return [];
    }),
  ]);

  // Inject operator-published price (Step 2) for stations whose `operator`
  // string matches a claimed operator's alias.
  const stations = priceIndex.size === 0
    ? result.stations
    : result.stations.map((s) => {
        const match = priceIndex.get(s.operator.toLowerCase());
        return match ? { ...s, operatorPrice: match } : s;
      });

  // Ours first: they are the ones a driver can actually be promised a free
  // connector at.
  const merged = [...ours.map(pointToStation), ...stations];

  const headers: Record<string, string> = {
    "X-Source": result.source,
    "X-Count": String(merged.length),
    "X-Points": String(ours.length),
  };
  if (result.mirror) headers["X-Mirror"] = result.mirror;
  if (result.error) headers["X-Error"] = result.error.slice(0, 200);

  return NextResponse.json(merged, { headers });
}
