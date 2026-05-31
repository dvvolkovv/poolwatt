import { describe, it, expect } from "vitest";
import { mergeProducer, type ProducerSnapshotData } from "./merge-producer";
import type { Producer, ProducerProfile as DbProducerProfile } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

function fakeDb(overrides: Partial<Producer> = {}, profile: DbProducerProfile | null = null) {
  const base: Producer = {
    id: "p_test",
    slug: "test-handle",
    handle: "test-handle",
    displayName: "Test Co",
    city: "Berlin",
    region: null,
    country: "DE",
    lat: null,
    lng: null,
    primarySource: "SOLAR",
    sourceMix: null,
    capacityKwh: new Decimal(500),
    inverterKw: new Decimal(180),
    installedAt: null,
    source: "SELF_ENROLLED",
    isActive: true,
    rank: 42,
    logoUrl: null,
    bannerUrl: null,
    bio: null,
    websiteUrl: null,
    twitterUrl: null,
    ownerId: null,
    addedByAdminId: null,
    approvedFromRequestId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    metadataFetchedAt: null,
    category: "ENERGY_PRODUCER",
    equipment: [],
    manufactures: [],
    ...overrides,
  };
  return { ...base, profile };
}

const SNAPSHOT: ProducerSnapshotData = {
  stateOfChargePct: 88,
  availableKwh: 440,
  pricePerKwhUsd: 0.052,
  delivered24hKwh: 960,
  deliveredLifetimeKwh: 3_800_000,
  pctChange1h: 0.3,
  pctChange24h: 1.8,
  pctChange7d: 4.5,
  uptimePct: 99.6,
  weeklyOutput: [940, 970, 950, 980, 960, 955, 960],
  weatherCondition: "SUNNY",
  carbonOffsetKgCo2e: 429,
};

describe("mergeProducer", () => {
  it("takes card fields from DB and operational fields from snapshot", () => {
    const db = fakeDb({ displayName: "Renamed", country: "FR" });
    const row = mergeProducer(db, SNAPSHOT);
    expect(row.displayName).toBe("Renamed");
    expect(row.country).toBe("FR");
    expect(row.stateOfChargePct).toBe(88);
    expect(row.weeklyOutput).toEqual([940, 970, 950, 980, 960, 955, 960]);
    expect(row.weatherCondition).toBe("SUNNY");
  });

  it("converts Decimal to number for capacityKwh and inverterKw", () => {
    const db = fakeDb({
      capacityKwh: new Decimal("420.5"),
      inverterKw: new Decimal("150"),
    });
    const row = mergeProducer(db, SNAPSHOT);
    expect(typeof row.capacityKwh).toBe("number");
    expect(row.capacityKwh).toBe(420.5);
    expect(typeof row.inverterKw).toBe("number");
    expect(row.inverterKw).toBe(150);
  });

  it("copies category enum (string) through", () => {
    const db = fakeDb({ category: "EQUIPMENT_MANUFACTURER" });
    const row = mergeProducer(db, SNAPSHOT);
    expect(row.category).toBe("EQUIPMENT_MANUFACTURER");
  });

  it("copies equipment[] and manufactures[]", () => {
    const db = fakeDb({
      equipment: ["Inverter X"],
      manufactures: ["Module Y"],
    });
    const row = mergeProducer(db, SNAPSHOT);
    expect(row.equipment).toEqual(["Inverter X"]);
    expect(row.manufactures).toEqual(["Module Y"]);
  });

  it("converts DB profile to mock-profile shape when present", () => {
    const profile: DbProducerProfile = {
      producerId: "p_test",
      description: "About",
      founded: 2010,
      employees: "~100",
      website: "https://test.example",
      email: "ceo@test.example",
      phone: "+49 30 1",
      address: "Berlin",
      ceo: "Jane",
      stockTicker: "TST",
      certifications: ["ISO 9001"],
      keyProducts: ["Panels"],
      updatedAt: new Date(),
    };
    const db = fakeDb({}, profile);
    const row = mergeProducer(db, SNAPSHOT);
    expect(row.profile).toBeDefined();
    expect(row.profile?.description).toBe("About");
    expect(row.profile?.founded).toBe(2010);
    expect(row.profile?.certifications).toEqual(["ISO 9001"]);
    expect(row.profile?.stockTicker).toBe("TST");
  });

  it("omits profile field when DB profile is null", () => {
    const row = mergeProducer(fakeDb({}, null), SNAPSHOT);
    expect(row.profile).toBeUndefined();
  });

  it("falls back to empty string when DB city is null (mock requires string)", () => {
    const row = mergeProducer(fakeDb({ city: null }), SNAPSHOT);
    expect(row.city).toBe("");
  });
});
