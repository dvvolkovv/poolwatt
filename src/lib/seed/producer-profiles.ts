import type { PrismaClient } from "@prisma/client";
import type { ProducerProfile } from "@/lib/producers";
import type { SeedResult } from "./producers";

export async function seedProducerProfiles(
  prisma: PrismaClient,
  profiles: Record<string, ProducerProfile>,
): Promise<SeedResult> {
  const handles = Object.keys(profiles);
  const producers = await prisma.producer.findMany({
    where: { handle: { in: handles } },
    select: { id: true, handle: true },
  });
  const idByHandle = new Map(producers.map((p) => [p.handle, p.id]));

  const data = handles
    .filter((h) => idByHandle.has(h))
    .map((h) => {
      const p = profiles[h];
      return {
        producerId: idByHandle.get(h)!,
        description: p.description,
        founded: p.founded,
        employees: p.employees,
        website: p.website,
        email: p.email,
        phone: p.phone,
        address: p.address,
        ceo: p.ceo,
        stockTicker: p.stockTicker,
        certifications: p.certifications ?? [],
        keyProducts: p.keyProducts ?? [],
      };
    });

  const result = await prisma.producerProfile.createMany({
    data,
    skipDuplicates: true,
  });
  return { created: result.count, skipped: data.length - result.count };
}
