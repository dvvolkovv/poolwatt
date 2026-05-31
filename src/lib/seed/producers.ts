import type { PrismaClient } from "@prisma/client";
import type { ProducerRow } from "@/lib/producers";

export type SeedResult = { created: number; skipped: number };

export async function seedProducers(
  prisma: PrismaClient,
  rows: ProducerRow[],
): Promise<SeedResult> {
  const data = rows.map(toProducerData);
  const result = await prisma.producer.createMany({
    data,
    skipDuplicates: true,
  });
  return { created: result.count, skipped: rows.length - result.count };
}

function toProducerData(row: ProducerRow) {
  return {
    handle: row.handle,
    slug: row.handle,
    displayName: row.displayName,
    city: row.city,
    country: row.country,
    primarySource: row.primarySource,
    category:
      row.category === "EQUIPMENT_MANUFACTURER"
        ? ("EQUIPMENT_MANUFACTURER" as const)
        : ("ENERGY_PRODUCER" as const),
    capacityKwh: row.capacityKwh,
    inverterKw: row.inverterKw,
    rank: row.rank,
    equipment: row.equipment ?? [],
    manufactures: row.manufactures ?? [],
  };
}
