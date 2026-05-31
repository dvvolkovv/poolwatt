import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyPower,
  type ChargerStation,
  type ChargerStatus,
  type Connection,
} from "./chargers";

// Overpass is a public OSM read API. Single instances time out on dense
// cities (Berlin reproducibly returns 504), so we round-robin three
// mirrors and persist results on disk so a hot bbox survives a `pm2
// restart` (the in-RAM Map we had before vanished on every web bounce).

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];

const PER_MIRROR_TIMEOUT_MS = 12_000;
const FRESH_TTL_MS = 24 * 60 * 60 * 1000;
const STALE_HARD_LIMIT_MS = 14 * 24 * 60 * 60 * 1000;
const OVERPASS_TIMEOUT_S = 25;
const MAX_NODES = 500;

// Lazy lookup — process.env.OVERPASS_CACHE_DIR is read per-call so tests
// can swap cache directories without re-importing the module.
function getCacheDir(): string {
  return process.env.OVERPASS_CACHE_DIR ?? join(tmpdir(), "poolwatt-overpass");
}

export type FetchSource = "live" | "cache" | "stale" | "mock";

export type FetchResult = {
  stations: ChargerStation[];
  source: FetchSource;
  mirror?: string;
  error?: string;
};

export type BBox = { south: number; west: number; north: number; east: number };

export function bboxFromCenter(latF: number, lngF: number, radiusKm: number): BBox {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos((latF * Math.PI) / 180));
  return {
    south: latF - dLat,
    west: lngF - dLng,
    north: latF + dLat,
    east: lngF + dLng,
  };
}

function cacheKey(bbox: BBox): string {
  // Round to ~0.01° (~1km) so nearby viewport jitter shares a cache entry
  // and we don't fan out into thousands of near-duplicate files.
  const round = (n: number) => n.toFixed(2);
  const k = `${round(bbox.south)},${round(bbox.west)},${round(bbox.north)},${round(bbox.east)}`;
  return createHash("sha1").update(k).digest("hex").slice(0, 16);
}

async function readCache(
  key: string,
): Promise<{ data: ChargerStation[]; ageMs: number } | null> {
  try {
    const file = join(getCacheDir(), `${key}.json`);
    const [stat, raw] = await Promise.all([fs.stat(file), fs.readFile(file, "utf8")]);
    return { data: JSON.parse(raw), ageMs: Date.now() - stat.mtimeMs };
  } catch {
    return null;
  }
}

async function writeCache(key: string, data: ChargerStation[]): Promise<void> {
  try {
    const dir = getCacheDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, `${key}.json`), JSON.stringify(data));
  } catch {
    // Cache write failures are silent — losing a write means next call
    // is slower, not broken.
  }
}

function buildQuery(bbox: BBox): string {
  const { south, west, north, east } = bbox;
  const fixed = (n: number) => n.toFixed(5);
  return `[out:json][timeout:${OVERPASS_TIMEOUT_S}];node["amenity"="charging_station"](${fixed(south)},${fixed(west)},${fixed(north)},${fixed(east)});out body ${MAX_NODES};`;
}

type OsmElement = {
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
};

async function postOverpass(
  mirror: string,
  query: string,
  signal: AbortSignal,
): Promise<OsmElement[]> {
  const res = await fetch(mirror, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Poolwatt/0.1 (https://poolwatt.energy)",
      Accept: "application/json",
    },
    body: `data=${encodeURIComponent(query)}`,
    signal,
  });
  if (!res.ok) throw new Error(`${mirror} → HTTP ${res.status}`);
  const data = (await res.json()) as { elements?: OsmElement[] };
  return data.elements ?? [];
}

async function tryMirrors(
  query: string,
): Promise<{ elements: OsmElement[]; mirror: string }> {
  let lastErr: Error | null = null;
  for (const mirror of MIRRORS) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), PER_MIRROR_TIMEOUT_MS);
    try {
      const elements = await postOverpass(mirror, query, ac.signal);
      return { elements, mirror };
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error("All Overpass mirrors failed");
}

export async function fetchChargersInBBox(
  bbox: BBox,
  opts: { mockFallback?: () => ChargerStation[] } = {},
): Promise<FetchResult> {
  const key = cacheKey(bbox);

  const cached = await readCache(key);
  if (cached && cached.ageMs < FRESH_TTL_MS) {
    return { stations: cached.data, source: "cache" };
  }

  try {
    const { elements, mirror } = await tryMirrors(buildQuery(bbox));
    const stations = elements.map(osmToCharger);
    await writeCache(key, stations);
    return { stations, source: "live", mirror };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    if (cached && cached.ageMs < STALE_HARD_LIMIT_MS) {
      return { stations: cached.data, source: "stale", error: err };
    }
    if (opts.mockFallback) {
      return {
        stations: opts.mockFallback(),
        source: "mock",
        error: err,
      };
    }
    throw e;
  }
}

// ─── OSM tag → ChargerStation projection ──────────────────────────────
// Kept here (rather than route.ts) so the Overpass surface stays in one
// file and tests can exercise the mapping without touching Next.js types.

const GREEN_OPERATORS = new Set([
  "IONITY",
  "GreenWay",
  "Mer",
  "Circle K / Mer",
  "Greenway",
  "InCharge",
  "Vattenfall InCharge",
  "Grønn Kontakt",
  "EWE Go",
  "Naturstrom",
  "Lichtblick",
  "Polyfazer",
]);

function detectRenewable(tags: Record<string, string>, operator: string): boolean {
  if (
    tags["power_supply"] === "solar" ||
    tags["power_supply"] === "wind" ||
    tags["power_supply"] === "renewable"
  )
    return true;
  if (
    tags["energy_source"] === "solar" ||
    tags["energy_source"] === "wind" ||
    tags["energy_source"] === "renewable"
  )
    return true;
  if (tags["solar_panel"] === "yes" || tags["covered"] === "solar") return true;
  if (tags["renewable"] === "yes" || tags["green_energy"] === "yes") return true;
  if (
    tags["electricity:source"] === "renewable" ||
    tags["electricity:source"] === "solar"
  )
    return true;
  if (GREEN_OPERATORS.has(operator)) return true;
  return false;
}

function parseKw(v: string | undefined): number {
  if (!v) return 0;
  const m = v.match(/([\d.]+)\s*kW/i);
  return m ? parseFloat(m[1]) : 0;
}

function intOr(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function osmToCharger(el: OsmElement): ChargerStation {
  const t = el.tags ?? {};
  const connections: Connection[] = [];

  if (t["socket:type2"] || t["socket:type2:output"])
    connections.push({
      connectorType: "Type2",
      powerKw: parseKw(t["socket:type2:output"]) || 22,
      voltageV: 400,
      ampereA: 32,
      currentType: "AC",
      quantity: intOr(t["socket:type2"], 1),
    });
  if (t["socket:ccs2"] || t["socket:type2_combo"])
    connections.push({
      connectorType: "CCS2",
      powerKw:
        parseKw(t["socket:type2_combo:output"] || t["socket:ccs2:output"]) || 50,
      voltageV: 400,
      ampereA: 125,
      currentType: "DC",
      quantity: intOr(t["socket:ccs2"] || t["socket:type2_combo"], 1),
    });
  if (t["socket:chademo"])
    connections.push({
      connectorType: "CHAdeMO",
      powerKw: parseKw(t["socket:chademo:output"]) || 50,
      voltageV: 400,
      ampereA: 125,
      currentType: "DC",
      quantity: intOr(t["socket:chademo"], 1),
    });
  if (t["socket:tesla_supercharger"])
    connections.push({
      connectorType: "Tesla",
      powerKw: parseKw(t["socket:tesla_supercharger:output"]) || 150,
      voltageV: 400,
      ampereA: 375,
      currentType: "DC",
      quantity: intOr(t["socket:tesla_supercharger"], 1),
    });
  if (t["socket:schuko"])
    connections.push({
      connectorType: "Schuko",
      powerKw: 3.7,
      voltageV: 230,
      ampereA: 16,
      currentType: "AC",
      quantity: intOr(t["socket:schuko"], 1),
    });
  if (t["socket:type1"])
    connections.push({
      connectorType: "Type1",
      powerKw: parseKw(t["socket:type1:output"]) || 7,
      voltageV: 230,
      ampereA: 32,
      currentType: "AC",
      quantity: intOr(t["socket:type1"], 1),
    });

  if (connections.length === 0) {
    connections.push({
      connectorType: "Type2",
      powerKw: parseKw(t["charging_station:output"]) || 22,
      voltageV: 400,
      ampereA: 32,
      currentType: "AC",
      quantity: intOr(t["capacity"], 1),
    });
  }

  const maxPowerKw = Math.max(...connections.map((c) => c.powerKw), 0);
  const totalPoints =
    connections.reduce((s, c) => s + c.quantity, 0) || intOr(t["capacity"], 1);

  let status: ChargerStatus = "operational";
  if (t["disused"] === "yes" || t["operational_status"] === "broken")
    status = "temporarily_unavailable";
  if (t["construction"] === "yes" || t["planned"] === "yes") status = "planned";

  const operator = t["operator"] || t["network"] || t["brand"] || "Unknown";

  return {
    id: String(el.id),
    title: t["name"] || operator || "Charging Station",
    operator,
    address:
      [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ") || "",
    city: t["addr:city"] || "",
    country: t["addr:country"] || "",
    lat: el.lat,
    lng: el.lon,
    status,
    usageType:
      t["access"] === "private"
        ? "private"
        : t["fee"] === "yes"
          ? "pay_at_location"
          : "public",
    connections,
    totalPoints,
    maxPowerKw,
    powerLevel: classifyPower(maxPowerKw),
    costInfo:
      t["fee:description"] || t["charge"] || (t["fee"] === "no" ? "Free" : null),
    openHours: t["opening_hours"] || null,
    rating: null,
    lastVerified: null,
    photoUrl: null,
    renewable: detectRenewable(t, operator),
  };
}

// Exported only for tests / fallback ─ resolves mock chargers that fall
// inside a bbox so an Overpass blackout still shows *something*.
export function filterMockByBBox(
  mock: ChargerStation[],
  bbox: BBox,
): ChargerStation[] {
  return mock.filter(
    (s) =>
      s.lat >= bbox.south &&
      s.lat <= bbox.north &&
      s.lng >= bbox.west &&
      s.lng <= bbox.east,
  );
}
