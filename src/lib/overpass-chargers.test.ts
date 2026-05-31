import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bboxFromCenter,
  fetchChargersInBBox,
  filterMockByBBox,
  osmToCharger,
} from "./overpass-chargers";
import type { ChargerStation } from "./chargers";

const BERLIN_BBOX = { south: 52.5, west: 13.4, north: 52.6, east: 13.5 };

const SAMPLE_OSM = {
  id: 12345,
  lat: 52.55,
  lon: 13.45,
  tags: {
    name: "Berlin Supercharger",
    operator: "Tesla",
    "socket:tesla_supercharger": "8",
    "socket:tesla_supercharger:output": "250 kW",
  },
};

let cacheDir: string;
const fetchMock = vi.fn();

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), "overpass-test-"));
  process.env.OVERPASS_CACHE_DIR = cacheDir;
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
  delete process.env.OVERPASS_CACHE_DIR;
  vi.unstubAllGlobals();
});

function okResponse(elements: unknown[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ elements }),
  };
}

function errResponse(status: number) {
  return { ok: false, status, json: async () => ({}) };
}

describe("bboxFromCenter", () => {
  it("expands a center+radius into a bbox roughly the right size", () => {
    const bbox = bboxFromCenter(48.15, 17.1, 10);
    expect(bbox.north - bbox.south).toBeCloseTo(20 / 111, 2);
    expect(bbox.east).toBeGreaterThan(bbox.west);
    expect(bbox.north).toBeGreaterThan(bbox.south);
  });
});

describe("osmToCharger", () => {
  it("projects an OSM Tesla supercharger into a station", () => {
    const station = osmToCharger(SAMPLE_OSM);
    expect(station.id).toBe("12345");
    expect(station.title).toBe("Berlin Supercharger");
    expect(station.operator).toBe("Tesla");
    expect(station.maxPowerKw).toBe(250);
    expect(station.totalPoints).toBe(8);
    expect(station.powerLevel).toBe("dc_ultra");
    expect(station.connections[0].connectorType).toBe("Tesla");
  });

  it("flags IONITY as renewable via operator allowlist", () => {
    const station = osmToCharger({
      id: 1,
      lat: 0,
      lon: 0,
      tags: { operator: "IONITY", "socket:ccs2": "4" },
    });
    expect(station.renewable).toBe(true);
  });

  it("falls back to default Type2 when no socket tags present", () => {
    const station = osmToCharger({ id: 2, lat: 0, lon: 0, tags: { capacity: "3" } });
    expect(station.connections).toHaveLength(1);
    expect(station.connections[0].connectorType).toBe("Type2");
    expect(station.totalPoints).toBe(3);
  });
});

describe("filterMockByBBox", () => {
  const stations: ChargerStation[] = [
    { ...stationStub(), id: "in", lat: 52.55, lng: 13.45 },
    { ...stationStub(), id: "out", lat: 0, lng: 0 },
  ];
  it("keeps only stations inside the bbox", () => {
    const inside = filterMockByBBox(stations, BERLIN_BBOX);
    expect(inside).toHaveLength(1);
    expect(inside[0].id).toBe("in");
  });
});

describe("fetchChargersInBBox", () => {
  it("returns live data from the first mirror on success", async () => {
    fetchMock.mockResolvedValueOnce(okResponse([SAMPLE_OSM]));
    const result = await fetchChargersInBBox(BERLIN_BBOX);
    expect(result.source).toBe("live");
    expect(result.stations).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls over to the second mirror when the first returns 504", async () => {
    fetchMock
      .mockResolvedValueOnce(errResponse(504))
      .mockResolvedValueOnce(okResponse([SAMPLE_OSM]));
    const result = await fetchChargersInBBox(BERLIN_BBOX);
    expect(result.source).toBe("live");
    expect(result.stations).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("serves stale cache when all mirrors fail and a previous result exists", async () => {
    fetchMock.mockResolvedValueOnce(okResponse([SAMPLE_OSM]));
    await fetchChargersInBBox(BERLIN_BBOX);

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(errResponse(504))
      .mockResolvedValueOnce(errResponse(504))
      .mockResolvedValueOnce(errResponse(504));

    // Force the fresh-TTL check to fail by stubbing Date.now(). The cache
    // stays on disk; only its freshness flips. The stale-hard-limit of
    // 14 days still passes, so we expect the stale branch.
    const realNow = Date.now;
    const future = realNow() + 25 * 60 * 60 * 1000;
    vi.spyOn(Date, "now").mockReturnValue(future);

    const result = await fetchChargersInBBox(BERLIN_BBOX);
    expect(result.source).toBe("stale");
    expect(result.stations).toHaveLength(1);

    vi.restoreAllMocks();
  });

  it("falls back to mock when all mirrors fail and no cache exists", async () => {
    fetchMock
      .mockResolvedValueOnce(errResponse(504))
      .mockResolvedValueOnce(errResponse(504))
      .mockResolvedValueOnce(errResponse(504));

    const mock: ChargerStation[] = [{ ...stationStub(), id: "mock1" }];
    const result = await fetchChargersInBBox(BERLIN_BBOX, {
      mockFallback: () => mock,
    });
    expect(result.source).toBe("mock");
    expect(result.stations).toEqual(mock);
    expect(result.error).toContain("HTTP 504");
  });

  it("uses cache on second call within TTL without hitting the network", async () => {
    fetchMock.mockResolvedValueOnce(okResponse([SAMPLE_OSM]));
    await fetchChargersInBBox(BERLIN_BBOX);

    fetchMock.mockReset();
    const result = await fetchChargersInBBox(BERLIN_BBOX);
    expect(result.source).toBe("cache");
    expect(result.stations).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function stationStub(): ChargerStation {
  return {
    id: "x",
    title: "X",
    operator: "X",
    address: "",
    city: "",
    country: "",
    lat: 0,
    lng: 0,
    status: "operational",
    usageType: "public",
    connections: [],
    totalPoints: 0,
    maxPowerKw: 0,
    powerLevel: "ac_fast",
    costInfo: null,
    openHours: null,
    rating: null,
    lastVerified: null,
    photoUrl: null,
    renewable: false,
  };
}
