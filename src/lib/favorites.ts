// Server-side helpers for the V1 personal cabinet's favorites.
//
// In V1, producers and chargers still come from src/lib mocks (not Prisma).
// The Watchlist table's `producerId` column stores the producer.handle (a
// human-friendly stable id) — not a real FK. The eventual cutover spec will
// either repoint this to a real FK or migrate the column. ChargerFavorite is
// new in V1 and stores ChargerStation.id (currently from chargers-mock.ts).

import { prisma } from "@/lib/prisma";
import { MOCK_PRODUCERS, type ProducerRow } from "@/lib/producers";
import { getChargerById, MOCK_CHARGERS } from "@/lib/chargers-mock";
import type { ChargerStation } from "@/lib/chargers";

export type FavoriteKind = "producer" | "charger";

export async function readFavoriteProducerHandles(userId: string): Promise<Set<string>> {
  const rows = await prisma.watchlist.findMany({
    where: { userId },
    select: { producerId: true },
  });
  return new Set(rows.map((r) => r.producerId));
}

export async function readFavoriteChargerIds(userId: string): Promise<Set<string>> {
  const rows = await prisma.chargerFavorite.findMany({
    where: { userId },
    select: { chargerId: true },
  });
  return new Set(rows.map((r) => r.chargerId));
}

// Look up the producer mocks by their handles. Producers not found in the mock
// table are silently dropped (e.g. if mocks change). Returns producers in the
// order their favorites were added (newest-first).
export async function readFavoriteProducers(userId: string): Promise<ProducerRow[]> {
  const rows = await prisma.watchlist.findMany({
    where: { userId },
    orderBy: { addedAt: "desc" },
  });
  const byHandle = new Map(MOCK_PRODUCERS.map((p) => [p.handle, p]));
  return rows.map((r) => byHandle.get(r.producerId)).filter(Boolean) as ProducerRow[];
}

export async function readFavoriteChargers(userId: string): Promise<ChargerStation[]> {
  const rows = await prisma.chargerFavorite.findMany({
    where: { userId },
    orderBy: { addedAt: "desc" },
  });
  return rows.map((r) => getChargerById(r.chargerId)).filter(Boolean) as ChargerStation[];
}

export async function addFavorite(kind: FavoriteKind, userId: string, id: string): Promise<void> {
  if (kind === "producer") {
    // Verify the producer exists in the mock catalog before we accept the favorite.
    if (!MOCK_PRODUCERS.some((p) => p.handle === id)) {
      throw new Error(`Unknown producer handle: ${id}`);
    }
    await prisma.watchlist.upsert({
      where: { userId_producerId: { userId, producerId: id } },
      create: { userId, producerId: id },
      update: {},
    });
  } else {
    if (!MOCK_CHARGERS.some((c) => c.id === id)) {
      throw new Error(`Unknown charger id: ${id}`);
    }
    await prisma.chargerFavorite.upsert({
      where: { userId_chargerId: { userId, chargerId: id } },
      create: { userId, chargerId: id },
      update: {},
    });
  }
}

export async function removeFavorite(kind: FavoriteKind, userId: string, id: string): Promise<void> {
  if (kind === "producer") {
    await prisma.watchlist.deleteMany({
      where: { userId, producerId: id },
    });
  } else {
    await prisma.chargerFavorite.deleteMany({
      where: { userId, chargerId: id },
    });
  }
}
