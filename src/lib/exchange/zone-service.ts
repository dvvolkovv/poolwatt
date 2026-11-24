// Zone lookups and market parameters — ТЗ §13 (GridZone), §16.5.

import { prisma } from "@/lib/prisma";
import type { Db } from "./audit";
import { numOrNull } from "./decimal";
import type { Corridor } from "./corridor";

export async function findZone(db: Db, idOrCode: string) {
  return db.gridZone.findFirst({
    where: { OR: [{ id: idOrCode }, { code: idOrCode.toUpperCase() }] },
  });
}

export async function requireZone(idOrCode: string, db: Db = prisma) {
  const zone = await findZone(db, idOrCode);
  if (!zone) throw new Error(`Unknown grid zone: ${idOrCode}`);
  return zone;
}

export function zoneCorridor(zone: {
  spotPrice: unknown;
  corridorPct: unknown;
}): Corridor {
  return {
    spotPrice: numOrNull(zone.spotPrice as never),
    corridorPct: numOrNull(zone.corridorPct as never),
  };
}

/** Start of the settlement interval that `at` falls into (§5, §18). */
export function intervalStartFor(at: Date, intervalMinutes: number): Date {
  const ms = intervalMinutes * 60 * 1000;
  return new Date(Math.floor(at.getTime() / ms) * ms);
}

export function intervalEndFor(at: Date, intervalMinutes: number): Date {
  return new Date(intervalStartFor(at, intervalMinutes).getTime() + intervalMinutes * 60 * 1000);
}
