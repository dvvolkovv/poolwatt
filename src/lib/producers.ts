// Types and mock data for producers (households contributing renewable power
// from their on-site powerbank/battery storage).
//
// In production these come from the database via Prisma. The reference project
// (trientes) reads precomputed snapshots from Redis; we'll wire the same path
// in Phase 2. For Phase 1 the home page renders deterministic mock rows so the
// landing page works without any infra.

export type RenewableSource = "SOLAR" | "WIND" | "HYDRO" | "BIOMASS" | "GEOTHERMAL" | "HYBRID";

export type ProducerRow = {
  id: string;
  rank: number;
  handle: string;
  displayName: string;
  city: string;
  country: string;          // ISO 3166-1 alpha-2
  primarySource: RenewableSource;
  capacityKwh: number;
  inverterKw: number;
  /** State of charge 0..100. */
  stateOfChargePct: number;
  /** kWh available for sale right now. */
  availableKwh: number;
  pricePerKwhUsd: number;
  delivered24hKwh: number;
  deliveredLifetimeKwh: number;
  pctChange1h: number | null;
  pctChange24h: number | null;
  pctChange7d: number | null;
  uptimePct: number;
  /** 7-day mini-series for the sparkline. */
  weeklyOutput: number[];
  weatherCondition: "SUNNY" | "CLOUDY" | "WINDY" | "CALM" | "RAINY";
  carbonOffsetKgCo2e: number;
};

// Deterministic mock rows. Values are loosely realistic: a residential solar+battery
// setup is ~5–15 kWh capacity, ~3–10 kW inverter, $0.08–$0.20 per kWh.
export const MOCK_PRODUCERS: ProducerRow[] = [
  {
    id: "p_lisbon_rooftop_04",
    rank: 1,
    handle: "lisbon-rooftop-04",
    displayName: "Casa do Sol — Lisbon",
    city: "Lisbon",
    country: "PT",
    primarySource: "SOLAR",
    capacityKwh: 27.0,
    inverterKw: 9.6,
    stateOfChargePct: 92,
    availableKwh: 24.8,
    pricePerKwhUsd: 0.084,
    delivered24hKwh: 41.2,
    deliveredLifetimeKwh: 18_402,
    pctChange1h: 0.4,
    pctChange24h: 2.8,
    pctChange7d: 6.1,
    uptimePct: 99.7,
    weeklyOutput: [38, 41, 37, 44, 46, 39, 41],
    weatherCondition: "SUNNY",
    carbonOffsetKgCo2e: 18.4,
  },
  {
    id: "p_north_sea_pod_12",
    rank: 2,
    handle: "north-sea-pod-12",
    displayName: "Helga's Pod — Aalborg",
    city: "Aalborg",
    country: "DK",
    primarySource: "WIND",
    capacityKwh: 32.0,
    inverterKw: 12.0,
    stateOfChargePct: 71,
    availableKwh: 22.7,
    pricePerKwhUsd: 0.071,
    delivered24hKwh: 58.9,
    deliveredLifetimeKwh: 22_188,
    pctChange1h: -0.2,
    pctChange24h: 1.9,
    pctChange7d: 4.3,
    uptimePct: 98.4,
    weeklyOutput: [55, 62, 49, 58, 60, 57, 58],
    weatherCondition: "WINDY",
    carbonOffsetKgCo2e: 26.3,
  },
  {
    id: "p_alpine_creek_07",
    rank: 3,
    handle: "alpine-creek-07",
    displayName: "Bachhaus — Innsbruck",
    city: "Innsbruck",
    country: "AT",
    primarySource: "HYDRO",
    capacityKwh: 18.0,
    inverterKw: 6.0,
    stateOfChargePct: 100,
    availableKwh: 18.0,
    pricePerKwhUsd: 0.062,
    delivered24hKwh: 73.0,
    deliveredLifetimeKwh: 41_660,
    pctChange1h: 0.1,
    pctChange24h: 0.4,
    pctChange7d: 1.2,
    uptimePct: 99.9,
    weeklyOutput: [72, 73, 71, 74, 73, 72, 73],
    weatherCondition: "CALM",
    carbonOffsetKgCo2e: 32.6,
  },
  {
    id: "p_sevilla_mirador",
    rank: 4,
    handle: "sevilla-mirador",
    displayName: "Mirador del Sur",
    city: "Sevilla",
    country: "ES",
    primarySource: "SOLAR",
    capacityKwh: 22.0,
    inverterKw: 8.0,
    stateOfChargePct: 86,
    availableKwh: 18.9,
    pricePerKwhUsd: 0.079,
    delivered24hKwh: 36.4,
    deliveredLifetimeKwh: 12_750,
    pctChange1h: 0.7,
    pctChange24h: 3.4,
    pctChange7d: 7.8,
    uptimePct: 99.2,
    weeklyOutput: [33, 36, 39, 38, 34, 36, 36],
    weatherCondition: "SUNNY",
    carbonOffsetKgCo2e: 16.2,
  },
  {
    id: "p_irish_breeze_02",
    rank: 5,
    handle: "irish-breeze-02",
    displayName: "Cliff Cottage — Dingle",
    city: "Dingle",
    country: "IE",
    primarySource: "WIND",
    capacityKwh: 24.0,
    inverterKw: 9.0,
    stateOfChargePct: 64,
    availableKwh: 15.4,
    pricePerKwhUsd: 0.074,
    delivered24hKwh: 47.6,
    deliveredLifetimeKwh: 9_842,
    pctChange1h: -0.8,
    pctChange24h: -1.4,
    pctChange7d: 2.1,
    uptimePct: 97.1,
    weeklyOutput: [50, 46, 51, 49, 48, 47, 48],
    weatherCondition: "WINDY",
    carbonOffsetKgCo2e: 21.3,
  },
  {
    id: "p_bavarian_barn",
    rank: 6,
    handle: "bavarian-barn",
    displayName: "Sonnenscheune — Augsburg",
    city: "Augsburg",
    country: "DE",
    primarySource: "HYBRID",
    capacityKwh: 35.0,
    inverterKw: 12.0,
    stateOfChargePct: 78,
    availableKwh: 27.3,
    pricePerKwhUsd: 0.082,
    delivered24hKwh: 52.1,
    deliveredLifetimeKwh: 31_220,
    pctChange1h: 0.3,
    pctChange24h: 1.1,
    pctChange7d: 3.5,
    uptimePct: 99.4,
    weeklyOutput: [50, 53, 51, 54, 52, 51, 52],
    weatherCondition: "CLOUDY",
    carbonOffsetKgCo2e: 23.4,
  },
  {
    id: "p_kerala_palm",
    rank: 7,
    handle: "kerala-palm",
    displayName: "Palm Roof — Kochi",
    city: "Kochi",
    country: "IN",
    primarySource: "SOLAR",
    capacityKwh: 14.0,
    inverterKw: 5.0,
    stateOfChargePct: 95,
    availableKwh: 13.3,
    pricePerKwhUsd: 0.057,
    delivered24hKwh: 28.5,
    deliveredLifetimeKwh: 7_344,
    pctChange1h: 0.5,
    pctChange24h: 2.2,
    pctChange7d: 5.0,
    uptimePct: 98.8,
    weeklyOutput: [27, 28, 30, 29, 28, 28, 29],
    weatherCondition: "SUNNY",
    carbonOffsetKgCo2e: 12.7,
  },
  {
    id: "p_atacama_lab",
    rank: 8,
    handle: "atacama-lab",
    displayName: "Atacama Field Lab",
    city: "San Pedro de Atacama",
    country: "CL",
    primarySource: "SOLAR",
    capacityKwh: 48.0,
    inverterKw: 18.0,
    stateOfChargePct: 100,
    availableKwh: 48.0,
    pricePerKwhUsd: 0.051,
    delivered24hKwh: 96.4,
    deliveredLifetimeKwh: 52_900,
    pctChange1h: 0.2,
    pctChange24h: 1.6,
    pctChange7d: 4.1,
    uptimePct: 99.9,
    weeklyOutput: [94, 95, 97, 98, 96, 96, 96],
    weatherCondition: "SUNNY",
    carbonOffsetKgCo2e: 43.1,
  },
  {
    id: "p_galician_mill",
    rank: 9,
    handle: "galician-mill",
    displayName: "Muíño do Vento",
    city: "Vigo",
    country: "ES",
    primarySource: "WIND",
    capacityKwh: 20.0,
    inverterKw: 7.5,
    stateOfChargePct: 57,
    availableKwh: 11.4,
    pricePerKwhUsd: 0.068,
    delivered24hKwh: 39.2,
    deliveredLifetimeKwh: 14_022,
    pctChange1h: -0.3,
    pctChange24h: 0.8,
    pctChange7d: 1.7,
    uptimePct: 97.9,
    weeklyOutput: [39, 41, 38, 40, 39, 39, 40],
    weatherCondition: "WINDY",
    carbonOffsetKgCo2e: 17.5,
  },
  {
    id: "p_norwegian_fjord",
    rank: 10,
    handle: "norwegian-fjord",
    displayName: "Fjordhus — Bergen",
    city: "Bergen",
    country: "NO",
    primarySource: "HYDRO",
    capacityKwh: 30.0,
    inverterKw: 10.0,
    stateOfChargePct: 98,
    availableKwh: 29.4,
    pricePerKwhUsd: 0.058,
    delivered24hKwh: 68.1,
    deliveredLifetimeKwh: 37_180,
    pctChange1h: 0.1,
    pctChange24h: 0.3,
    pctChange7d: 0.9,
    uptimePct: 99.9,
    weeklyOutput: [67, 68, 67, 69, 68, 68, 68],
    weatherCondition: "RAINY",
    carbonOffsetKgCo2e: 30.3,
  },
];

export type GridSnap = {
  totalCapacityKwh: number;
  totalDelivered24hKwh: number;
  totalLifetimeKwh: number;
  activeProducers: number;
  activeHubs: number;
  solarSharePct: number;
  windSharePct: number;
  hydroSharePct: number;
  otherSharePct: number;
  carbonOffset24hKgCo2e: number;
};

export const MOCK_GRID_STATS: GridSnap = {
  totalCapacityKwh: 18_420,
  totalDelivered24hKwh: 41_236,
  totalLifetimeKwh: 4_184_902,
  activeProducers: 612,
  activeHubs: 14,
  solarSharePct: 58.4,
  windSharePct: 24.1,
  hydroSharePct: 12.7,
  otherSharePct: 4.8,
  carbonOffset24hKgCo2e: 18_556,
};
