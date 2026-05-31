import type { Producer, ProducerProfile as DbProducerProfile } from "@prisma/client";
import type { ProducerRow, ProducerProfile as MockProducerProfile } from "@/lib/producers";

export type ProducerSnapshotData = Pick<
  ProducerRow,
  | "stateOfChargePct"
  | "availableKwh"
  | "pricePerKwhUsd"
  | "delivered24hKwh"
  | "deliveredLifetimeKwh"
  | "pctChange1h"
  | "pctChange24h"
  | "pctChange7d"
  | "uptimePct"
  | "weeklyOutput"
  | "weatherCondition"
  | "carbonOffsetKgCo2e"
>;

export type DbProducerWithProfile = Producer & {
  profile: DbProducerProfile | null;
};

export function mergeProducer(
  db: DbProducerWithProfile,
  snapshot: ProducerSnapshotData,
): ProducerRow {
  return {
    // DB-sourced card fields
    id: db.id,
    rank: db.rank,
    handle: db.handle,
    displayName: db.displayName,
    city: db.city ?? "",
    country: db.country,
    primarySource: db.primarySource,
    category: db.category,
    capacityKwh: Number(db.capacityKwh),
    inverterKw: Number(db.inverterKw),
    equipment: db.equipment,
    manufactures: db.manufactures,
    profile: db.profile ? toMockProfile(db.profile) : undefined,
    // Mock-sourced operational fields (until a real telemetry pipeline lands)
    stateOfChargePct: snapshot.stateOfChargePct,
    availableKwh: snapshot.availableKwh,
    pricePerKwhUsd: snapshot.pricePerKwhUsd,
    delivered24hKwh: snapshot.delivered24hKwh,
    deliveredLifetimeKwh: snapshot.deliveredLifetimeKwh,
    pctChange1h: snapshot.pctChange1h,
    pctChange24h: snapshot.pctChange24h,
    pctChange7d: snapshot.pctChange7d,
    uptimePct: snapshot.uptimePct,
    weeklyOutput: snapshot.weeklyOutput,
    weatherCondition: snapshot.weatherCondition,
    carbonOffsetKgCo2e: snapshot.carbonOffsetKgCo2e,
  };
}

function toMockProfile(db: DbProducerProfile): MockProducerProfile {
  return {
    description: db.description ?? "",
    founded: db.founded ?? 0,
    employees: db.employees ?? "",
    website: db.website ?? "",
    email: db.email ?? "",
    phone: db.phone ?? "",
    address: db.address ?? "",
    ceo: db.ceo ?? "",
    stockTicker: db.stockTicker ?? undefined,
    certifications: db.certifications,
    keyProducts: db.keyProducts,
  };
}
