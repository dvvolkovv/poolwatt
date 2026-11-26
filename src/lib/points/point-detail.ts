// One Poolwatt point for the full card at /c/[id] — ТЗ §27, §28.
//
// The page speaks ChargerStation, so a point is projected into that shape
// here rather than giving the page a second kind of thing to render. A card
// that is not published yet is not found: the full card is a public page.

import { PointStatus } from "@prisma/client";
import type { ChargerStation } from "@/lib/chargers";
import { prisma } from "@/lib/prisma";
import { num, numOrNull } from "@/lib/exchange/decimal";
import { pointToStation } from "./point-to-station";
import { localMinuteOfDay, tariffAt, zoneKnown } from "./point-tariff";

export async function loadPointAsStation(id: string): Promise<ChargerStation | null> {
  const point = await prisma.acceptancePoint.findUnique({
    where: { id },
    include: {
      operator: { select: { displayName: true } },
      connectors: true,
      // Все окна суток: цена карточки — та, что действует сейчас.
      tariffs: { orderBy: { fromMinute: "asc" } },
    },
  });
  if (!point || point.status !== PointStatus.PUBLISHED) return null;
  if (point.latitude == null || point.longitude == null) return null;

  const tariff = tariffAt(point.tariffs, localMinuteOfDay(new Date(), point.country));
  const station = pointToStation({
    id: point.id,
    name: point.name,
    operatorName: point.operator.displayName,
    type: point.type,
    city: point.city,
    country: point.country,
    addressLine: point.addressLine,
    latitude: point.latitude,
    longitude: point.longitude,
    energySource: point.energySource,
    open24: point.open24,
    priceFiat: numOrNull(tariff?.priceFiat ?? null),
    priceTokens: numOrNull(tariff?.priceTokens ?? null),
    currency: tariff?.currency ?? "EUR",
    idleFeePerMin: numOrNull(tariff?.idleFeePerMin ?? null),
    paymentMethods: point.paymentMethods,
    priceZoneKnown: zoneKnown(point.country),
    connectors: point.connectors.map((c) => ({
      type: c.type as string,
      powerKw: num(c.powerKw),
      quantity: c.quantity,
      status: c.status,
    })),
    distanceM: null,
  });

  return { ...station, howToFind: point.howToFind };
}
