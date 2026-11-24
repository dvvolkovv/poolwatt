// GET /v1/zones — trading zones and their market parameters (ТЗ §13).
import { ok } from "@/lib/exchange/api";
import { numOrNull } from "@/lib/exchange/decimal";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const zones = await prisma.gridZone.findMany({ orderBy: { code: "asc" } });
  return ok({
    zones: zones.map((z) => ({
      id: z.id,
      code: z.code,
      country: z.country,
      name: z.name,
      currency: z.currency,
      intervalMinutes: z.intervalMinutes,
      spotPrice: numOrNull(z.spotPrice),
      spotPriceAt: z.spotPriceAt?.toISOString() ?? null,
      corridorPct: numOrNull(z.corridorPct),
      aggregatorName: z.aggregatorName,
    })),
  });
}
