import { NextRequest, NextResponse } from "next/server";
import {
  bboxFromCenter,
  fetchChargersInBBox,
  filterMockByBBox,
  type BBox,
} from "@/lib/overpass-chargers";
import { MOCK_CHARGERS } from "@/lib/chargers-mock";
import { readMiniBanners } from "@/lib/marketing/content-service";
import { sessionUser } from "@/lib/exchange/api";
import { searchPoints } from "@/lib/points/point-search";
import { pointToStation } from "@/lib/points/point-to-station";
import { oursOnly, parseMapFilters } from "@/lib/mobile/map-filters";
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

// §27 «мощность» — четыре ступени навигатора, в киловаттах снизу.
const MIN_POWER_KW: Record<string, number> = {
  ac_slow: 0,
  ac_fast: 11,
  dc_fast: 50,
  dc_ultra: 150,
};

// В навигаторе разъёмы названы по-человечески, у нас в базе — enum.
const CONNECTOR_ENUM: Record<string, string> = {
  CCS2: "CCS2",
  CHAdeMO: "CHAdeMO",
  Type2: "TYPE2",
  Type1: "TYPE1",
  Tesla: "TESLA",
  "GB/T": "GB_T",
  Schuko: "SCHUKO",
};

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

  const filters = parseMapFilters(req.nextUrl.searchParams);
  // Семь фильтров §27 опираются на поля, которых у чужого пина нет: пустить
  // его в такую выдачу — соврать о нём. Заодно экономится запрос к Overpass.
  //
  // `fast=1` — тот же расчёт по другой причине. Холодный запрос в Overpass
  // идёт до двадцати шести секунд, и всё это время водитель смотрит на
  // «Загружаем станции…». Поэтому список спрашивает дважды: сперва быстро и
  // только наши пункты (они в нашей базе, это миллисекунды), потом полный
  // ответ, который приходит следом и заменяет список.
  const onlyOurs = oursOnly(filters) || req.nextUrl.searchParams.get("fast") === "1";
  const minPowerKw = filters.power != null ? MIN_POWER_KW[filters.power] : null;

  // Расстояния считает сервер, если водитель поделился местоположением.
  const atLat = parseFloat(req.nextUrl.searchParams.get("atLat") ?? "");
  const atLng = parseFloat(req.nextUrl.searchParams.get("atLng") ?? "");
  const near =
    Number.isFinite(atLat) && Number.isFinite(atLng) ? { lat: atLat, lng: atLng } : null;

  const [result, priceIndex, ours] = await Promise.all([
    onlyOurs
      ? Promise.resolve({
          stations: [] as ChargerStation[],
          source: "live" as const,
          mirror: undefined,
          error: undefined,
        })
      : fetchChargersInBBox(parsed, {
          mockFallback: () => filterMockByBBox(MOCK_CHARGERS, parsed),
        }),
    fetchOperatorPriceIndex().catch(() => new Map()),
    // Our own points (§28): moderated cards with live occupancy. A failure
    // here must not take the map down with it.
    searchPoints({
      bbox: parsed,
      connector: filters.connector ? CONNECTOR_ENUM[filters.connector] : null,
      minPowerKw,
      freeOnly: filters.freeOnly,
      type: filters.type,
      maxPriceFiat: filters.maxPriceFiat,
      maxPriceTokens: filters.maxPriceTokens,
      open24: filters.open24,
      paymentMethod: filters.paymentMethod,
      greenOnly: filters.greenOnly,
      near,
    }).catch((err) => {
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

  // §41 — a banner in the mini-card, but only ours: an OpenStreetMap pin has
  // no partner to advertise. A failure here must not take the map down.
  const viewer = await sessionUser().catch(() => null);
  const banners = await readMiniBanners(
    ours.map((p) => p.id),
    viewer?.id ?? null,
  ).catch((err) => {
    console.error("[chargers] banner lookup failed", err);
    return new Map<string, string>();
  });

  // Ours first: they are the ones a driver can actually be promised a free
  // connector at.
  const merged = [
    ...ours.map((p) => {
      const station = pointToStation(p);
      const bannerAssetId = banners.get(p.id) ?? null;
      return bannerAssetId ? { ...station, bannerAssetId } : station;
    }),
    ...stations,
  ];

  const headers: Record<string, string> = {
    "X-Source": result.source,
    "X-Count": String(merged.length),
    "X-Points": String(ours.length),
  };
  if (onlyOurs) headers["X-Ours-Only"] = "1";
  if (req.nextUrl.searchParams.get("fast") === "1") headers["X-Fast"] = "1";
  if (result.mirror) headers["X-Mirror"] = result.mirror;
  if (result.error) headers["X-Error"] = result.error.slice(0, 200);

  return NextResponse.json(merged, { headers });
}
